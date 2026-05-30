/**
 * Per-request metric calculations, mode-aware.
 *
 * Lives here (not in aggregate.ts) so it can be unit-tested in isolation
 * and so request.ts doesn't grow a switch every time a vllm-parity
 * tweak lands. See docs/parity/vllm-parity-report.md and the plan at
 * ~/.claude/plans/indexed-chasing-bonbon.md for context.
 */

export type BenchmarkMode = "native" | "vllm-compatible";

/**
 * Which metric family (or families) a run reports as its headline numbers.
 * `both` computes and emits native chunk-gap AND vLLM-compatible TPOT side by
 * side. The per-request math always computes both regardless of this setting;
 * `metricMode` only controls which family is treated as the headline and how
 * comparison guardrails behave.
 */
export type MetricMode = "native" | "vllm-compatible" | "both";

/**
 * Provenance of a request's output-token count. This is the single most
 * important field for judging whether a token-normalized metric (vLLM TPOT,
 * output throughput) is trustworthy:
 *   - `server_usage`: from `usage.completion_tokens` — authoritative.
 *   - `estimated`:    fell back to the request's `max_tokens` (only legitimate
 *                     when `ignore_eos=true`, so the server is bound to emit
 *                     exactly that many tokens).
 *   - `unknown`:      no count available (native mode, no usage chunk).
 */
export type OutputTokenSource = "server_usage" | "estimated" | "unknown";

export interface TpotInputs {
  /** End-to-end latency, ms. */
  e2eMs: number;
  /** Time to first token, ms. Null when the request never produced a first token. */
  ttftMs: number | null;
  /** Generated token count, from server `usage.completion_tokens`. */
  outputTokens: number | null;
  /** Inter-arrival gaps between content chunks, ms. Length = chunks - 1. */
  chunkGapsMs: number[];
}

export interface OutputTokensInputs {
  mode: BenchmarkMode;
  /** Server-reported `usage.completion_tokens`, or null if the server omitted it. */
  fromUsage: number | null;
  /**
   * The request's `max_tokens`. Only used as a fallback in vllm-compatible
   * mode when `ignore_eos` is on and usage is missing — vLLM treats the
   * fixed-length output as authoritative in that case.
   */
  expected: number;
}

/**
 * Resolve the per-request output-token count.
 *
 * Precedence:
 *   1. Server `usage.completion_tokens` (always preferred when present).
 *   2. `expected` (request max_tokens) — only in vllm-compatible mode,
 *      where the standard workflow runs with `ignore_eos=true` so the
 *      server is bound to produce exactly that many tokens.
 *   3. null — native mode never invents a count.
 *
 * The tokenizer-re-encode tier from vLLM's precedence isn't wired here
 * (BenchTrace doesn't bundle a tokenizer); we instead lean on
 * `ignore_eos` to make `expected` an honest answer.
 */
export function resolveOutputTokens(r: OutputTokensInputs): number | null {
  if (r.fromUsage != null) return r.fromUsage;
  if (r.mode === "vllm-compatible") return r.expected;
  return null;
}

/**
 * Classify where the resolved output-token count came from. Mirrors the
 * precedence in {@link resolveOutputTokens} so the share doc can record, per
 * run, whether token-normalized metrics rest on server truth or an estimate.
 */
export function resolveOutputTokenSource(r: OutputTokensInputs): OutputTokenSource {
  if (r.fromUsage != null) return "server_usage";
  if (r.mode === "vllm-compatible") return "estimated";
  return "unknown";
}

/**
 * BenchTrace-native "mean chunk-gap latency": the arithmetic mean of the
 * inter-arrival gaps between successive content chunks. This is NOT a
 * token-normalized TPOT — when a server packs multiple tokens per SSE chunk
 * (e.g. MTP / speculative decoding) the chunk-gap is N× the true per-token
 * decode time. Reported under its own honest name; never compared directly to
 * vLLM's TPOT. Returns null when there are no gaps (≤1 chunk).
 */
export function computeMeanChunkGapMs(chunkGapsMs: number[]): number | null {
  if (chunkGapsMs.length === 0) return null;
  return chunkGapsMs.reduce((a, b) => a + b, 0) / chunkGapsMs.length;
}

/**
 * vLLM-compatible TPOT: `(e2e - ttft) / max(1, outputTokens - 1)`, token-
 * normalized so it is invariant to how the server packs tokens into chunks.
 * Returns 0 when `outputTokens ≤ 1`, null when ttft or the token count is
 * unavailable. Matches `calculate_metrics` in `vllm/benchmarks/serve.py`.
 */
export function computeVllmCompatTpotMs(r: {
  e2eMs: number;
  ttftMs: number | null;
  outputTokens: number | null;
}): number | null {
  if (r.ttftMs == null || r.outputTokens == null) return null;
  if (r.outputTokens <= 1) return 0;
  return (r.e2eMs - r.ttftMs) / (r.outputTokens - 1);
}

/**
 * TPOT (time per output token, excluding the first token).
 *
 * `vllm-compatible`: `(e2e - ttft) / max(1, outputTokens - 1)`. Returns 0
 * when `outputTokens ≤ 1`. Matches vLLM's `calculate_metrics` in
 * `vllm/benchmarks/serve.py`. Returns null when ttftMs or outputTokens
 * are unavailable.
 *
 * `native`: arithmetic mean of per-chunk inter-arrival gaps (BenchTrace
 * historical behavior). Returns null when there are no gaps.
 */
export function computeTpotMs(
  mode: BenchmarkMode,
  r: TpotInputs,
): number | null {
  if (mode === "vllm-compatible") {
    return computeVllmCompatTpotMs(r);
  }
  return computeMeanChunkGapMs(r.chunkGapsMs);
}
