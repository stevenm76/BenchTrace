/**
 * Read a HuggingFace-style model directory (config.json + tokenizer_config.json
 * + safetensors index, when present) to extract exact model metadata that
 * the name-regex inference can only guess at. Returns null when the path
 * isn't readable from where BenchTrace runs (e.g. the model lives inside a
 * container and isn't bind-mounted to the host).
 *
 * The probed `root` returned by /v1/models on vLLM is typically a host path
 * the user passed in via `--model`, so it's usually readable. When it's not,
 * we just leave the regex-inferred values in place.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Pluggable file reader. Lets the caller bind a "read file inside the
 * running container" implementation when the model dir doesn't exist on
 * the host (the common case for host-CLI + container-vLLM setups).
 */
export type FileReader = (p: string) => Promise<string | null>;

export interface ModelConfigProbe {
  /** Architecture name from config.json (Qwen3MoeForCausalLM etc.). */
  architecture: string | null;
  /** "dense" | "moe" — inferred from config keys. */
  denseOrMoe: "dense" | "moe" | null;
  /** Parameter count, summed from the safetensors index header. */
  parameterCount: number | null;
  /** Active parameter count for MoE (computed: dense layers + active experts). */
  activeParameterCount: number | null;
  /** Quant method from quantization_config.quant_method or null. */
  quantization: string | null;
  /** Precision string normalized to one of: fp32, fp16, bf16, fp8, fp4, int8, int4. */
  precision: string | null;
  /** Storage format — "safetensors" or "gguf" or null. */
  format: string | null;
  /** Tokenizer class / model from tokenizer_config.json. */
  tokenizer: string | null;
  /** From config.max_position_embeddings — the model's hard context limit. */
  maxPositionEmbeddings: number | null;
  /** From config.vocab_size — the tokenizer vocabulary size. */
  vocabSize: number | null;
  /** Modalities the model accepts ("text", "vision", "audio"). */
  capabilities: string[];
  /** License from README or model card if available locally. */
  license: string | null;
  /** sha256 of config.json — useful for verification. */
  configHash: string | null;
}

export async function probeModelConfig(
  modelPath: string | null,
  fallbackReader?: FileReader,
): Promise<ModelConfigProbe | null> {
  if (!modelPath) return null;
  // Reject obvious non-paths so we don't read e.g. a bare model alias.
  if (!modelPath.startsWith("/") && !modelPath.startsWith("./")) return null;

  // Local-host first, then fall back to whatever reader the caller wired in
  // (typically docker exec into the serving container).
  const reader: FileReader = async (p) => {
    try {
      return await fs.readFile(p, "utf8");
    } catch {
      return fallbackReader ? fallbackReader(p) : null;
    }
  };

  const configRaw = await reader(path.join(modelPath, "config.json"));
  if (!configRaw) return null;
  const configHash = await hashString(configRaw);

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(configRaw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const out: ModelConfigProbe = {
    architecture: null,
    denseOrMoe: null,
    parameterCount: null,
    activeParameterCount: null,
    quantization: null,
    precision: null,
    format: null,
    tokenizer: null,
    maxPositionEmbeddings: null,
    vocabSize: null,
    capabilities: [],
    license: null,
    configHash,
  };

  // Architecture
  if (Array.isArray(config.architectures) && config.architectures.length > 0) {
    out.architecture = String(config.architectures[0]);
  }

  // MoE detection — both Qwen-MoE-style (`num_experts`) and Mixtral-style.
  const numExperts = numberOf(config, "num_experts", "num_local_experts");
  const numExpertsPerTok = numberOf(
    config,
    "num_experts_per_tok",
    "num_active_experts",
  );
  if (numExperts != null && numExperts > 1) {
    out.denseOrMoe = "moe";
  } else if (out.architecture) {
    out.denseOrMoe = "dense";
  }

  // Quantization
  const quantConfig = config.quantization_config as
    | Record<string, unknown>
    | undefined;
  if (quantConfig && typeof quantConfig === "object") {
    const method = quantConfig.quant_method ?? quantConfig.quantization_method;
    if (typeof method === "string") {
      out.quantization = method.toUpperCase();
    }
    // Precision often inferable from the quant config.
    if (
      typeof quantConfig.weight_dtype === "string" ||
      typeof quantConfig.activation_dtype === "string"
    ) {
      out.precision = normalizePrecision(
        String(
          quantConfig.weight_dtype ??
            quantConfig.activation_dtype ??
            quantConfig.dtype ??
            "",
        ),
      );
    }
  }

  // Fallback precision from torch_dtype
  if (!out.precision && typeof config.torch_dtype === "string") {
    out.precision = normalizePrecision(config.torch_dtype);
  }

  // Context
  if (typeof config.max_position_embeddings === "number") {
    out.maxPositionEmbeddings = config.max_position_embeddings;
  }

  // Vocab size — used by the random-tokens dataset to sample over the full
  // tokenizer range in vLLM-compatible mode. Multimodal models (e.g. Qwen-VL)
  // nest it under text_config/llm_config rather than at the top level, so
  // check the common nestings too — otherwise random-token sampling silently
  // falls back to a smaller vocab and diverges from vLLM's prompt distribution.
  const nestedVocab = [
    config.vocab_size,
    (config.text_config as Record<string, unknown> | undefined)?.vocab_size,
    (config.llm_config as Record<string, unknown> | undefined)?.vocab_size,
    (config.language_config as Record<string, unknown> | undefined)?.vocab_size,
  ].find((v) => typeof v === "number");
  if (typeof nestedVocab === "number") {
    out.vocabSize = nestedVocab;
  }

  // Capabilities (multi-modal hints in the config)
  const caps: string[] = ["text"];
  if (config.vision_config || config.image_config) caps.push("vision");
  if (config.audio_config) caps.push("audio");
  if (config.tool_use_config) caps.push("tools");
  out.capabilities = caps;

  // Parameter counts. Three strategies in priority order:
  //   1. Read total weight size from safetensors index header.
  //   2. Sum bytes from the file list and divide by element size of the precision.
  //   3. Leave null and let the name-regex fallback do the guess.
  //
  // Only reachable when the model dir is on the host filesystem — over
  // docker-exec we don't get directory listings or stat(), only file
  // contents. Acceptable: param count then falls back to the name regex.
  const total = await sumSafetensorsParams(modelPath);
  if (total != null) {
    out.parameterCount = total;
    // For MoE: active params = total / num_experts * num_experts_per_tok
    // approximation. Mixed expert/dense layers mean this is a slight over-
    // estimate, but it's the right order of magnitude vs the name-regex
    // guess of "3B" from "a3b".
    if (
      out.denseOrMoe === "moe" &&
      numExperts != null &&
      numExpertsPerTok != null
    ) {
      out.activeParameterCount = Math.round(
        (total / numExperts) * numExpertsPerTok,
      );
    } else {
      out.activeParameterCount = total;
    }
  }

  // Format — only via fs.readdir (host path). Skip silently when reading
  // through docker-exec since we don't have directory listing there.
  try {
    const entries = await fs.readdir(modelPath);
    if (entries.some((e) => e.endsWith(".safetensors"))) out.format = "safetensors";
    else if (entries.some((e) => e.endsWith(".gguf"))) out.format = "gguf";
    else if (entries.some((e) => e.endsWith(".bin"))) out.format = "pytorch";
  } catch {
    /* leave null */
  }

  // Tokenizer info
  const tokRaw = await reader(path.join(modelPath, "tokenizer_config.json"));
  if (tokRaw) {
    try {
      const tok = JSON.parse(tokRaw) as Record<string, unknown>;
      out.tokenizer =
        typeof tok.tokenizer_class === "string"
          ? tok.tokenizer_class
          : typeof tok.model_type === "string"
            ? tok.model_type
            : null;
    } catch {
      /* leave null */
    }
  }

  // License from README front-matter or LICENSE file (simple match).
  out.license = await probeLicense(modelPath, reader);

  return out;
}

/**
 * Sum the byte size of every `.safetensors` file in the model dir and convert
 * to parameter count using the precision-implied bytes-per-param. Returns
 * null on any error.
 */
async function sumSafetensorsParams(
  modelPath: string,
): Promise<number | null> {
  try {
    const entries = await fs.readdir(modelPath);
    const shards = entries.filter((e) => e.endsWith(".safetensors"));
    if (shards.length === 0) return null;

    // Implementation deferred: the safetensors header would give exact param
    // counts (uint64 LE header length followed by a JSON manifest of every
    // tensor's shape + dtype), but reading every shard's header is too much
    // I/O. A bytes-per-param approximation would need precision info from
    // config.json — which the caller has anyway. So this function exists as
    // the future hook, returns null today, and the caller falls back to
    // the model-name regex.
    return null;
  } catch {
    return null;
  }
}

async function probeLicense(
  modelPath: string,
  reader: FileReader,
): Promise<string | null> {
  for (const candidate of ["README.md", "README", "LICENSE", "LICENSE.txt"]) {
    const raw = await reader(path.join(modelPath, candidate));
    if (!raw) continue;
    if (candidate.toLowerCase().startsWith("license")) {
      const first = raw.split(/\n/).find((l) => l.trim().length > 0);
      return first?.trim().slice(0, 80) ?? null;
    }
    const m = raw.match(/^license:\s*([^\n]+)/m);
    if (m) return m[1]!.trim();
  }
  return null;
}

function numberOf(
  obj: Record<string, unknown>,
  ...keys: string[]
): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number") return v;
  }
  return null;
}

function normalizePrecision(dtype: string): string | null {
  const d = dtype.toLowerCase().replace(/^torch\./, "");
  if (d.includes("bfloat16") || d === "bf16") return "bf16";
  if (d.includes("float16") || d === "fp16") return "fp16";
  if (d.includes("float32") || d === "fp32") return "fp32";
  if (d.includes("fp8") || d.includes("e4m3") || d.includes("e5m2")) return "fp8";
  if (d.includes("fp4") || d.includes("nvfp4")) return "fp4";
  if (d.includes("int8")) return "int8";
  if (d.includes("int4")) return "int4";
  if (d.includes("nf4")) return "nf4";
  return d || null;
}

async function hashString(s: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}
