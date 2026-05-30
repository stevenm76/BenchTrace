import type { TraceDetail } from "@/lib/db/queries/traces";
import type { VerificationLevel } from "@/lib/db/schema";

export interface VerificationChecklist {
  rawArtifactPresent: boolean;
  parsedArtifactPresent: boolean;
  artifactHashPresent: boolean;
  launchCommandPresent: boolean;
  benchmarkCommandPresent: boolean;
  modelDetailsComplete: boolean;
  engineVersionPresent: boolean;
  hardwareProfileComplete: boolean;
  atLeastOneMetricParsed: boolean;
  workloadDetailsPresent: boolean;
}

export interface VerificationResult {
  level: VerificationLevel;
  checklist: VerificationChecklist;
  warnings: string[];
  missingCriticalFields: string[];
}

/**
 * Minimal shape `computeVerificationCore` needs. Both the Drizzle row path
 * (via `computeVerification`) and the CLI runner path build one of these.
 */
export interface VerificationInputShape {
  artifacts: { parserStatus: string | null; sha256: string | null }[];
  loaderConfig: { launchCommand: string | null } | null;
  benchmarkProfile: {
    command: string | null;
    tool: string | null;
    workloadType: string | null;
    inputLength: number | null;
    outputLength: number | null;
    concurrency: number | null;
  } | null;
  engine: { version: string | null };
  model: {
    quantization: string | null;
    architecture: string | null;
    parameterCount: number | null;
  };
  hardwareProfile: {
    gpuModels: { name: string }[] | null;
    cudaVersion: string | null;
    rocmVersion: string | null;
  };
  metricPoints: {
    outputTokensPerSecond: number | null;
    totalTokensPerSecond: number | null;
    prefillTokensPerSecond: number | null;
    p50TtftMs: number | null;
    p95TtftMs: number | null;
    p99TtftMs: number | null;
    failureRate: number | null;
    successfulRequests: number | null;
  }[];
  /**
   * Set to "benchtrace" when the trace was produced by the native runner.
   * Triggers the carve-out where a missing launch command degrades to a
   * warning instead of dropping the trace below `strong`.
   */
  nativeBenchmarkTool: string | null;
}

/**
 * Shape-based verification. Pure function — no DB access. Reused by both
 * the trace-detail path and the CLI runner.
 *
 * Carve-out: when `nativeBenchmarkTool === "benchtrace"` (or
 * `benchmarkProfile.tool === "benchtrace"`), a missing launch command is
 * surfaced as a soft warning rather than gating verification. Runner-
 * produced traces vouch for their own provenance.
 */
export function computeVerificationCore(
  input: VerificationInputShape,
): VerificationResult {
  const isNative =
    input.nativeBenchmarkTool === "benchtrace" ||
    input.benchmarkProfile?.tool === "benchtrace";

  const workloadPopulated = !!(
    input.benchmarkProfile?.workloadType ||
    input.benchmarkProfile?.inputLength != null ||
    input.benchmarkProfile?.outputLength != null ||
    input.benchmarkProfile?.concurrency != null
  );

  const c: VerificationChecklist = {
    rawArtifactPresent: input.artifacts.length > 0,
    parsedArtifactPresent: input.artifacts.some(
      (a) => a.parserStatus === "parsed",
    ),
    artifactHashPresent: input.artifacts.some((a) => !!a.sha256),
    launchCommandPresent: !!input.loaderConfig?.launchCommand,
    benchmarkCommandPresent: !!input.benchmarkProfile?.command,
    modelDetailsComplete: !!(
      input.model.quantization &&
      input.model.architecture &&
      input.model.parameterCount
    ),
    engineVersionPresent: !!input.engine.version,
    hardwareProfileComplete:
      !!input.hardwareProfile.gpuModels?.length &&
      !!(input.hardwareProfile.cudaVersion ?? input.hardwareProfile.rocmVersion),
    atLeastOneMetricParsed: input.metricPoints.length > 0,
    workloadDetailsPresent: workloadPopulated,
  };

  const warnings: string[] = [];
  const missingCriticalFields: string[] = [];

  // Suspicious-value detection
  for (const m of input.metricPoints) {
    if (
      m.outputTokensPerSecond != null &&
      m.outputTokensPerSecond > 100000
    ) {
      warnings.push(
        `Improbable output tok/s (${m.outputTokensPerSecond.toFixed(0)}) — likely parser error`,
      );
    }
    if (
      m.failureRate != null &&
      m.failureRate > 0 &&
      (m.successfulRequests ?? 0) === 0
    ) {
      warnings.push("Failure rate present but no successful requests recorded");
    }
    if (m.p50TtftMs != null && m.p95TtftMs != null && m.p95TtftMs < m.p50TtftMs) {
      warnings.push("TTFT p95 < p50 — percentile ordering inconsistent");
    }
  }

  if (
    input.metricPoints.length > 0 &&
    !c.launchCommandPresent &&
    !c.benchmarkCommandPresent &&
    !c.rawArtifactPresent
  ) {
    warnings.push(
      "Metrics present but no command and no raw artifact — irreproducible",
    );
  }

  const hasThroughput = input.metricPoints.some(
    (m) =>
      m.outputTokensPerSecond != null ||
      m.totalTokensPerSecond != null ||
      m.prefillTokensPerSecond != null,
  );
  if (hasThroughput && !workloadPopulated) {
    warnings.push(
      "Throughput recorded without workload details (input/output length, concurrency, workload type)",
    );
  }

  if (!c.launchCommandPresent) {
    if (isNative) {
      // Soft warning — the runner captures everything else; vouching for
      // its own provenance is enough for "strong".
      warnings.push("launch_command_not_provided");
    } else {
      missingCriticalFields.push("launch_command");
    }
  }
  if (!c.benchmarkCommandPresent)
    missingCriticalFields.push("benchmark_command");
  if (!c.engineVersionPresent) missingCriticalFields.push("engine_version");
  if (!c.hardwareProfileComplete)
    missingCriticalFields.push("hardware_profile");
  if (!c.parsedArtifactPresent) missingCriticalFields.push("raw_artifact");
  if (!c.workloadDetailsPresent)
    missingCriticalFields.push("workload_details");

  // The native carve-out: filter out the soft warning before the suspicious
  // check — it shouldn't trigger "suspicious".
  const hardWarnings = warnings.filter(
    (w) => w !== "launch_command_not_provided",
  );

  let level: VerificationLevel;
  if (hardWarnings.length > 0 || !c.atLeastOneMetricParsed) {
    level = "suspicious";
  } else if (
    c.rawArtifactPresent &&
    (c.launchCommandPresent || isNative) &&
    c.benchmarkCommandPresent &&
    c.workloadDetailsPresent &&
    (c.modelDetailsComplete || c.engineVersionPresent) &&
    c.hardwareProfileComplete &&
    c.atLeastOneMetricParsed
  ) {
    level = "strong";
  } else if (
    c.rawArtifactPresent &&
    (c.launchCommandPresent || c.benchmarkCommandPresent) &&
    (c.modelDetailsComplete ||
      c.engineVersionPresent ||
      c.workloadDetailsPresent)
  ) {
    level = "medium";
  } else {
    level = "weak";
  }

  return { level, checklist: c, warnings, missingCriticalFields };
}

/**
 * Drizzle-row adapter. Builds a `VerificationInputShape` from a TraceDetail
 * and delegates to `computeVerificationCore`.
 */
export function computeVerification(trace: TraceDetail): VerificationResult {
  return computeVerificationCore({
    artifacts: trace.artifacts.map((a) => ({
      parserStatus: a.parserStatus,
      sha256: a.sha256,
    })),
    loaderConfig: trace.loaderConfig
      ? { launchCommand: trace.loaderConfig.launchCommand }
      : null,
    benchmarkProfile: trace.benchmarkProfile
      ? {
          command: trace.benchmarkProfile.command,
          tool: trace.benchmarkProfile.tool,
          workloadType: trace.benchmarkProfile.workloadType,
          inputLength: trace.benchmarkProfile.inputLength,
          outputLength: trace.benchmarkProfile.outputLength,
          concurrency: trace.benchmarkProfile.concurrency,
        }
      : null,
    engine: { version: trace.engine.version },
    model: {
      quantization: trace.model.quantization,
      architecture: trace.model.architecture,
      parameterCount: trace.model.parameterCount,
    },
    hardwareProfile: {
      gpuModels: trace.hardwareProfile.gpuModels,
      cudaVersion: trace.hardwareProfile.cudaVersion,
      rocmVersion: trace.hardwareProfile.rocmVersion,
    },
    metricPoints: trace.metricPoints.map((m) => ({
      outputTokensPerSecond: m.outputTokensPerSecond,
      totalTokensPerSecond: m.totalTokensPerSecond,
      prefillTokensPerSecond: m.prefillTokensPerSecond,
      p50TtftMs: m.p50TtftMs,
      p95TtftMs: m.p95TtftMs,
      p99TtftMs: m.p99TtftMs,
      failureRate: m.failureRate,
      successfulRequests: m.successfulRequests,
    })),
    nativeBenchmarkTool: trace.nativeBenchmarkTool,
  });
}
