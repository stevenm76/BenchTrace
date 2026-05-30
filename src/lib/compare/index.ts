import type { CompareTrace } from "@/lib/db/queries/compare";

export type MismatchSeverity = "critical" | "advisory";

export interface ComparabilityIssue {
  dimension: string;
  label: string;
  severity: MismatchSeverity;
  values: { traceId: string; value: string }[];
}

export interface MetricSpec {
  key: string;
  label: string;
  unit?: string;
  precision?: number;
  /** "high" means higher-is-better, "low" means lower-is-better */
  betterWhen: "high" | "low";
  /** Pick the relevant value from a trace's metric points. */
  pick: (trace: CompareTrace) => number | null;
}

function fmtNullable(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return String(v);
}

/**
 * Detect comparability mismatches across the supplied traces. Critical
 * mismatches make comparison meaningless; advisory mismatches affect
 * interpretation.
 */
export function detectIssues(traces: CompareTrace[]): ComparabilityIssue[] {
  if (traces.length < 2) return [];

  const dims: {
    dimension: string;
    label: string;
    severity: MismatchSeverity;
    get: (t: CompareTrace) => string;
  }[] = [
    {
      dimension: "model.name",
      label: "Model",
      severity: "critical",
      get: (t) => t.model.name,
    },
    {
      dimension: "model.quantization",
      label: "Quantization",
      severity: "critical",
      get: (t) => fmtNullable(t.model.quantization),
    },
    {
      dimension: "engine.type",
      label: "Engine",
      severity: "critical",
      get: (t) => t.engine.type,
    },
    {
      dimension: "engine.version",
      label: "Engine version",
      severity: "advisory",
      get: (t) => fmtNullable(t.engine.version),
    },
    {
      dimension: "trace.contextLength",
      label: "Context length",
      severity: "critical",
      get: (t) => fmtNullable(t.contextLength),
    },
    {
      dimension: "loader.tp",
      label: "Tensor parallel size",
      severity: "critical",
      get: (t) => fmtNullable(t.loaderConfig?.tensorParallelSize),
    },
    {
      dimension: "loader.kv",
      label: "KV cache dtype",
      severity: "advisory",
      get: (t) => fmtNullable(t.loaderConfig?.kvCacheDtype),
    },
    {
      dimension: "loader.speculative",
      label: "Speculative decoding",
      severity: "advisory",
      get: (t) => fmtNullable(t.loaderConfig?.speculativeDecoding),
    },
    {
      dimension: "loader.cpuOffload",
      label: "CPU offload",
      severity: "advisory",
      get: (t) => fmtNullable(t.loaderConfig?.cpuOffload),
    },
    {
      dimension: "benchmark.profile",
      label: "Benchmark profile",
      severity: "critical",
      get: (t) => fmtNullable(t.benchmarkProfile?.profileId),
    },
    {
      dimension: "benchmark.input_len",
      label: "Input length",
      severity: "critical",
      get: (t) => fmtNullable(t.benchmarkProfile?.inputLength),
    },
    {
      dimension: "benchmark.output_len",
      label: "Output length",
      severity: "critical",
      get: (t) => fmtNullable(t.benchmarkProfile?.outputLength),
    },
    {
      dimension: "benchmark.dataset",
      label: "Dataset",
      severity: "advisory",
      get: (t) => fmtNullable(t.benchmarkProfile?.dataset),
    },
    {
      dimension: "benchmark.tool",
      label: "Benchmark tool",
      severity: "advisory",
      get: (t) => fmtNullable(t.benchmarkProfile?.tool),
    },
    {
      dimension: "hardware.gpu",
      label: "GPU profile",
      severity: "critical",
      get: (t) => t.hardwareProfile.name,
    },
    {
      dimension: "hardware.cuda",
      label: "CUDA / ROCm",
      severity: "advisory",
      get: (t) =>
        fmtNullable(
          t.hardwareProfile.cudaVersion ?? t.hardwareProfile.rocmVersion,
        ),
    },
    {
      dimension: "hardware.driver",
      label: "Driver version",
      severity: "advisory",
      get: (t) => fmtNullable(t.hardwareProfile.driverVersion),
    },
  ];

  const issues: ComparabilityIssue[] = [];
  for (const dim of dims) {
    const values = traces.map((t) => ({ traceId: t.id, value: dim.get(t) }));
    const distinct = new Set(values.map((v) => v.value));
    if (distinct.size > 1) {
      issues.push({
        dimension: dim.dimension,
        label: dim.label,
        severity: dim.severity,
        values,
      });
    }
  }
  return issues;
}

/** Best (highest output_tps) metric point per trace. */
export function bestMetric(trace: CompareTrace) {
  if (trace.metricPoints.length === 0) return null;
  return trace.metricPoints.reduce((best, m) =>
    (m.outputTokensPerSecond ?? -Infinity) >
    (best.outputTokensPerSecond ?? -Infinity)
      ? m
      : best,
  );
}

/** Metrics to display in the delta table. */
export const COMPARE_METRICS: MetricSpec[] = [
  {
    key: "outputTokensPerSecond",
    label: "Output tok/s",
    betterWhen: "high",
    precision: 1,
    pick: (t) => bestMetric(t)?.outputTokensPerSecond ?? null,
  },
  {
    key: "totalTokensPerSecond",
    label: "Total tok/s",
    betterWhen: "high",
    precision: 1,
    pick: (t) => bestMetric(t)?.totalTokensPerSecond ?? null,
  },
  {
    key: "prefillTokensPerSecond",
    label: "Prefill tok/s",
    betterWhen: "high",
    precision: 1,
    pick: (t) => bestMetric(t)?.prefillTokensPerSecond ?? null,
  },
  {
    key: "requestsPerSecond",
    label: "Requests/sec",
    betterWhen: "high",
    precision: 2,
    pick: (t) => bestMetric(t)?.requestsPerSecond ?? null,
  },
  {
    key: "p50TtftMs",
    label: "TTFT p50",
    betterWhen: "low",
    unit: " ms",
    precision: 0,
    pick: (t) => bestMetric(t)?.p50TtftMs ?? null,
  },
  {
    key: "p95TtftMs",
    label: "TTFT p95",
    betterWhen: "low",
    unit: " ms",
    precision: 0,
    pick: (t) => bestMetric(t)?.p95TtftMs ?? null,
  },
  {
    key: "p95TpotMs",
    label: "TPOT p95",
    betterWhen: "low",
    unit: " ms",
    precision: 1,
    pick: (t) => bestMetric(t)?.p95TpotMs ?? null,
  },
  {
    key: "p95E2eLatencyMs",
    label: "E2E p95",
    betterWhen: "low",
    unit: " ms",
    precision: 0,
    pick: (t) => bestMetric(t)?.p95E2eLatencyMs ?? null,
  },
  {
    key: "peakVramGb",
    label: "Peak VRAM",
    betterWhen: "low",
    unit: " GB",
    precision: 1,
    pick: (t) => bestMetric(t)?.peakVramGb ?? null,
  },
  {
    key: "concurrency",
    label: "Max concurrency",
    betterWhen: "high",
    precision: 0,
    pick: (t) => {
      const points = t.metricPoints
        .map((m) => m.concurrency)
        .filter((c): c is number => c != null);
      return points.length ? Math.max(...points) : null;
    },
  },
  {
    key: "tokensPerWatt",
    label: "Tokens/Watt",
    betterWhen: "high",
    precision: 2,
    pick: (t) => bestMetric(t)?.tokensPerWatt ?? null,
  },
];

/** Find the winning trace for a metric (highest if betterWhen=high, lowest if low). */
export function pickWinner(
  spec: MetricSpec,
  values: { traceId: string; value: number | null }[],
): string | null {
  const valid = values.filter(
    (v): v is { traceId: string; value: number } => v.value != null,
  );
  if (valid.length < 2) return null;
  const sorted = valid.slice().sort((a, b) => a.value - b.value);
  const winner = spec.betterWhen === "high" ? sorted[sorted.length - 1] : sorted[0];
  return winner!.traceId;
}

/** Compute (best - other) / best as a fraction. Negative if other is worse. */
export function relativeDelta(
  spec: MetricSpec,
  baseline: number,
  other: number,
): number {
  if (baseline === 0) return 0;
  const raw = (other - baseline) / Math.abs(baseline);
  return spec.betterWhen === "high" ? raw : -raw;
}
