import {
  BENCHMARK_PROFILES,
  type BenchmarkProfileDefinition,
} from "@/lib/benchmark-profiles";
import type { TraceListRow } from "@/lib/db/queries/traces";

export interface ProfileRanking {
  profile: BenchmarkProfileDefinition;
  /** Traces sorted best-first against the profile's primary metric. */
  ranked: ProfileRankedTrace[];
}

export interface ProfileRankedTrace {
  trace: TraceListRow;
  /** The primary score used to sort. */
  primaryScore: number | null;
  /** Per-metric snapshot used in the ranking row. */
  metrics: {
    outputTokensPerSecond: number | null;
    prefillTokensPerSecond: number | null;
    p95TtftMs: number | null;
    p95TpotMs: number | null;
    peakVramGb: number | null;
    maxConcurrency: number | null;
    failureRate: number | null;
  };
  /** Why this trace ranks where it does. */
  reason: string;
}

/** Best metric point for a given key per trace. */
function bestForKey(
  trace: TraceListRow,
  pick: (m: TraceListRow["metricPoints"][number]) => number | null,
  betterWhen: "high" | "low",
): { point: TraceListRow["metricPoints"][number]; value: number } | null {
  const candidates = trace.metricPoints
    .map((m) => ({ point: m, value: pick(m) }))
    .filter((x): x is { point: TraceListRow["metricPoints"][number]; value: number } =>
      typeof x.value === "number",
    );
  if (candidates.length === 0) return null;
  return candidates.reduce((b, c) =>
    betterWhen === "high"
      ? c.value > b.value
        ? c
        : b
      : c.value < b.value
        ? c
        : b,
  );
}

function maxConcurrencyForTrace(trace: TraceListRow): number | null {
  const xs = trace.metricPoints
    .map((m) => m.concurrency)
    .filter((c): c is number => c != null);
  return xs.length ? Math.max(...xs) : null;
}

function summaryMetrics(trace: TraceListRow): ProfileRankedTrace["metrics"] {
  return {
    outputTokensPerSecond:
      bestForKey(trace, (m) => m.outputTokensPerSecond, "high")?.value ?? null,
    prefillTokensPerSecond:
      bestForKey(trace, (m) => m.prefillTokensPerSecond, "high")?.value ?? null,
    p95TtftMs: bestForKey(trace, (m) => m.p95TtftMs, "low")?.value ?? null,
    p95TpotMs: bestForKey(trace, (m) => m.p95TpotMs, "low")?.value ?? null,
    peakVramGb:
      bestForKey(trace, (m) => m.peakVramGb, "high")?.value ?? null,
    maxConcurrency: maxConcurrencyForTrace(trace),
    failureRate: bestForKey(trace, (m) => m.failureRate, "low")?.value ?? null,
  };
}

/**
 * Profile-specific score. Each profile prioritizes different metrics; we use
 * a deterministic primary key for sorting (no weighted-sum aggregation since
 * the data is sparse).
 */
function scoreForProfile(
  profileId: keyof typeof BENCHMARK_PROFILES,
  trace: TraceListRow,
): { score: number | null; reason: string } {
  switch (profileId) {
    case "BT-CHAT-001": {
      // Interactive chat — minimize TTFT p95 first.
      const ttft = bestForKey(trace, (m) => m.p95TtftMs, "low");
      if (!ttft) return { score: null, reason: "no TTFT measurement" };
      return {
        score: -ttft.value,
        reason: `TTFT p95 = ${ttft.value.toFixed(0)} ms`,
      };
    }
    case "BT-CODE-001": {
      const prefill = bestForKey(trace, (m) => m.prefillTokensPerSecond, "high");
      if (!prefill) return { score: null, reason: "no prefill measurement" };
      return {
        score: prefill.value,
        reason: `Prefill ${prefill.value.toFixed(0)} tok/s`,
      };
    }
    case "BT-BATCH-001": {
      const tps = bestForKey(trace, (m) => m.totalTokensPerSecond, "high");
      if (!tps) return { score: null, reason: "no total tok/s" };
      return {
        score: tps.value,
        reason: `Total ${tps.value.toFixed(0)} tok/s`,
      };
    }
    case "BT-LONGCTX-001": {
      const ctx = trace.contextLength ?? null;
      if (ctx == null) return { score: null, reason: "no context length" };
      return { score: ctx, reason: `${(ctx / 1024).toFixed(0)}k ctx tested` };
    }
    case "BT-SERVE-001": {
      const conc = maxConcurrencyForTrace(trace);
      if (conc == null) return { score: null, reason: "no concurrency data" };
      return { score: conc, reason: `max concurrency ${conc}` };
    }
    case "BT-PREFILL-DECODE-001": {
      const prefill = bestForKey(trace, (m) => m.prefillTokensPerSecond, "high");
      const decode = bestForKey(trace, (m) => m.outputTokensPerSecond, "high");
      if (!prefill && !decode) return { score: null, reason: "no measurements" };
      const ratio =
        prefill && decode ? prefill.value / decode.value : null;
      return {
        score: prefill?.value ?? decode?.value ?? null,
        reason: ratio != null
          ? `prefill/decode ratio ${ratio.toFixed(1)}×`
          : prefill
            ? `prefill ${prefill.value.toFixed(0)} tok/s`
            : `decode ${decode!.value.toFixed(0)} tok/s`,
      };
    }
  }
}

export interface ProfileRankingSplit {
  profile: BenchmarkProfileDefinition;
  /** Traces that actually ran this profile (preferred). */
  nativeRanked: ProfileRankedTrace[];
  /** Traces from other profiles that happen to have the right metrics. */
  evaluatedRanked: ProfileRankedTrace[];
}

export function rankForProfile(
  profileId: keyof typeof BENCHMARK_PROFILES,
  traces: TraceListRow[],
): ProfileRankingSplit {
  const profile = BENCHMARK_PROFILES[profileId];

  const score = (trace: TraceListRow) => {
    const { score, reason } = scoreForProfile(profileId, trace);
    return {
      trace,
      primaryScore: score,
      metrics: summaryMetrics(trace),
      reason,
    };
  };

  // Native: trace explicitly ran this profile (benchmarkProfile.profileId
  // === the one we're ranking). These are first-class ranking entries.
  const native = traces
    .filter((t) => t.benchmarkProfile?.profileId === profileId)
    .map(score)
    .filter((r) => r.primaryScore != null);
  native.sort((a, b) => (b.primaryScore ?? 0) - (a.primaryScore ?? 0));

  // Evaluated: trace ran a DIFFERENT profile but happens to produce the
  // metrics this profile cares about. Useful for cross-comparison but
  // demoted to a separate section so it isn't confused with native runs.
  const evaluated = traces
    .filter(
      (t) =>
        t.benchmarkProfile?.profileId !== profileId &&
        (profile.compatibleEngines.includes(t.engine.type) ||
          profile.compatibleEngines.includes("generic_openai")),
    )
    .map(score)
    .filter((r) => r.primaryScore != null);
  evaluated.sort((a, b) => (b.primaryScore ?? 0) - (a.primaryScore ?? 0));

  return { profile, nativeRanked: native, evaluatedRanked: evaluated };
}

/** Legacy single-list shape (kept for any callers that still want it). */
export function rankForProfileFlat(
  profileId: keyof typeof BENCHMARK_PROFILES,
  traces: TraceListRow[],
): ProfileRanking {
  const split = rankForProfile(profileId, traces);
  return {
    profile: split.profile,
    ranked: [...split.nativeRanked, ...split.evaluatedRanked],
  };
}
