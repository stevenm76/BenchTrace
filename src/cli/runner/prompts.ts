/**
 * Prompt-pool builder. Two backends:
 *   1. synthetic — deterministic word-bank, fixed token target. Default,
 *      no consent needed, reproducible from seed alone.
 *   2. sharegpt  — sample real conversations from the cached ShareGPT
 *      corpus. Matches vLLM bench_serve.py's prompt distribution so
 *      throughput numbers compare apples-to-apples.
 *
 * Both produce a flat string[] the caller passes one-at-a-time to the
 * request layer. Same seed + same backend = same prompt order.
 */

import type { RandomTokenMetadata } from "@/lib/schemas/repro-json";

import {
  generateRandomTokenPrompts,
  type RandomTokenOptions,
} from "./prompts-random-tokens";
import {
  ensureShareGptCorpus,
  sampleShareGptPrompts,
} from "./sharegpt";

const WORD_BANK = [
  "the","quick","brown","fox","jumps","over","lazy","dog","performance","trace",
  "benchmark","throughput","latency","tokens","second","cluster","prefill","decode",
  "concurrent","stream","request","response","engine","loader","kernel","operator",
  "memory","cache","tensor","parallel","speculative","draft","prefix","kv","fp8",
  "nvfp4","awq","quantization","dtype","attention","flash","backend","model",
  "context","window","sequence","attention","layer","head","embedding","rotary",
  "scaling","accuracy","reliability","reproducibility","artifact","verification",
  "evidence","missing","captured","unavailable","unknown","redacted","local",
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mix(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export function syntheticPrompt(
  globalSeed: number,
  idx: number,
  approxTokens: number,
): string {
  const rng = mulberry32(mix(globalSeed, idx));
  const targetWords = Math.max(8, Math.round(approxTokens / 0.75));
  const out: string[] = [];
  out.push(`prompt-${idx}:`);
  for (let i = 0; i < targetWords; i++) {
    const word = WORD_BANK[Math.floor(rng() * WORD_BANK.length)]!;
    out.push(word);
  }
  return out.join(" ") + ".";
}

export type Dataset = "synthetic" | "sharegpt" | "random-tokens";

export interface PromptPoolOptions {
  dataset: Dataset;
  seed: number;
  count: number;
  /** Used by synthetic + random-tokens; ignored for sharegpt. */
  approxTokens: number;
  /**
   * Server connection details — required for `random-tokens`, ignored for
   * the other datasets. The random-tokens generator calls the server's
   * /detokenize endpoint to convert sampled token IDs to text.
   */
  server?: Omit<RandomTokenOptions, "seed" | "count" | "inputLen">;
}

export interface PromptPool {
  dataset: Dataset;
  prompts: string[];
  /** Human-readable description that goes into the share doc's prompt_source. */
  source: string;
  /** Present only for the random-tokens dataset; drives comparison_validity. */
  randomTokenMetadata?: RandomTokenMetadata | null;
}

export async function generatePromptPool(
  options: PromptPoolOptions,
): Promise<PromptPool> {
  if (options.dataset === "sharegpt") {
    const corpus = await ensureShareGptCorpus();
    const prompts = await sampleShareGptPrompts(corpus, options.count, options.seed);
    return {
      dataset: "sharegpt",
      prompts,
      source: `sharegpt(seed=${options.seed}, file=${corpus})`,
    };
  }
  if (options.dataset === "random-tokens") {
    if (!options.server) {
      throw new Error(
        "random-tokens dataset requires server connection details (baseUrl/model)",
      );
    }
    const { prompts, metadata } = await generateRandomTokenPrompts({
      ...options.server,
      seed: options.seed,
      count: options.count,
      inputLen: options.approxTokens,
    });
    const range = options.server.rangeRatio ?? 0;
    return {
      dataset: "random-tokens",
      prompts,
      source:
        `random-tokens(seed=${options.seed}, inputLen=${options.approxTokens}, ` +
        `rangeRatio=${range}, vocab=${metadata.vocab_size}, ` +
        `mode=${metadata.mode}, vocabSource=${metadata.tokenizer_source}, via=/detokenize)`,
      randomTokenMetadata: metadata,
    };
  }
  const prompts: string[] = [];
  for (let i = 0; i < options.count; i++) {
    prompts.push(syntheticPrompt(options.seed, i, options.approxTokens));
  }
  return {
    dataset: "synthetic",
    prompts,
    source: `mulberry32(seed=${options.seed})`,
  };
}

/** Backwards-compat: many older callers still expect a plain string[]. */
export function generatePrompts(
  globalSeed: number,
  count: number,
  approxTokens: number,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(syntheticPrompt(globalSeed, i, approxTokens));
  }
  return out;
}
