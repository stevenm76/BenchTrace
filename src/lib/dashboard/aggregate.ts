import type { TraceListRow } from "@/lib/db/queries/traces";

export type DashboardTrace = TraceListRow;

export type MetricRow = DashboardTrace["metricPoints"][number];

/**
 * Highest output-tok/s metric point for a trace, restricted to rows that
 * satisfy the trace's TTFT/TPOT SLAs (and failure-rate ≤ 5%). Rows that
 * busted an SLA at higher concurrency aren't a meaningful serving number
 * — they're queueing. Falls back to the raw max if no SLA info is on the
 * trace's benchmark_profile.
 */
export function bestPoint(trace: DashboardTrace): MetricRow | null {
  if (trace.metricPoints.length === 0) return null;
  const ttftSla = trace.benchmarkProfile?.ttftSlaMs ?? null;
  const tpotSla = trace.benchmarkProfile?.tpotSlaMs ?? null;
  const failureCeil = 0.05;
  const valid = trace.metricPoints.filter((m) => {
    const ttftOk =
      ttftSla == null
        ? true
        : m.p95TtftMs == null
          ? true
          : m.p95TtftMs <= ttftSla;
    const tpotOk =
      tpotSla == null
        ? true
        : m.p95TpotMs == null
          ? true
          : m.p95TpotMs <= tpotSla;
    const failOk = m.failureRate == null ? true : m.failureRate <= failureCeil;
    return ttftOk && tpotOk && failOk;
  });
  const pool = valid.length > 0 ? valid : trace.metricPoints;
  return pool.reduce((best, m) => {
    const cur = m.outputTokensPerSecond ?? -Infinity;
    const bst = best.outputTokensPerSecond ?? -Infinity;
    return cur > bst ? m : best;
  });
}

/** Lowest p95 TTFT metric point for a trace, or null. */
export function lowestLatencyPoint(
  trace: DashboardTrace,
): MetricRow | null {
  const candidates = trace.metricPoints.filter(
    (m): m is MetricRow & { p95TtftMs: number } =>
      m.p95TtftMs != null && m.p95TtftMs > 0,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, m) =>
    m.p95TtftMs < best.p95TtftMs ? m : best,
  );
}

export interface DashboardSummary {
  totalTraces: number;
  strongCount: number;
  needsReviewCount: number;
  bestThroughput: { trace: DashboardTrace; point: MetricRow } | null;
  /** Highest output tok/s observed at concurrency=1 across all traces. */
  bestSingleStreamThroughput: {
    trace: DashboardTrace;
    point: MetricRow;
  } | null;
  bestLatency: { trace: DashboardTrace; point: MetricRow } | null;
  bestLongContext: DashboardTrace | null;
  latestTrace: DashboardTrace | null;
}

/** Pick the metric point for concurrency=1 (or closest to 1), if any. */
export function singleStreamPoint(trace: DashboardTrace): MetricRow | null {
  const c1 = trace.metricPoints.find((m) => m.concurrency === 1);
  if (c1) return c1;
  return null;
}

export function summarize(traces: DashboardTrace[]): DashboardSummary {
  const totalTraces = traces.length;
  const strongCount = traces.filter(
    (t) => t.verificationLevel === "strong",
  ).length;
  const needsReviewCount = traces.filter(
    (t) =>
      t.verificationLevel === "weak" || t.verificationLevel === "suspicious",
  ).length;

  let bestThroughput: DashboardSummary["bestThroughput"] = null;
  let bestSingleStreamThroughput: DashboardSummary["bestSingleStreamThroughput"] = null;
  let bestLatency: DashboardSummary["bestLatency"] = null;
  let bestLongContext: DashboardTrace | null = null;
  let latestTrace: DashboardTrace | null = null;

  for (const trace of traces) {
    const best = bestPoint(trace);
    if (best?.outputTokensPerSecond != null) {
      if (
        !bestThroughput ||
        best.outputTokensPerSecond >
          (bestThroughput.point.outputTokensPerSecond ?? -Infinity)
      ) {
        bestThroughput = { trace, point: best };
      }
    }

    const c1 = singleStreamPoint(trace);
    if (c1?.outputTokensPerSecond != null) {
      if (
        !bestSingleStreamThroughput ||
        c1.outputTokensPerSecond >
          (bestSingleStreamThroughput.point.outputTokensPerSecond ?? -Infinity)
      ) {
        bestSingleStreamThroughput = { trace, point: c1 };
      }
    }

    const low = lowestLatencyPoint(trace);
    if (low) {
      if (!bestLatency || low.p95TtftMs! < bestLatency.point.p95TtftMs!) {
        bestLatency = { trace, point: low };
      }
    }

    if (
      trace.contextLength != null &&
      (bestLongContext == null ||
        trace.contextLength > (bestLongContext.contextLength ?? 0))
    ) {
      bestLongContext = trace;
    }

    const ts = trace.completedAt ?? trace.startedAt ?? trace.createdAt;
    const latestTs =
      latestTrace?.completedAt ??
      latestTrace?.startedAt ??
      latestTrace?.createdAt;
    if (!latestTs || (ts && ts > latestTs)) latestTrace = trace;
  }

  return {
    totalTraces,
    strongCount,
    needsReviewCount,
    bestThroughput,
    bestSingleStreamThroughput,
    bestLatency,
    bestLongContext,
    latestTrace,
  };
}

export function engineDistribution(traces: DashboardTrace[]) {
  const counts = new Map<string, number>();
  for (const t of traces) {
    counts.set(t.engine.type, (counts.get(t.engine.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([engine, count]) => ({ engine, count }))
    .sort((a, b) => b.count - a.count);
}

export type ChartPoint = {
  traceId: string;
  traceName: string;
  engine: string;
  contextLength: number | null;
  concurrency: number | null;
  outputTokensPerSecond: number | null;
  p95TtftMs: number | null;
  peakVramGb: number | null;
};

/** One row per (trace, metric_point). Used for scatter plots. */
export function allMetricPoints(traces: DashboardTrace[]): ChartPoint[] {
  return traces.flatMap((t) =>
    t.metricPoints.map((m) => ({
      traceId: t.id,
      traceName: t.name,
      engine: t.engine.type as string,
      contextLength: t.contextLength,
      concurrency: m.concurrency,
      outputTokensPerSecond: m.outputTokensPerSecond,
      p95TtftMs: m.p95TtftMs,
      peakVramGb: m.peakVramGb,
    })),
  );
}

/** One row per trace, populated from that trace's best point. Bar charts. */
export function bestPointPerTrace(traces: DashboardTrace[]): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (const t of traces) {
    const m = bestPoint(t);
    if (!m) continue;
    out.push({
      traceId: t.id,
      traceName: t.name,
      engine: t.engine.type,
      contextLength: t.contextLength,
      concurrency: m.concurrency,
      outputTokensPerSecond: m.outputTokensPerSecond,
      p95TtftMs: m.p95TtftMs,
      peakVramGb: m.peakVramGb,
    });
  }
  return out;
}

/** One row per trace, populated from that trace's c=1 point. Bar charts.
 *  Traces without a c=1 measurement are omitted (they can't be ranked on
 *  single-stream). */
export function singleStreamPerTrace(traces: DashboardTrace[]): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (const t of traces) {
    const m = singleStreamPoint(t);
    if (!m) continue;
    out.push({
      traceId: t.id,
      traceName: t.name,
      engine: t.engine.type,
      contextLength: t.contextLength,
      concurrency: 1,
      outputTokensPerSecond: m.outputTokensPerSecond,
      p95TtftMs: m.p95TtftMs,
      peakVramGb: m.peakVramGb,
    });
  }
  return out;
}

/** Short trace label for chart axis. */
export function shortTraceLabel(name: string, maxLen = 28): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 1) + "…";
}
