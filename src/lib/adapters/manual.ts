import {
  reproJsonV1Schema,
  type ReproJsonV1,
} from "@/lib/schemas/repro-json";
import {
  emptyParseResult,
  type BenchmarkAdapter,
  type ParseResult,
} from "./types";

/**
 * Accepts a previously-exported benchtrace.share.v1 document (or any object
 * that matches the schema) and re-imports it as a new trace. Validates with
 * Zod so partial/invalid documents fail loudly.
 */
export const manualAdapter: BenchmarkAdapter = {
  id: "manual",
  displayName: "Manual / Repro JSON",
  description:
    "Paste a benchtrace.share.v1 JSON document. The schema is validated before import.",

  canParse(input: unknown): boolean {
    if (!input || typeof input !== "object") return false;
    return (
      (input as Record<string, unknown>).schema_version ===
      "benchtrace.share.v1"
    );
  },

  parse(input: unknown): ParseResult {
    const result = emptyParseResult("parsed");
    const validation = reproJsonV1Schema.safeParse(input);
    if (!validation.success) {
      result.parserStatus = "failed";
      result.warnings.push(
        `Repro JSON validation failed: ${validation.error.message.slice(0, 200)}`,
      );
      return result;
    }
    const doc: ReproJsonV1 = validation.data;

    result.trace.name = doc.trace.name;
    result.trace.tags = doc.trace.tags;
    result.trace.fingerprint = doc.trace.fingerprint;
    result.trace.contextLength = doc.loader.environment.max_model_len;
    result.trace.metricMode = doc.benchmark.metric_mode ?? null;

    result.model = {
      provider: doc.model.provider,
      name: doc.model.name,
      repoOrPath: doc.model.repo_or_path,
      architecture: doc.model.architecture,
      denseOrMoe: doc.model.dense_or_moe,
      parameterCount: doc.model.parameter_count,
      activeParameterCount: doc.model.active_parameter_count,
      quantization: doc.model.quantization,
      precision: doc.model.precision,
      format: doc.model.format,
      tokenizer: doc.model.tokenizer,
      claimedContextLength: doc.model.claimed_context_length,
      modality: doc.model.modality,
      capabilities: doc.model.capabilities,
      license: doc.model.license,
      modelHash: doc.model.model_hash,
    };

    result.engine = {
      name: doc.loader.name,
      version: doc.loader.version,
      // Best-effort engine type from the loader name.
      type: inferEngineType(doc.loader.name),
      openAICompatible: doc.loader.openai_compatible,
      // Same image string the hardware section carries — both reference the
      // running container. Engines.container_image historically was always
      // null because the writer never set it.
      containerImage: doc.hardware.container_image,
    };

    result.hardware = {
      name: "Imported hardware",
      cpu: doc.hardware.cpu,
      ramGb: doc.hardware.ram_gb,
      motherboard: doc.hardware.motherboard,
      chipset: doc.hardware.chipset,
      storage: doc.hardware.storage,
      os: doc.hardware.os,
      kernel: doc.hardware.kernel,
      gpuCount: doc.hardware.gpus.length || null,
      gpuModels: doc.hardware.gpus.map((g) => ({
        name: g.name,
        vramGb: g.vram_gb,
        pcieGeneration: g.pcie_generation,
        pcieWidth: g.pcie_width,
      })),
      gpuVramGb: doc.hardware.gpus.reduce((acc, g) => acc + (g.vram_gb ?? 0), 0) || null,
      driverVersion: doc.hardware.driver_version,
      cudaVersion: doc.hardware.cuda_version,
      rocmVersion: doc.hardware.rocm_version,
      containerRuntime: doc.hardware.container_runtime,
      containerImage: doc.hardware.container_image,
    };

    result.loaderConfig = {
      launchCommand: doc.loader.launch_command,
      environmentVariables: doc.loader.environment_variables,
      tensorParallelSize: doc.loader.environment.tensor_parallel_size,
      pipelineParallelSize: doc.loader.environment.pipeline_parallel_size,
      dataParallelSize: doc.loader.environment.data_parallel_size,
      kvCacheDtype: doc.loader.environment.kv_cache_dtype,
      maxModelLen: doc.loader.environment.max_model_len,
      gpuMemoryUtilization: doc.loader.environment.gpu_memory_utilization,
      flashAttention: doc.loader.environment.flash_attention,
      speculativeDecoding: doc.loader.environment.speculative_decoding,
      draftModel: doc.loader.environment.draft_model,
      mtpEnabled: doc.loader.environment.mtp_enabled,
      chunkedPrefill: doc.loader.environment.chunked_prefill,
      prefixCaching: doc.loader.environment.prefix_caching,
      cpuOffload: doc.loader.environment.cpu_offload,
      gpuResidency: doc.loader.environment.gpu_residency,
    };

    result.benchmarkProfile = {
      name: doc.benchmark_profile?.profile_id ?? "Imported workload",
      profileId: doc.benchmark_profile?.profile_id ?? null,
      profileVersion: doc.benchmark_profile?.profile_version ?? null,
      purpose: doc.benchmark_profile?.purpose ?? null,
      tool: doc.benchmark.tool,
      toolVersion: doc.benchmark.tool_version,
      command: doc.benchmark.command,
      dataset: doc.benchmark.dataset,
      promptSource: doc.benchmark.prompt_source,
      workloadType: doc.benchmark.workload_type,
      inputLength: doc.benchmark.input_length,
      outputLength: doc.benchmark.output_length,
      numPrompts: doc.benchmark.num_prompts,
      concurrency: doc.benchmark.concurrency,
      requestRate: doc.benchmark.request_rate,
      concurrencyStrategy: doc.benchmark.concurrency_strategy,
      warmupRuns: doc.benchmark.warmup_runs,
      measurementDurationSeconds: doc.benchmark.measurement_duration_seconds,
      randomSeed: doc.benchmark.random_seed,
      streamingEnabled: doc.benchmark.streaming_enabled,
      endpoint: doc.benchmark.endpoint,
      ttftSlaMs: doc.benchmark.ttft_sla_ms,
      tpotSlaMs: doc.benchmark.tpot_sla_ms,
      requiredMetrics: doc.benchmark_profile?.required_metrics ?? null,
      optionalMetrics: doc.benchmark_profile?.optional_metrics ?? null,
      compatibleEngines: doc.benchmark_profile?.compatible_engines ?? null,
      comparabilityNotes: doc.benchmark_profile?.comparability_notes ?? null,
    };

    result.metricPoints.push({
      concurrency: doc.benchmark.concurrency,
      requestRate: doc.benchmark.request_rate,
      successfulRequests: doc.results.successful_requests,
      failedRequests: doc.results.failed_requests,
      failureRate: doc.results.failure_rate,
      outputTokensPerSecond: doc.results.best_output_tokens_per_second,
      totalTokensPerSecond: doc.results.best_total_tokens_per_second,
      prefillTokensPerSecond: doc.results.prefill_tokens_per_second,
      requestsPerSecond: doc.results.requests_per_second,
      p50TtftMs: doc.results.p50_ttft_ms,
      p95TtftMs: doc.results.p95_ttft_ms,
      p99TtftMs: doc.results.p99_ttft_ms,
      p50TpotMs: doc.results.p50_tpot_ms,
      p95TpotMs: doc.results.p95_tpot_ms,
      p99TpotMs: doc.results.p99_tpot_ms,
      p50ChunkGapMs: doc.results.p50_chunk_gap_ms ?? null,
      p95ChunkGapMs: doc.results.p95_chunk_gap_ms ?? null,
      p99ChunkGapMs: doc.results.p99_chunk_gap_ms ?? null,
      meanChunksPerRequest: doc.results.mean_chunks_per_request ?? null,
      meanTokensPerChunk: doc.results.mean_tokens_per_chunk ?? null,
      outputTokenCountSource: doc.results.output_token_count_source ?? null,
      p50ItlMs: doc.results.p50_itl_ms,
      p95ItlMs: doc.results.p95_itl_ms,
      p99ItlMs: doc.results.p99_itl_ms,
      p50E2eLatencyMs: doc.results.p50_e2e_latency_ms,
      p95E2eLatencyMs: doc.results.p95_e2e_latency_ms,
      p99E2eLatencyMs: doc.results.p99_e2e_latency_ms,
      peakVramGb: doc.results.peak_vram_gb,
      averageVramGb: doc.results.average_vram_gb,
      peakRamGb: doc.results.peak_ram_gb,
      averageRamGb: doc.results.average_ram_gb,
      gpuUtilizationAvg: doc.results.gpu_utilization_avg,
      gpuUtilizationPeak: doc.results.gpu_utilization_peak,
      cpuUtilizationAvg: doc.results.cpu_utilization_avg,
      cpuUtilizationPeak: doc.results.cpu_utilization_peak,
      powerDrawWattsAvg: doc.results.power_draw_watts_avg,
      powerDrawWattsPeak: doc.results.power_draw_watts_peak,
      gpuTemperatureAvg: doc.results.gpu_temperature_avg,
      gpuTemperaturePeak: doc.results.gpu_temperature_peak,
      tokensPerWatt: doc.results.tokens_per_watt,
      tokensPerDollar: doc.results.tokens_per_dollar,
      costPer1mGeneratedTokens: doc.results.cost_per_1m_generated_tokens,
      costPer1mTotalTokens: doc.results.cost_per_1m_total_tokens,
    });

    result.metricDefinitions = doc.metric_definitions.map((md) => ({
      normalizedMetricName: md.normalized_metric_name,
      rawMetricName: md.raw_metric_name,
      metricSource: md.metric_source,
      sourceToolVersion: md.source_tool_version,
      definition: md.definition,
      aggregationMethod: md.aggregation_method,
      percentile: md.percentile,
      notes: md.notes,
      metricPointIndex: 0,
    }));

    // A benchtrace.share.v1 document IS a parsed result — it went through
    // Zod validation above. "parsed" is the accurate parserStatus; the older
    // "manual" tag misled the verification panel into reporting
    // "raw_artifact missing" for traces that had a perfectly good one.
    result.parserStatus = "parsed";
    result.parserConfidence = 1;
    return result;
  },

  getUnavailableFields(): string[] {
    return [];
  },
};

function inferEngineType(
  name: string,
): "vllm" | "sglang" | "llamacpp" | "ollama" | "generic_openai" | "other" {
  const n = name.toLowerCase();
  if (n.includes("vllm")) return "vllm";
  if (n.includes("sglang")) return "sglang";
  if (n.includes("llama.cpp") || n.includes("llamacpp")) return "llamacpp";
  if (n.includes("ollama")) return "ollama";
  return "generic_openai";
}
