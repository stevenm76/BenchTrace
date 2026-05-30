// src/cli/runner/prompt-source.ts
/**
 * Aligned-mode prompt source. Produces raw token-ID prompts (sent directly to
 * /v1/completions — no /detokenize round-trip, which is what perturbed the
 * token sequence and skewed speculative-decode acceptance in the old path).
 *
 * Two modes:
 *  - independent: seeded RNG samples ids over the real vocab.
 *  - replay:      uses the exact token-id arrays captured from a vLLM run, for
 *                 byte-identical spec-decode acceptance.
 */

import { createHash } from "node:crypto";

export interface AlignedPrompt {
  /** Token-id wire prompt; empty array when this is a text prompt. */
  tokenIds: number[];
  /** Decoded-string wire prompt; null when this is a token-id prompt. */
  text: string | null;
  hash: string;
  requestedOutputLen: number;
}

export interface AlignedPromptSet {
  prompts: AlignedPrompt[];
}

export interface IndependentOptions {
  mode: "independent";
  seed: number;
  count: number;
  inputLen: number;
  vocabSize: number;
  outputLen: number;
}

export interface ReplayOptions {
  mode: "replay";
  /**
   * Each entry replays either an exact token-id array OR an exact decoded
   * string (vLLM's `random`/`sharegpt` datasets send strings on the wire).
   * Exactly one of `tokenIds`/`text` should be set per entry.
   */
  reference: { tokenIds?: number[]; text?: string; outputLen: number }[];
}

export type PromptSourceOptions = IndependentOptions | ReplayOptions;

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

/**
 * Resolve the effective tokenizer vocab size and where it came from. An
 * explicit CLI `--vocab-size` wins over the probed model config; this lets a
 * run match vLLM's full-vocab random sampling even when config.json is
 * unreadable from the host/container. Returns vocabSize=null when neither
 * source is available (callers fall back to a conservative cap).
 */
export function resolveEffectiveVocab(
  override: number | null | undefined,
  configVocab: number | null | undefined,
): { vocabSize: number | null; tokenizerSource: string | null } {
  if (typeof override === "number" && override > 0) {
    return { vocabSize: override, tokenizerSource: "cli-override" };
  }
  if (typeof configVocab === "number" && configVocab > 0) {
    return { vocabSize: configVocab, tokenizerSource: "config" };
  }
  return { vocabSize: null, tokenizerSource: null };
}

export function hashTokenIds(ids: number[]): string {
  return createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 16);
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function buildAlignedPrompts(opts: PromptSourceOptions): AlignedPromptSet {
  if (opts.mode === "replay") {
    return {
      prompts: opts.reference.map((r) => {
        if (r.text != null) {
          return {
            tokenIds: [],
            text: r.text,
            hash: hashText(r.text),
            requestedOutputLen: r.outputLen,
          };
        }
        const ids = r.tokenIds ?? [];
        return {
          tokenIds: ids,
          text: null,
          hash: hashTokenIds(ids),
          requestedOutputLen: r.outputLen,
        };
      }),
    };
  }
  const rng = mulberry32(opts.seed);
  const prompts: AlignedPrompt[] = [];
  for (let i = 0; i < opts.count; i++) {
    const ids: number[] = [];
    for (let k = 0; k < opts.inputLen; k++) {
      ids.push(Math.floor(rng() * opts.vocabSize));
    }
    prompts.push({
      tokenIds: ids,
      text: null,
      hash: hashTokenIds(ids),
      requestedOutputLen: opts.outputLen,
    });
  }
  return { prompts };
}
