import type { OutputTokenSource } from "./metrics";
import type { RequestResult } from "./request";

/**
 * Collapse per-request token sources into one verdict for the level. The
 * weakest provenance wins: any `unknown` makes the level unknown; otherwise
 * any `estimated` makes it estimated; only all-`server_usage` is server_usage.
 */
function rollupTokenSource(
  sources: OutputTokenSource[],
): OutputTokenSource {
  if (sources.length === 0) return "unknown";
  if (sources.some((s) => s === "unknown")) return "unknown";
  if (sources.some((s) => s === "estimated")) return "estimated";
  return "server_usage";
}

export interface LevelAggregate {
  streamLevel: number;
  requestCount: number;
  successfulRequests: number;
  failedRequests: number;
  failureRate: number;

  outputTokensPerSecond: number | null;
  totalTokensPerSecond: number | null;
  prefillTokensPerSecond: number | null;
  requestsPerSecond: number;

  p50TtftMs: number | null;
  p95TtftMs: number | null;
  p99TtftMs: number | null;
  p50TpotMs: number | null;
  p95TpotMs: number | null;
  p99TpotMs: number | null;

  /**
   * vLLM-compatible token-normalized TPOT percentiles. Always computed (when a
   * token count is available) regardless of benchmark mode — this is the
   * family safe to compare against `vllm bench serve`.
   */
  p50TpotVllmCompatMs: number | null;
  p95TpotVllmCompatMs: number | null;
  p99TpotVllmCompatMs: number | null;
  /**
   * BenchTrace-native mean chunk-gap latency percentiles. NOT token-normalized;
   * never compare directly to vLLM TPOT.
   */
  p50ChunkGapMs: number | null;
  p95ChunkGapMs: number | null;
  p99ChunkGapMs: number | null;
  /** Mean content chunks per successful request. */
  meanChunksPerRequest: number | null;
  /** Mean tokens per chunk (MTP / speculative packing factor). */
  meanTokensPerChunk: number | null;
  /** Weakest output-token provenance across the level's requests. */
  outputTokenCountSource: OutputTokenSource;

  p50ItlMs: number | null;
  p95ItlMs: number | null;
  p99ItlMs: number | null;
  p50E2eLatencyMs: number | null;
  p95E2eLatencyMs: number | null;
  p99E2eLatencyMs: number | null;

  /** GPU telemetry, populated by the sweep loop from nvidia-smi samples. */
  peakVramGb: number | null;
  averageVramGb: number | null;
  gpuUtilizationAvg: number | null;
  gpuUtilizationPeak: number | null;
  powerDrawWattsAvg: number | null;
  powerDrawWattsPeak: number | null;
  gpuTemperatureAvg: number | null;
  gpuTemperaturePeak: number | null;
  tokensPerWatt: number | null;

  /** Wall-clock seconds covering the level. */
  durationSeconds: number;
  /** True if level passed all three SLAs (ttft, tpot, failure). */
  isValid: boolean;
  meetsTtftSla: boolean;
  meetsTpotSla: boolean;
  meetsFailureSla: boolean;
  invalidReasons: string[];
}

export interface SweepResult {
  perLevel: LevelAggregate[];
  bestOutputTokensPerSecond: number | null;
  bestTotalTokensPerSecond: number | null;
  bestPrefillTokensPerSecond: number | null;
  maxValidConcurrency: number | null;
  outputTpsAtMaxValid: number | null;
  p95TtftAtMaxValid: number | null;
  p95TpotAtMaxValid: number | null;
  invalidLevels: { streamLevel: number; reasons: string[] }[];
  warnings: string[];
  /** Total wall-clock seconds, summed across all levels. */
  totalDurationSeconds: number;
}

export interface SlaThresholds {
  ttftSlaMs: number;
  tpotSlaMs: number;
  failureThreshold: number;
}

/**
 * p ∈ [0,1]. Linear interpolation between order statistics. Returns null
 * for empty input.
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  if (values.length === 1) return values[0]!;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

export function aggregateLevel(
  streamLevel: number,
  results: RequestResult[],
  thresholds: SlaThresholds,
  wallClockStartMs: number,
  wallClockEndMs: number,
): LevelAggregate {
  const successes = results.filter((r) => r.success);
  const failed = results.length - successes.length;
  const failureRate = results.length > 0 ? failed / results.length : 0;
  const durationSeconds = Math.max(0, (wallClockEndMs - wallClockStartMs) / 1000);

  const ttft = successes
    .map((r) => r.ttftMs)
    .filter((v): v is number => v != null);
  const tpot = successes
    .map((r) => r.tpotMs)
    .filter((v): v is number => v != null);
  const tpotVllm = successes
    .map((r) => r.tpotMsVllmCompat)
    .filter((v): v is number => v != null);
  const chunkGap = successes
    .map((r) => r.meanChunkGapMs)
    .filter((v): v is number => v != null);
  const chunksPerReq = successes
    .map((r) => r.chunkCount)
    .filter((v): v is number => v != null && v > 0);
  const tokensPerChunkVals = successes
    .map((r) => r.tokensPerChunk)
    .filter((v): v is number => v != null);
  const itl = successes.flatMap((r) => r.interTokenLatenciesMs);
  const e2e = successes.map((r) => r.e2eLatencyMs);
  const mean = (xs: number[]): number | null =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

  const totalOutputTokens = successes
    .map((r) => r.outputTokens ?? 0)
    .reduce((a, b) => a + b, 0);
  const totalInputTokens = successes
    .map((r) => r.inputTokens ?? 0)
    .reduce((a, b) => a + b, 0);

  // Prefill rate uses sum form: sum(input_tokens) / sum(TTFT_seconds)
  // — matches how vllm bench_serve.py aggregates and is more stable than
  // mean-of-ratios when individual TTFTs vary. CRITICAL: both sums must
  // be over the SAME subset (requests where inputTokens is known);
  // otherwise null-input requests inflate the TTFT denominator and
  // under-report the rate.
  const requestsWithInputTokens = successes.filter(
    (r) => r.inputTokens != null,
  );
  const prefillInputTokensSum = requestsWithInputTokens
    .map((r) => r.inputTokens!)
    .reduce((a, b) => a + b, 0);
  const prefillTtftSecondsSum = requestsWithInputTokens
    .map((r) => (r.ttftMs ?? 0) / 1000)
    .reduce((a, b) => a + b, 0);

  const outputTokensPerSecond =
    durationSeconds > 0 && totalOutputTokens > 0
      ? totalOutputTokens / durationSeconds
      : null;
  const totalTokensPerSecond =
    durationSeconds > 0 && totalInputTokens > 0 && totalOutputTokens > 0
      ? (totalInputTokens + totalOutputTokens) / durationSeconds
      : null;

  const p95Ttft = percentile(ttft, 0.95);
  const p95Tpot = percentile(tpot, 0.95);

  const meetsTtftSla =
    p95Ttft == null ? successes.length === 0 ? false : true : p95Ttft <= thresholds.ttftSlaMs;
  const meetsTpotSla =
    p95Tpot == null ? successes.length === 0 ? false : true : p95Tpot <= thresholds.tpotSlaMs;
  const meetsFailureSla = failureRate <= thresholds.failureThreshold;

  const invalidReasons: string[] = [];
  if (!meetsFailureSla)
    invalidReasons.push(
      `failure_rate ${(failureRate * 100).toFixed(1)}% > ${(thresholds.failureThreshold * 100).toFixed(0)}%`,
    );
  if (!meetsTtftSla && p95Ttft != null)
    invalidReasons.push(`p95_ttft_ms ${p95Ttft.toFixed(0)} > ${thresholds.ttftSlaMs}`);
  if (!meetsTpotSla && p95Tpot != null)
    invalidReasons.push(`p95_tpot_ms ${p95Tpot.toFixed(1)} > ${thresholds.tpotSlaMs}`);
  if (successes.length === 0) invalidReasons.push("no_successful_requests");

  const isValid = invalidReasons.length === 0;

  return {
    streamLevel,
    requestCount: results.length,
    successfulRequests: successes.length,
    failedRequests: failed,
    failureRate,
    outputTokensPerSecond,
    totalTokensPerSecond,
    prefillTokensPerSecond:
      prefillInputTokensSum > 0 && prefillTtftSecondsSum > 0
        ? prefillInputTokensSum / prefillTtftSecondsSum
        : null,
    requestsPerSecond:
      durationSeconds > 0 ? successes.length / durationSeconds : 0,
    p50TtftMs: percentile(ttft, 0.5),
    p95TtftMs: p95Ttft,
    p99TtftMs: percentile(ttft, 0.99),
    p50TpotMs: percentile(tpot, 0.5),
    p95TpotMs: p95Tpot,
    p99TpotMs: percentile(tpot, 0.99),
    p50TpotVllmCompatMs: percentile(tpotVllm, 0.5),
    p95TpotVllmCompatMs: percentile(tpotVllm, 0.95),
    p99TpotVllmCompatMs: percentile(tpotVllm, 0.99),
    p50ChunkGapMs: percentile(chunkGap, 0.5),
    p95ChunkGapMs: percentile(chunkGap, 0.95),
    p99ChunkGapMs: percentile(chunkGap, 0.99),
    meanChunksPerRequest: mean(chunksPerReq),
    meanTokensPerChunk: mean(tokensPerChunkVals),
    outputTokenCountSource: rollupTokenSource(
      successes.map((r) => r.outputTokenCountSource),
    ),
    p50ItlMs: percentile(itl, 0.5),
    p95ItlMs: percentile(itl, 0.95),
    p99ItlMs: percentile(itl, 0.99),
    p50E2eLatencyMs: percentile(e2e, 0.5),
    p95E2eLatencyMs: percentile(e2e, 0.95),
    p99E2eLatencyMs: percentile(e2e, 0.99),
    peakVramGb: null,
    averageVramGb: null,
    gpuUtilizationAvg: null,
    gpuUtilizationPeak: null,
    powerDrawWattsAvg: null,
    powerDrawWattsPeak: null,
    gpuTemperatureAvg: null,
    gpuTemperaturePeak: null,
    tokensPerWatt: null,
    durationSeconds,
    isValid,
    meetsTtftSla,
    meetsTpotSla,
    meetsFailureSla,
    invalidReasons,
  };
}

export function rollupSweep(perLevel: LevelAggregate[]): SweepResult {
  const bestOutput = bestOf(perLevel, (l) => l.outputTokensPerSecond);
  const bestTotal = bestOf(perLevel, (l) => l.totalTokensPerSecond);

  // Highest valid level
  const validDesc = [...perLevel]
    .filter((l) => l.isValid)
    .sort((a, b) => b.streamLevel - a.streamLevel);
  const maxValid = validDesc[0] ?? null;

  const warnings: string[] = [];
  if (!maxValid) warnings.push("no_valid_concurrency_level");
  for (const lvl of perLevel) {
    if (lvl.failedRequests > 0 && lvl.successfulRequests === 0) {
      warnings.push(`level_${lvl.streamLevel}_all_failed`);
    }
  }

  const totalDurationSeconds = perLevel.reduce(
    (acc, l) => acc + l.durationSeconds,
    0,
  );

  return {
    perLevel,
    bestOutputTokensPerSecond: bestOutput,
    bestTotalTokensPerSecond: bestTotal,
    bestPrefillTokensPerSecond: bestOf(perLevel, (l) => l.prefillTokensPerSecond),
    maxValidConcurrency: maxValid?.streamLevel ?? null,
    outputTpsAtMaxValid: maxValid?.outputTokensPerSecond ?? null,
    p95TtftAtMaxValid: maxValid?.p95TtftMs ?? null,
    p95TpotAtMaxValid: maxValid?.p95TpotMs ?? null,
    invalidLevels: perLevel
      .filter((l) => !l.isValid)
      .map((l) => ({ streamLevel: l.streamLevel, reasons: l.invalidReasons })),
    warnings,
    totalDurationSeconds,
  };
}

function bestOf(
  levels: LevelAggregate[],
  pick: (l: LevelAggregate) => number | null,
): number | null {
  let best: number | null = null;
  for (const lvl of levels) {
    const v = pick(lvl);
    if (v != null && (best == null || v > best)) best = v;
  }
  return best;
}
