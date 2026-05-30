/**
 * vLLM-compatible random-token prompt generator.
 *
 * Mirrors `vllm/benchmarks/datasets.py::RandomDataset.sample()` exactly enough
 * to produce throughput numbers that compare apples-to-apples with
 * `vllm bench serve --dataset-name random`.
 *
 * The trick: sample random token IDs from the tokenizer's vocab, decode them
 * to text, and send the decoded text as the prompt. This defeats speculative
 * decoding acceptance (random IDs are gibberish to the model) and matches the
 * input-token distribution vLLM produces.
 *
 * We don't bundle a tokenizer client-side. Instead we call the server's
 * `/detokenize` endpoint (standard on vLLM, SGLang, llama.cpp server) to
 * convert random token IDs to text. One up-front network round-trip per
 * prompt; tiny compared to actual benchmark cost.
 *
 * Fallback: if the server doesn't expose `/detokenize`, callers should catch
 * the thrown error and degrade to the synthetic word-bank corpus.
 */

import type { RandomTokenMetadata } from "@/lib/schemas/repro-json";

/** Conservative cap when the real tokenizer vocab size is unknown. */
const FALLBACK_VOCAB = 100_000;
/** Bump when the sampling algorithm changes in a way that alters bytes. */
const SAMPLER_VERSION = "mulberry32-uniform-v1";

function joinUrl(base: string, endpoint: string): string {
  return base.replace(/\/+$/, "") + "/" + endpoint.replace(/^\/+/, "");
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RandomTokenOptions {
  baseUrl: string;
  model: string;
  apiKey: string | null;
  seed: number;
  count: number;
  /** Target input length in tokens. */
  inputLen: number;
  /**
   * Length variation as a fraction of inputLen. With rangeRatio=0 every
   * prompt is exactly inputLen tokens. With 0.1, each prompt's length is
   * sampled uniformly from [inputLen·0.9, inputLen·1.1].
   * Matches vLLM's `--random-range-ratio`.
   */
  rangeRatio?: number;
  /**
   * Common prefix prepended to every prompt, in tokens. Matches vLLM's
   * `--random-prefix-len`. Default 0.
   */
  prefixLen?: number;
  /**
   * The real tokenizer vocab size, when known (e.g. from config.json's
   * `vocab_size`). In `vllm-compatible` mode this is used as the sampling
   * upper bound so the input-token distribution matches vLLM's RandomDataset.
   */
  vocabSize?: number;
  /**
   * `benchtrace`      → conservative cap (FALLBACK_VOCAB) so sampled IDs stay
   *                     valid for every modern tokenizer. Historical default.
   * `vllm-compatible` → sample across the full real vocab (vocabSize),
   *                     matching `vllm bench serve --dataset-name random`.
   */
  vocabMode?: "benchtrace" | "vllm-compatible";
  /** Where vocabSize came from, recorded in metadata ("config", "server_probe", …). */
  tokenizerSource?: string | null;
}

export interface RandomTokenResult {
  prompts: string[];
  metadata: RandomTokenMetadata;
}

export async function generateRandomTokenPrompts(
  opts: RandomTokenOptions,
): Promise<RandomTokenResult> {
  const rng = mulberry32(opts.seed);
  const rangeRatio = opts.rangeRatio ?? 0;
  const prefixLen = opts.prefixLen ?? 0;
  const mode = opts.vocabMode ?? "benchtrace";

  // Resolve the sampling vocab. vLLM-compatible mode wants the real vocab so
  // the random-ID distribution matches; if we don't actually know it we fall
  // back but record `fallback` so comparison_validity won't claim parity.
  const hasRealVocab = typeof opts.vocabSize === "number" && opts.vocabSize > 0;
  let vocab: number;
  let tokenizerSource: string;
  if (mode === "vllm-compatible") {
    vocab = hasRealVocab ? opts.vocabSize! : FALLBACK_VOCAB;
    tokenizerSource = hasRealVocab ? opts.tokenizerSource ?? "config" : "fallback";
  } else {
    vocab = FALLBACK_VOCAB;
    tokenizerSource = "fallback";
  }

  // Shared prefix, sampled once and reused. Matches vLLM behavior.
  const prefixIds: number[] = [];
  for (let i = 0; i < prefixLen; i++) {
    prefixIds.push(Math.floor(rng() * vocab));
  }

  const lo = Math.max(1, Math.floor(opts.inputLen * (1 - rangeRatio)));
  const hi = Math.floor(opts.inputLen * (1 + rangeRatio));

  const prompts: string[] = [];
  for (let i = 0; i < opts.count; i++) {
    const target =
      rangeRatio > 0 && hi > lo
        ? lo + Math.floor(rng() * (hi - lo + 1))
        : opts.inputLen;
    const ids: number[] = prefixIds.slice();
    for (let k = 0; k < target; k++) {
      ids.push(Math.floor(rng() * vocab));
    }
    prompts.push(await detokenize(opts.baseUrl, opts.model, opts.apiKey, ids));
  }

  const metadata: RandomTokenMetadata = {
    mode,
    vocab_size: vocab,
    token_id_min: 0,
    token_id_max: vocab - 1,
    // We sample uniformly over [0, vocab) without excluding special-token ids,
    // mirroring vLLM's RandomDataset (which also does not filter them out).
    special_token_policy: "included",
    tokenizer_source: tokenizerSource,
    detokenize_method: "server_detokenize",
    random_seed: opts.seed,
    random_token_sampler_version: SAMPLER_VERSION,
  };
  return { prompts, metadata };
}

async function detokenize(
  baseUrl: string,
  model: string,
  apiKey: string | null,
  tokens: number[],
): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const url = joinUrl(baseUrl, "/detokenize");
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, tokens }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `random-tokens dataset requires server /detokenize endpoint. ` +
        `${url} returned HTTP ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`,
    );
  }
  const json = (await res.json()) as { prompt?: string; text?: string };
  // vLLM returns {prompt}; some forks return {text}.
  const out = json.prompt ?? json.text;
  if (typeof out !== "string") {
    throw new Error(
      `/detokenize returned unexpected payload (no prompt/text field)`,
    );
  }
  return out;
}
