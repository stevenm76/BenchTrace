import type { BenchmarkProfileDefinition } from "@/lib/benchmark-profiles";

import type { LevelAggregate, SweepResult } from "./aggregate";

/**
 * Per-profile one-line summary shown in the CLI banner at sweep
 * completion + assembled into the trace name. Each `workloadType` in
 * BENCHMARK_PROFILES gets its own format reflecting what that profile
 * actually measures: TTFT for chat, prefill/decode split for code,
 * total throughput for batch, etc.
 */
export function formatProfileHeadline(
  profile: BenchmarkProfileDefinition,
  sweep: SweepResult,
): string {
  const best = pickHeadlineLevel(profile, sweep);
  if (!best) return "no levels completed";

  const okTotal = `${sumSuccessful(sweep)}/${sumRequests(sweep)} ok`;

  switch (profile.workloadType) {
    case "single_user":
      return `${fmt(best.p95TtftMs, 0)} ms TTFT p95 · ${fmt(best.outputTokensPerSecond, 1)} tok/s @ c=${best.streamLevel} · ${okTotal}`;
    case "coding_agent":
      return `prefill ${fmt(best.prefillTokensPerSecond, 0)} tok/s · decode ${fmt(best.outputTokensPerSecond, 1)} tok/s @ c=${best.streamLevel} · ${okTotal}`;
    case "batch":
      return `total ${fmt(best.totalTokensPerSecond, 1)} tok/s @ c=${best.streamLevel} · ${okTotal} · failure_rate ${pct(best.failureRate)}`;
    case "long_context":
      return `prefill ${fmt(best.prefillTokensPerSecond, 0)} tok/s · decode ${fmt(best.outputTokensPerSecond, 1)} tok/s · peak VRAM ${fmt(best.peakVramGb, 1)} GB · ${okTotal}`;
    case "serving":
      return `max valid = ${sweep.maxValidConcurrency ?? "(none)"} · ${fmt(best.outputTokensPerSecond, 1)} tok/s @ c=${best.streamLevel} · ${okTotal}`;
    case "prefill_decode_split":
      return `prefill ${fmt(best.prefillTokensPerSecond, 0)} tok/s · decode ${fmt(best.outputTokensPerSecond, 1)} tok/s @ c=${best.streamLevel} · ${okTotal}`;
    default: {
      // Exhaustiveness check: if a new workloadType is added to the
      // BenchmarkProfileDefinition union without a case here,
      // TypeScript will fail to compile this line.
      const _exhaustive: never = profile.workloadType;
      return _exhaustive;
    }
  }
}

/**
 * Concurrency label for the trace name. Single level → "c=8".
 * Sweep range → "c=1-8". Sorts unordered input. Empty → "c=?".
 */
export function formatConcurrencyLabel(streams: number[]): string {
  if (streams.length === 0) return "c=?";
  if (streams.length === 1) return `c=${streams[0]}`;
  const sorted = [...streams].sort((a, b) => a - b);
  return `c=${sorted[0]}-${sorted[sorted.length - 1]}`;
}

/**
 * For serving profiles: pick the level whose streamLevel matches
 * `sweep.maxValidConcurrency` (the SLA-passing winner). For everything
 * else (or when no level passed SLA): the first level in the sweep.
 * Returns null if the sweep has zero levels.
 */
export function pickHeadlineLevel(
  profile: BenchmarkProfileDefinition,
  sweep: SweepResult,
): LevelAggregate | null {
  if (sweep.perLevel.length === 0) return null;
  if (
    profile.workloadType === "serving" &&
    sweep.maxValidConcurrency != null
  ) {
    const match = sweep.perLevel.find(
      (l) => l.streamLevel === sweep.maxValidConcurrency,
    );
    if (match) return match;
  }
  return sweep.perLevel[0]!;
}

function sumSuccessful(sweep: SweepResult): number {
  return sweep.perLevel.reduce((a, l) => a + l.successfulRequests, 0);
}

function sumRequests(sweep: SweepResult): number {
  return sweep.perLevel.reduce((a, l) => a + l.requestCount, 0);
}

function fmt(value: number | null, decimals: number): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(decimals);
}

function pct(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return (rate * 100).toFixed(1) + "%";
}
