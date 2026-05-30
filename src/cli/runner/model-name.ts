/**
 * Extract structured fields from a model name string. Best-effort regex
 * parsing — the alternative is leaving every Trace Detail page with "unknown
 * quant" / "—" / "—" for fields that are obvious from the name.
 *
 * Example: "Qwen3.6-35B-A22B-Instruct-NVFP4" →
 *   { architectureFamily: "Qwen3", parameterCount: 35e9,
 *     activeParameterCount: 22e9, denseOrMoe: "moe",
 *     quantization: "NVFP4", precision: "fp4" }
 */

export interface ModelNameInfo {
  architectureFamily: string | null;
  parameterCount: number | null;
  activeParameterCount: number | null;
  denseOrMoe: "dense" | "moe" | null;
  quantization: string | null;
  precision: string | null;
  format: string | null;
}

/** Parse a token like "35B", "8b", "1.5B", "236B" → tokens in raw count. */
function parseParamCount(s: string): number | null {
  const m = s.match(/^(\d+(?:\.\d+)?)([bm])$/i);
  if (!m) return null;
  const v = parseFloat(m[1]!);
  const unit = m[2]!.toLowerCase();
  if (unit === "b") return Math.round(v * 1e9);
  if (unit === "m") return Math.round(v * 1e6);
  return null;
}

export function inferFromModelName(name: string): ModelNameInfo {
  const out: ModelNameInfo = {
    architectureFamily: null,
    parameterCount: null,
    activeParameterCount: null,
    denseOrMoe: null,
    quantization: null,
    precision: null,
    format: null,
  };
  if (!name) return out;
  const lower = name.toLowerCase();

  // ── Architecture family ──
  const familyPatterns: { rx: RegExp; label: string }[] = [
    { rx: /(?:^|[-_/])qwen3\.6/i, label: "Qwen3.6" },
    { rx: /(?:^|[-_/])qwen3/i, label: "Qwen3" },
    { rx: /(?:^|[-_/])qwen2\.5/i, label: "Qwen2.5" },
    { rx: /(?:^|[-_/])qwen2/i, label: "Qwen2" },
    { rx: /(?:^|[-_/])qwen/i, label: "Qwen" },
    { rx: /(?:^|[-_/])llama[-_]?3\.1/i, label: "Llama-3.1" },
    { rx: /(?:^|[-_/])llama[-_]?3\.2/i, label: "Llama-3.2" },
    { rx: /(?:^|[-_/])llama[-_]?3\.3/i, label: "Llama-3.3" },
    { rx: /(?:^|[-_/])llama[-_]?3/i, label: "Llama-3" },
    { rx: /(?:^|[-_/])llama/i, label: "Llama" },
    { rx: /(?:^|[-_/])mistral/i, label: "Mistral" },
    { rx: /(?:^|[-_/])mixtral/i, label: "Mixtral" },
    { rx: /(?:^|[-_/])deepseek/i, label: "DeepSeek" },
    { rx: /(?:^|[-_/])gemma/i, label: "Gemma" },
    { rx: /(?:^|[-_/])phi[-_]?3/i, label: "Phi-3" },
    { rx: /(?:^|[-_/])phi[-_]?4/i, label: "Phi-4" },
    { rx: /(?:^|[-_/])phi/i, label: "Phi" },
    { rx: /(?:^|[-_/])yi[-_-]/i, label: "Yi" },
    { rx: /(?:^|[-_/])command[-_]?r/i, label: "Command-R" },
  ];
  for (const p of familyPatterns) {
    if (p.rx.test(lower)) {
      out.architectureFamily = p.label;
      break;
    }
  }

  // ── Parameter counts ──
  // Total: pick the first NNN[bm] segment that isn't preceded by "a" (active).
  // Active: pattern like "a22b", "a3b", "-a-3b-" etc.
  const tokens = lower.split(/[-_/.\s]+/);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (out.activeParameterCount == null) {
      const aMatch = t.match(/^a(\d+(?:\.\d+)?[bm])$/);
      if (aMatch) {
        out.activeParameterCount = parseParamCount(aMatch[1]!);
        continue;
      }
    }
    if (out.parameterCount == null) {
      const totalMatch = t.match(/^(\d+(?:\.\d+)?[bm])$/);
      if (totalMatch) {
        out.parameterCount = parseParamCount(totalMatch[1]!);
      }
    }
  }

  // Dense vs MoE — if we saw an active param count, it's MoE.
  if (out.activeParameterCount != null && out.parameterCount != null) {
    out.denseOrMoe = "moe";
  } else if (/(?:^|[-_/])moe(?:[-_/]|$)/i.test(lower) || /[-_/]a\d+b/.test(lower)) {
    out.denseOrMoe = "moe";
  } else if (out.parameterCount != null) {
    // Heuristic: most common name patterns without an "a<n>b" are dense.
    out.denseOrMoe = "dense";
  }

  // ── Quantization ──
  // Order matters — match more-specific patterns first.
  const quantPatterns: { rx: RegExp; label: string; precision?: string }[] = [
    { rx: /nvfp4/i, label: "NVFP4", precision: "fp4" },
    { rx: /[-_/]fp4(?:[-_/]|$)/i, label: "FP4", precision: "fp4" },
    { rx: /fp8[-_]?(?:e4m3|e5m2)?/i, label: "FP8", precision: "fp8" },
    // INT4 family — by-scheme labels first so we don't mis-tag a model that
    // says "awq-int4" as plain "INT4".
    { rx: /[-_/](?:gptq)(?:[-_/]|$)/i, label: "GPTQ", precision: "int4" },
    { rx: /[-_/](?:awq)(?:[-_/]|$)/i, label: "AWQ", precision: "int4" },
    {
      rx: /(?:^|[-_/])auto[-_]?round(?:[-_/]|$)/i,
      label: "AutoRound",
      precision: "int4",
    },
    { rx: /int4/i, label: "INT4", precision: "int4" },
    { rx: /int8/i, label: "INT8", precision: "int8" },
    { rx: /\bq([2-8])_k(?:_[smla])?\b/i, label: null as unknown as string },
    { rx: /\bq([2-8])_(\d)\b/i, label: null as unknown as string },
    { rx: /[-_/]bf16(?:[-_/]|$)/i, label: "BF16", precision: "bf16" },
    { rx: /[-_/]fp16(?:[-_/]|$)/i, label: "FP16", precision: "fp16" },
    { rx: /[-_/]fp32(?:[-_/]|$)/i, label: "FP32", precision: "fp32" },
  ];
  for (const p of quantPatterns) {
    const m = lower.match(p.rx);
    if (m) {
      if (p.label) {
        out.quantization = p.label;
        if (p.precision) out.precision = p.precision;
      } else {
        // Q*_K* / Q*_* GGUF flavors — preserve the matched form upper-cased.
        out.quantization = m[0].toUpperCase();
        out.precision = "int4"; // close enough for GGUF Q-family
      }
      break;
    }
  }

  // ── Format ──
  if (/\.gguf$|[-_/]gguf(?:[-_/]|$)/i.test(name)) out.format = "gguf";
  else if (/[-_/]safetensors(?:[-_/]|$)/i.test(name)) out.format = "safetensors";

  return out;
}
