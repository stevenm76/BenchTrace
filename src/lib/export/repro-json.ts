import { computeVerification } from "@/lib/verification";
import { getBenchmarkProfile } from "@/lib/benchmark-profiles";
import { redactEnv, redactText, summarize } from "@/lib/redaction";
import {
  reproJsonV1Schema,
  type ReproJsonV1,
} from "@/lib/schemas/repro-json";
import type { TraceDetail } from "@/lib/db/queries/traces";

export interface BuildReproOptions {
  redact: boolean;
  redactLocalPaths?: boolean;
}

export interface BuildReproResult {
  json: ReproJsonV1;
  redactionTotals: { label: string; count: number }[];
}

/**
 * Build a benchtrace.share.v1 document for a trace. Validates the result
 * against the Zod schema before returning; throws if shape diverges. Every
 * field is emitted explicitly (with null) — missing data must not be silent.
 */
export function buildReproJson(
  trace: TraceDetail,
  options: BuildReproOptions,
): BuildReproResult {
  const verification = computeVerification(trace);
  const profileDef = trace.benchmarkProfile?.profileId
    ? getBenchmarkProfile(trace.benchmarkProfile.profileId)
    : null;

  // Aggregate metric values across all metric points (we emit the "best" view
  // for headline numbers + the worst-case for latency).
  type MP = TraceDetail["metricPoints"][number];
  const points = trace.metricPoints;
  const aggMax = (getter: (p: MP) => number | null | undefined): number | null => {
    const v = points
      .map(getter)
      .filter((x): x is number => typeof x === "number");
    return v.length ? Math.max(...v) : null;
  };
  const aggMin = (getter: (p: MP) => number | null | undefined): number | null => {
    const v = points
      .map(getter)
      .filter((x): x is number => typeof x === "number");
    return v.length ? Math.min(...v) : null;
  };
  const bestPoint = points.length
    ? points.reduce((b, m) =>
        (m.outputTokensPerSecond ?? -Infinity) >
        (b.outputTokensPerSecond ?? -Infinity)
          ? m
          : b,
      )
    : null;
  const bestConcurrency = aggMax((p) => p.concurrency);

  const counts: Record<string, number> = {};
  const merge = (c: Record<string, number>) => {
    for (const [k, v] of Object.entries(c)) counts[k] = (counts[k] ?? 0) + v;
  };

  let launchCommand: string | null = trace.loaderConfig?.launchCommand ?? null;
  let benchmarkCommand: string | null =
    trace.benchmarkProfile?.command ?? null;
  let environmentVariables = trace.loaderConfig?.environmentVariables ?? {};

  if (options.redact) {
    if (launchCommand) {
      const r = redactText(launchCommand, {
        redactLocalPaths: options.redactLocalPaths,
      });
      launchCommand = r.text;
      merge(r.counts);
    }
    if (benchmarkCommand) {
      const r = redactText(benchmarkCommand, {
        redactLocalPaths: options.redactLocalPaths,
      });
      benchmarkCommand = r.text;
      merge(r.counts);
    }
    const r = redactEnv(environmentVariables, {
      redactLocalPaths: options.redactLocalPaths,
    });
    environmentVariables = r.env;
    merge(r.counts);
  }

  const json: ReproJsonV1 = {
    schema_version: "benchtrace.share.v1",
    trace: {
      name: trace.name,
      created_at: (
        trace.completedAt ?? trace.startedAt ?? trace.createdAt
      ).toISOString(),
      tags: trace.tags ?? [],
      fingerprint: trace.fingerprint,
    },
    hardware: {
      cpu: trace.hardwareProfile.cpu,
      ram_gb: trace.hardwareProfile.ramGb,
      motherboard: trace.hardwareProfile.motherboard,
      chipset: trace.hardwareProfile.chipset,
      storage: trace.hardwareProfile.storage,
      os: trace.hardwareProfile.os,
      kernel: trace.hardwareProfile.kernel,
      gpus: (trace.hardwareProfile.gpuModels ?? []).map((g) => ({
        name: g.name,
        vram_gb: g.vramGb ?? null,
        pcie_generation: g.pcieGeneration ?? null,
        pcie_width: g.pcieWidth ?? null,
      })),
      driver_version: trace.hardwareProfile.driverVersion,
      cuda_version: trace.hardwareProfile.cudaVersion,
      rocm_version: trace.hardwareProfile.rocmVersion,
      container_runtime: trace.hardwareProfile.containerRuntime,
      container_image: trace.hardwareProfile.containerImage,
    },
    model: {
      name: trace.model.name,
      provider: trace.model.provider,
      repo_or_path: trace.model.repoOrPath,
      architecture: trace.model.architecture,
      dense_or_moe: trace.model.denseOrMoe,
      parameter_count: trace.model.parameterCount,
      active_parameter_count: trace.model.activeParameterCount,
      quantization: trace.model.quantization,
      precision: trace.model.precision,
      format: trace.model.format,
      tokenizer: trace.model.tokenizer,
      claimed_context_length: trace.model.claimedContextLength,
      modality: trace.model.modality,
      capabilities: trace.model.capabilities ?? [],
      license: trace.model.license,
      model_hash: trace.model.modelHash,
    },
    loader: {
      name: trace.engine.name,
      version: trace.engine.version,
      openai_compatible: trace.engine.openAICompatible ?? null,
      launch_command: launchCommand,
      environment_variables: environmentVariables,
      environment: {
        tensor_parallel_size: trace.loaderConfig?.tensorParallelSize ?? null,
        pipeline_parallel_size: trace.loaderConfig?.pipelineParallelSize ?? null,
        data_parallel_size: trace.loaderConfig?.dataParallelSize ?? null,
        kv_cache_dtype: trace.loaderConfig?.kvCacheDtype ?? null,
        gpu_memory_utilization: trace.loaderConfig?.gpuMemoryUtilization ?? null,
        max_model_len: trace.loaderConfig?.maxModelLen ?? null,
        flash_attention: trace.loaderConfig?.flashAttention ?? null,
        speculative_decoding: trace.loaderConfig?.speculativeDecoding ?? null,
        draft_model: trace.loaderConfig?.draftModel ?? null,
        mtp_enabled: trace.loaderConfig?.mtpEnabled ?? null,
        chunked_prefill: trace.loaderConfig?.chunkedPrefill ?? null,
        prefix_caching: trace.loaderConfig?.prefixCaching ?? null,
        cpu_offload: trace.loaderConfig?.cpuOffload ?? null,
        gpu_residency: trace.loaderConfig?.gpuResidency ?? null,
      },
    },
    benchmark: {
      tool: trace.benchmarkProfile?.tool ?? null,
      tool_version: trace.benchmarkProfile?.toolVersion ?? null,
      command: benchmarkCommand,
      dataset: trace.benchmarkProfile?.dataset ?? null,
      prompt_source: trace.benchmarkProfile?.promptSource ?? null,
      workload_type: trace.benchmarkProfile?.workloadType ?? null,
      input_length: trace.benchmarkProfile?.inputLength ?? null,
      output_length: trace.benchmarkProfile?.outputLength ?? null,
      num_prompts: trace.benchmarkProfile?.numPrompts ?? null,
      concurrency: trace.benchmarkProfile?.concurrency ?? null,
      request_rate: trace.benchmarkProfile?.requestRate ?? null,
      concurrency_strategy: trace.benchmarkProfile?.concurrencyStrategy ?? null,
      warmup_runs: trace.benchmarkProfile?.warmupRuns ?? null,
      measurement_duration_seconds:
        trace.benchmarkProfile?.measurementDurationSeconds ?? null,
      random_seed: trace.benchmarkProfile?.randomSeed ?? null,
      streaming_enabled: trace.benchmarkProfile?.streamingEnabled ?? null,
      endpoint: trace.benchmarkProfile?.endpoint ?? null,
      ttft_sla_ms: trace.benchmarkProfile?.ttftSlaMs ?? null,
      tpot_sla_ms: trace.benchmarkProfile?.tpotSlaMs ?? null,
    },
    benchmark_profile: profileDef
      ? {
          profile_id: profileDef.profileId,
          profile_version: profileDef.profileVersion,
          purpose: profileDef.purpose,
          required_metrics: [...profileDef.requiredMetrics],
          optional_metrics: [...profileDef.optionalMetrics],
          compatible_engines: [...profileDef.compatibleEngines],
          comparability_notes: profileDef.comparabilityNotes,
        }
      : null,
    results: {
      best_output_tokens_per_second: aggMax((p) => p.outputTokensPerSecond),
      best_total_tokens_per_second: aggMax((p) => p.totalTokensPerSecond),
      prefill_tokens_per_second: aggMax((p) => p.prefillTokensPerSecond),
      requests_per_second: aggMax((p) => p.requestsPerSecond),
      max_valid_concurrency: bestConcurrency,
      p50_ttft_ms: aggMin((p) => p.p50TtftMs),
      p95_ttft_ms: aggMin((p) => p.p95TtftMs),
      p99_ttft_ms: aggMin((p) => p.p99TtftMs),
      p50_tpot_ms: aggMin((p) => p.p50TpotMs),
      p95_tpot_ms: aggMin((p) => p.p95TpotMs),
      p99_tpot_ms: aggMin((p) => p.p99TpotMs),
      p50_itl_ms: aggMin((p) => p.p50ItlMs),
      p95_itl_ms: aggMin((p) => p.p95ItlMs),
      p99_itl_ms: aggMin((p) => p.p99ItlMs),
      p50_e2e_latency_ms: aggMin((p) => p.p50E2eLatencyMs),
      p95_e2e_latency_ms: aggMin((p) => p.p95E2eLatencyMs),
      p99_e2e_latency_ms: aggMin((p) => p.p99E2eLatencyMs),
      peak_vram_gb: aggMax((p) => p.peakVramGb),
      average_vram_gb: aggMax((p) => p.averageVramGb),
      peak_ram_gb: aggMax((p) => p.peakRamGb),
      average_ram_gb: aggMax((p) => p.averageRamGb),
      gpu_utilization_avg: aggMax((p) => p.gpuUtilizationAvg),
      gpu_utilization_peak: aggMax((p) => p.gpuUtilizationPeak),
      cpu_utilization_avg: aggMax((p) => p.cpuUtilizationAvg),
      cpu_utilization_peak: aggMax((p) => p.cpuUtilizationPeak),
      power_draw_watts_avg: aggMax((p) => p.powerDrawWattsAvg),
      power_draw_watts_peak: aggMax((p) => p.powerDrawWattsPeak),
      gpu_temperature_avg: aggMax((p) => p.gpuTemperatureAvg),
      gpu_temperature_peak: aggMax((p) => p.gpuTemperaturePeak),
      tokens_per_watt: aggMax((p) => p.tokensPerWatt),
      tokens_per_dollar: aggMax((p) => p.tokensPerDollar),
      cost_per_1m_generated_tokens:
        bestPoint?.costPer1mGeneratedTokens ?? null,
      cost_per_1m_total_tokens: bestPoint?.costPer1mTotalTokens ?? null,
      successful_requests: aggMax((p) => p.successfulRequests),
      failed_requests: aggMax((p) => p.failedRequests),
      failure_rate: aggMax((p) => p.failureRate),
    },
    metric_definitions: trace.metricPoints.flatMap((mp) =>
      mp.metricDefinitions.map((md) => ({
        normalized_metric_name: md.normalizedMetricName,
        raw_metric_name: md.rawMetricName,
        metric_source: md.metricSource,
        source_tool_version: md.sourceToolVersion,
        definition: md.definition,
        aggregation_method: md.aggregationMethod,
        percentile: md.percentile,
        notes: md.notes,
      })),
    ),
    cost: trace.costProfile
      ? {
          estimated_system_cost: trace.costProfile.estimatedSystemCost,
          estimated_gpu_cost: trace.costProfile.estimatedGpuCost,
          currency: trace.costProfile.currency,
          cost_basis_notes: trace.costProfile.costBasisNotes,
        }
      : null,
    verification: {
      level: verification.level,
      artifacts: trace.artifacts.map((a) => ({
        type: a.type,
        filename: a.filename,
        sha256: a.sha256,
        parser_status: a.parserStatus,
      })),
      missing_fields: verification.missingCriticalFields,
      warnings: verification.warnings,
      notes: null,
    },
  };

  // Validate before returning. Any divergence in shape is a developer bug.
  reproJsonV1Schema.parse(json);

  return {
    json,
    redactionTotals: summarize(counts).counts,
  };
}
