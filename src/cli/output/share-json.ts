import { createHash } from "node:crypto";

import { getBenchmarkProfile } from "@/lib/benchmark-profiles";
import { redactEnv, redactText, summarize } from "@/lib/redaction";
import {
  reproJsonV1Schema,
  type ReproJsonV1,
} from "@/lib/schemas/repro-json";
import {
  computeVerificationCore,
  type VerificationResult,
} from "@/lib/verification";

import { formatConcurrencyLabel } from "../runner/headline";
import { BENCHTRACE_VERSION } from "../version";
import { computeComparisonValidity } from "./comparison-validity";
import type { OutputTokenSource } from "../runner/metrics";
import type {
  LevelAggregate,
  SweepResult,
} from "../runner/aggregate";
import type { ModelNameInfo } from "../runner/model-name";
import type { ProbeResult } from "../runner/probe";
import type { PromptPool } from "../runner/prompts";
import type { BenchServeOptions } from "../runner/sweep";
import type { ContainerProbe } from "../snapshot/container";
import type { HardwareSnapshot } from "../snapshot/hardware";
import type { ModelConfigProbe } from "../snapshot/model-config";

export interface BuildShareInput {
  options: BenchServeOptions;
  startedAt: Date;
  completedAt: Date;
  sweep: SweepResult;
  hardware: HardwareSnapshot | null;
  launchCommand: string | null;
  /** Filenames already written into the output folder, with their sha256. */
  artifacts: {
    type: string;
    filename: string;
    sha256: string;
    parserStatus: "parsed" | "manual";
  }[];
  /** Server-probed fields (engine version, max_model_len, etc.). */
  probed: ProbeResult;
  /** Fields inferred from the model name (quantization, params, …). */
  nameInfo: ModelNameInfo;
  /** Docker container probe (image, launch cmd, env, parsed loader args). */
  container: ContainerProbe | null;
  /** HF model dir probe (config.json + tokenizer_config.json + format). */
  modelConfig: ModelConfigProbe | null;
  /** Prompt corpus + sample (dataset name, source descriptor). */
  promptPool: PromptPool;
}

export interface BuildShareResult {
  json: ReproJsonV1;
  verification: VerificationResult;
  redactionTotals: { label: string; count: number }[];
  fingerprint: string;
}

const NATIVE_TOOL = "benchtrace";

function sha256_16(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function pickBestLevel(sweep: SweepResult): LevelAggregate | null {
  // The "best" level for headline numbers is the max valid concurrency if
  // any; otherwise the one with the highest output_tps.
  if (sweep.maxValidConcurrency != null) {
    return sweep.perLevel.find((l) => l.streamLevel === sweep.maxValidConcurrency) ?? null;
  }
  let best: LevelAggregate | null = null;
  for (const l of sweep.perLevel) {
    if (
      l.outputTokensPerSecond != null &&
      (best == null ||
        (l.outputTokensPerSecond ?? -Infinity) >
          (best.outputTokensPerSecond ?? -Infinity))
    ) {
      best = l;
    }
  }
  return best;
}

/**
 * Build a benchtrace.share.v1 from a completed sweep. Applies redaction to
 * commands + env vars (when options.redact is true), runs the verification
 * core, and validates the result via Zod before returning.
 */
export function buildShareJson(input: BuildShareInput): BuildShareResult {
  const { options, sweep, hardware, launchCommand, startedAt, container, modelConfig, promptPool } = input;
  const profile = getBenchmarkProfile(options.profile);

  // Aggregations across the sweep
  const best = pickBestLevel(sweep);
  const levelTokenSource: OutputTokenSource =
    best?.outputTokenCountSource ?? "unknown";
  const maxLevel = sweep.perLevel.reduce<LevelAggregate | null>((acc, l) => {
    if (acc == null) return l;
    return l.streamLevel > acc.streamLevel ? l : acc;
  }, null);

  const counts: Record<string, number> = {};
  const merge = (m: Record<string, number>) => {
    for (const [k, v] of Object.entries(m)) counts[k] = (counts[k] ?? 0) + v;
  };

  // The CLI invocation, redacted
  const rawCmd = [
    "npx benchtrace",
    ...options.argv.map(quoteIfNeeded),
  ].join(" ");
  let benchmarkCommand: string = rawCmd;
  let launchCmdOut: string | null = launchCommand;
  // Env vars from container probe (filtered, since container env can be
  // hundreds of entries including PATH, NVIDIA_*, HF_*, …). Keep only
  // the entries that are LLM-relevant + present + non-redacted.
  let envVarsOut: Record<string, string> = filterContainerEnv(
    container?.environment ?? {},
  );

  if (options.redact) {
    const r1 = redactText(rawCmd);
    benchmarkCommand = r1.text;
    merge(r1.counts);
    if (launchCmdOut) {
      const r2 = redactText(launchCmdOut);
      launchCmdOut = r2.text;
      merge(r2.counts);
    }
    const r3 = redactEnv(envVarsOut);
    envVarsOut = r3.env;
    merge(r3.counts);
  }

  let promptSource: string = promptPool.source;
  if (options.redact) {
    const r = redactText(promptSource);
    promptSource = r.text;
    merge(r.counts);
  }

  // Endpoint string with potential api-key fingerprint redaction
  const endpointRaw = `${options.baseUrl.replace(/\/$/, "")}${options.endpoint}`;
  let endpoint = endpointRaw;
  if (options.redact) {
    const r = redactText(endpointRaw);
    endpoint = r.text;
    merge(r.counts);
  }

  const fingerprint = sha256_16(
    [
      options.engineName,
      options.engineVersion,
      options.model,
      options.profile,
      options.streams.join(","),
      options.seed,
      options.inputLen,
      options.outputLen,
    ]
      .map(String)
      .join("|"),
  );

  // Hardware → schema fields (null where unavailable). Cast through a
  // partial so the empty-object fallback still satisfies the type even
  // though we extended the snapshot.
  const hw =
    hardware ??
    ({
      os: null,
      kernel: null,
      cpu: null,
      ramGb: null,
      gpuModels: [],
      gpuPcieGeneration: null,
      gpuPcieWidth: null,
      gpuVendor: null,
      driverVersion: null,
      cudaVersion: null,
      rocmVersion: null,
      containerRuntime: null,
      motherboard: null,
      chipset: null,
      storage: null,
    } as HardwareSnapshot);

  // Build metric_points + metric_definitions
  const metricDefinitions: ReproJsonV1["metric_definitions"] = [];
  for (const lvl of sweep.perLevel) {
    if (lvl.outputTokensPerSecond != null) {
      metricDefinitions.push({
        normalized_metric_name: "output_tokens_per_second",
        raw_metric_name: "sum(completion_tokens) / wall_clock_seconds",
        metric_source: "benchtrace",
        source_tool_version: BENCHTRACE_VERSION,
        definition:
          "Sum of completion tokens across successful requests at this concurrency, divided by the wall-clock duration of the level.",
        aggregation_method: "sum_over_wallclock",
        percentile: null,
        notes: `at concurrency=${lvl.streamLevel}`,
      });
    }
    if (lvl.p95TtftMs != null) {
      metricDefinitions.push({
        normalized_metric_name: "p95_ttft_ms",
        raw_metric_name: "p95(first_token_ms - request_start_ms)",
        metric_source: "benchtrace",
        source_tool_version: BENCHTRACE_VERSION,
        definition: "Time to first generated token, 95th percentile.",
        aggregation_method: "percentile",
        percentile: 95,
        notes: `at concurrency=${lvl.streamLevel}`,
      });
    }
    if (lvl.p95TpotVllmCompatMs != null) {
      metricDefinitions.push({
        normalized_metric_name: "p95_tpot_ms",
        raw_metric_name: "p95((e2e_ms - ttft_ms) / max(1, output_tokens - 1))",
        metric_source: "benchtrace",
        source_tool_version: BENCHTRACE_VERSION,
        definition:
          "vLLM-compatible time per output token (token-normalized), 95th percentile. " +
          "Matches calculate_metrics in vllm/benchmarks/serve.py.",
        aggregation_method: "percentile",
        percentile: 95,
        notes: `at concurrency=${lvl.streamLevel}; output_token_count_source=${lvl.outputTokenCountSource}`,
      });
    }
    if (lvl.p95ChunkGapMs != null) {
      metricDefinitions.push({
        normalized_metric_name: "p95_chunk_gap_ms",
        raw_metric_name: "p95(mean(inter_chunk_arrival_gap_ms))",
        metric_source: "benchtrace",
        source_tool_version: BENCHTRACE_VERSION,
        definition:
          "BenchTrace-native mean chunk-gap latency: average inter-arrival gap between " +
          "content chunks, 95th percentile. NOT token-normalized — when the server packs " +
          ">1 token per chunk (e.g. MTP) this exceeds per-token TPOT by that factor. " +
          "Never compare directly to vLLM TPOT.",
        aggregation_method: "percentile",
        percentile: 95,
        notes: `at concurrency=${lvl.streamLevel}; mean_tokens_per_chunk=${lvl.meanTokensPerChunk?.toFixed(2) ?? "n/a"}`,
      });
    }
  }

  const results: ReproJsonV1["results"] = {
    best_output_tokens_per_second: sweep.bestOutputTokensPerSecond,
    best_total_tokens_per_second: sweep.bestTotalTokensPerSecond,
    prefill_tokens_per_second: sweep.bestPrefillTokensPerSecond,
    requests_per_second: best?.requestsPerSecond ?? null,
    max_valid_concurrency: sweep.maxValidConcurrency,
    p50_ttft_ms: best?.p50TtftMs ?? null,
    p95_ttft_ms: sweep.p95TtftAtMaxValid ?? best?.p95TtftMs ?? null,
    p99_ttft_ms: best?.p99TtftMs ?? null,
    // p*_tpot_ms carry the vLLM-compatible token-normalized TPOT (the family
    // safe to compare against `vllm bench serve`). Native chunk-gap latency is
    // reported separately below and never under a "TPOT" label.
    p50_tpot_ms: best?.p50TpotVllmCompatMs ?? null,
    p95_tpot_ms: best?.p95TpotVllmCompatMs ?? null,
    p99_tpot_ms: best?.p99TpotVllmCompatMs ?? null,
    p50_chunk_gap_ms: best?.p50ChunkGapMs ?? null,
    p95_chunk_gap_ms: best?.p95ChunkGapMs ?? null,
    p99_chunk_gap_ms: best?.p99ChunkGapMs ?? null,
    mean_chunks_per_request: best?.meanChunksPerRequest ?? null,
    mean_tokens_per_chunk: best?.meanTokensPerChunk ?? null,
    output_token_count_source: best?.outputTokenCountSource ?? "unknown",
    p50_itl_ms: best?.p50ItlMs ?? null,
    p95_itl_ms: best?.p95ItlMs ?? null,
    p99_itl_ms: best?.p99ItlMs ?? null,
    p50_e2e_latency_ms: best?.p50E2eLatencyMs ?? null,
    p95_e2e_latency_ms: best?.p95E2eLatencyMs ?? null,
    p99_e2e_latency_ms: best?.p99E2eLatencyMs ?? null,
    peak_vram_gb: maxOf(sweep.perLevel, (l) => l.peakVramGb),
    average_vram_gb: maxOf(sweep.perLevel, (l) => l.averageVramGb),
    peak_ram_gb: null,
    average_ram_gb: null,
    gpu_utilization_avg: avgOf(sweep.perLevel, (l) => l.gpuUtilizationAvg),
    gpu_utilization_peak: maxOf(sweep.perLevel, (l) => l.gpuUtilizationPeak),
    cpu_utilization_avg: null,
    cpu_utilization_peak: null,
    power_draw_watts_avg: avgOf(sweep.perLevel, (l) => l.powerDrawWattsAvg),
    power_draw_watts_peak: maxOf(sweep.perLevel, (l) => l.powerDrawWattsPeak),
    gpu_temperature_avg: avgOf(sweep.perLevel, (l) => l.gpuTemperatureAvg),
    gpu_temperature_peak: maxOf(sweep.perLevel, (l) => l.gpuTemperaturePeak),
    tokens_per_watt: maxOf(sweep.perLevel, (l) => l.tokensPerWatt),
    tokens_per_dollar: null,
    cost_per_1m_generated_tokens: null,
    cost_per_1m_total_tokens: null,
    successful_requests:
      sweep.perLevel.reduce((a, l) => a + l.successfulRequests, 0) || null,
    failed_requests:
      sweep.perLevel.reduce((a, l) => a + l.failedRequests, 0) || null,
    failure_rate: maxLevel?.failureRate ?? null,
  };

  // Compute verification
  const verification = computeVerificationCore({
    artifacts: input.artifacts.map((a) => ({
      parserStatus: a.parserStatus,
      sha256: a.sha256,
    })),
    loaderConfig: { launchCommand: launchCmdOut },
    benchmarkProfile: {
      command: benchmarkCommand,
      tool: NATIVE_TOOL,
      // Pull from the resolved profile — BT-CODE-001 is "coding_agent",
      // BT-LONGCTX-001 is "long_context", etc. Previously hard-coded to
      // "serving" so every native trace looked like a serving sweep.
      workloadType: profile?.workloadType ?? "serving",
      inputLength: options.inputLen,
      outputLength: options.outputLen,
      concurrency: sweep.maxValidConcurrency ?? maxLevel?.streamLevel ?? null,
    },
    engine: { version: input.probed.engineVersion ?? options.engineVersion },
    model: {
      quantization: input.nameInfo.quantization,
      architecture: input.nameInfo.architectureFamily,
      parameterCount: input.nameInfo.parameterCount,
    },
    hardwareProfile: {
      gpuModels: hw.gpuModels.map((g) => ({ name: g.name })),
      cudaVersion: hw.cudaVersion,
      rocmVersion: hw.rocmVersion,
    },
    metricPoints: sweep.perLevel.map((l) => ({
      outputTokensPerSecond: l.outputTokensPerSecond,
      totalTokensPerSecond: l.totalTokensPerSecond,
      prefillTokensPerSecond: l.prefillTokensPerSecond,
      p50TtftMs: l.p50TtftMs,
      p95TtftMs: l.p95TtftMs,
      p99TtftMs: l.p99TtftMs,
      failureRate: l.failureRate,
      successfulRequests: l.successfulRequests,
    })),
    nativeBenchmarkTool: NATIVE_TOOL,
  });

  const resolvedEngineVersion =
    input.probed.engineVersion ?? options.engineVersion;
  const traceName =
    options.notes ??
    `BenchTrace · ${options.model} · ${options.engineName} ${resolvedEngineVersion} · ${formatConcurrencyLabel(options.streams)}`;

  const json: ReproJsonV1 = {
    schema_version: "benchtrace.share.v1",
    trace: {
      name: traceName,
      created_at: startedAt.toISOString(),
      tags: ["benchtrace-native", options.profile, ...options.tags].filter(
        (t, i, arr) => arr.indexOf(t) === i,
      ),
      fingerprint,
    },
    hardware: {
      cpu: hw.cpu,
      ram_gb: hw.ramGb,
      motherboard: hw.motherboard,
      chipset: hw.chipset,
      storage: hw.storage,
      os: hw.os,
      kernel: hw.kernel,
      gpus: hw.gpuModels.map((g) => ({
        name: g.name,
        vram_gb: g.vramGb,
        pcie_generation: g.pcieGeneration ?? null,
        pcie_width: g.pcieWidth ?? null,
      })),
      driver_version: hw.driverVersion,
      cuda_version: hw.cudaVersion,
      rocm_version: hw.rocmVersion,
      container_runtime: container ? "docker" : hw.containerRuntime,
      container_image: container?.image ?? null,
    },
    model: {
      name: options.model,
      provider: input.probed.modelProvider,
      repo_or_path: redactPathIfNeeded(
        input.probed.modelRepoOrPath ?? options.model,
        options.redact,
      ),
      // config.json is authoritative when readable; name-regex is the
      // fallback. Pick config first, fall back per-field.
      architecture:
        modelConfig?.architecture ?? input.nameInfo.architectureFamily,
      dense_or_moe:
        modelConfig?.denseOrMoe ?? input.nameInfo.denseOrMoe,
      parameter_count:
        modelConfig?.parameterCount ?? input.nameInfo.parameterCount,
      active_parameter_count:
        modelConfig?.activeParameterCount ??
        input.nameInfo.activeParameterCount,
      quantization:
        modelConfig?.quantization ?? input.nameInfo.quantization,
      precision: modelConfig?.precision ?? input.nameInfo.precision,
      format: modelConfig?.format ?? input.nameInfo.format,
      tokenizer: modelConfig?.tokenizer ?? null,
      claimed_context_length:
        input.probed.claimedContextLength ??
        modelConfig?.maxPositionEmbeddings ??
        null,
      modality:
        modelConfig && modelConfig.capabilities.length > 0
          ? modelConfig.capabilities[0]!
          : "text",
      capabilities: modelConfig?.capabilities ?? [],
      license: modelConfig?.license ?? null,
      model_hash: modelConfig?.configHash ?? null,
    },
    loader: {
      name: options.engineName,
      version: input.probed.engineVersion ?? options.engineVersion,
      openai_compatible: true,
      launch_command: launchCmdOut,
      environment_variables: envVarsOut,
      environment: {
        tensor_parallel_size: container?.loader.tensorParallelSize ?? null,
        pipeline_parallel_size: container?.loader.pipelineParallelSize ?? null,
        data_parallel_size: container?.loader.dataParallelSize ?? null,
        kv_cache_dtype: container?.loader.kvCacheDtype ?? null,
        gpu_memory_utilization: container?.loader.gpuMemoryUtilization ?? null,
        // Prefer container-parsed; fall back to server-probed.
        max_model_len:
          container?.loader.maxModelLen ??
          input.probed.claimedContextLength ??
          null,
        flash_attention: null,
        speculative_decoding: container?.loader.speculativeDecoding ?? null,
        draft_model: container?.loader.draftModel ?? null,
        mtp_enabled: container?.loader.mtpEnabled ?? null,
        chunked_prefill: container?.loader.chunkedPrefill ?? null,
        prefix_caching: container?.loader.prefixCaching ?? null,
        cpu_offload: container?.loader.cpuOffload ?? null,
        gpu_residency: null,
      },
    },
    benchmark: {
      tool: NATIVE_TOOL,
      tool_version: BENCHTRACE_VERSION,
      command: benchmarkCommand,
      dataset: promptPool.dataset,
      prompt_source: promptSource,
      workload_type: profile?.workloadType ?? "serving",
      input_length: options.inputLen,
      output_length: options.outputLen,
      num_prompts: options.numPrompts,
      concurrency:
        sweep.maxValidConcurrency ?? maxLevel?.streamLevel ?? null,
      request_rate: options.requestRate === "inf" ? null : options.requestRate,
      concurrency_strategy: profile?.concurrencyStrategy ?? "max_valid_concurrency",
      warmup_runs: options.warmup,
      measurement_duration_seconds: sweep.totalDurationSeconds,
      random_seed: options.seed,
      streaming_enabled: options.streaming,
      endpoint,
      ttft_sla_ms: options.ttftSlaMs,
      tpot_sla_ms: options.tpotSlaMs,
      benchmark_mode: options.benchmarkMode,
      metric_mode: options.metricMode,
      api_format: options.apiFormat,
      ignore_eos: options.ignoreEos,
      extra_body: options.extraBody,
      range_ratio:
        options.dataset === "random-tokens" ? options.rangeRatio : null,
      random_token_metadata: promptPool.randomTokenMetadata ?? null,
    },
    benchmark_profile: profile
      ? {
          profile_id: profile.profileId,
          profile_version: profile.profileVersion,
          purpose: profile.purpose,
          required_metrics: [...profile.requiredMetrics],
          optional_metrics: [...profile.optionalMetrics],
          compatible_engines: [...profile.compatibleEngines],
          comparability_notes: profile.comparabilityNotes,
        }
      : null,
    results,
    metric_definitions: metricDefinitions,
    cost: null,
    comparison_validity: computeComparisonValidity({
      endpoint: `${options.endpoint}`,
      apiFormat: options.apiFormat,
      dataset: promptPool.dataset,
      ignoreEos: options.ignoreEos,
      temperature: options.temperature,
      seed: options.seed,
      metricMode: options.metricMode,
      outputTokenCountSource: levelTokenSource,
      randomTokenMode: promptPool.randomTokenMetadata?.mode ?? null,
    }),
    verification: {
      level: verification.level,
      artifacts: input.artifacts.map((a) => ({
        type: a.type,
        filename: a.filename,
        sha256: a.sha256,
        parser_status: a.parserStatus,
      })),
      missing_fields: verification.missingCriticalFields,
      warnings: [...verification.warnings, ...sweep.warnings],
      notes:
        sweep.invalidLevels.length > 0
          ? `Invalid stream levels: ${sweep.invalidLevels
              .map((l) => `${l.streamLevel} (${l.reasons.join("; ")})`)
              .join(", ")}`
          : null,
    },
  };

  // Validate before returning — divergence is a developer bug.
  reproJsonV1Schema.parse(json);

  return {
    json,
    verification,
    redactionTotals: summarize(counts).counts,
    fingerprint,
  };
}

/** Wrap CLI args with spaces in single quotes for command faithfulness. */
function maxOf(
  arr: LevelAggregate[],
  pick: (l: LevelAggregate) => number | null,
): number | null {
  const xs = arr.map(pick).filter((v): v is number => typeof v === "number");
  return xs.length ? Math.max(...xs) : null;
}

function avgOf(
  arr: LevelAggregate[],
  pick: (l: LevelAggregate) => number | null,
): number | null {
  const xs = arr.map(pick).filter((v): v is number => typeof v === "number");
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function quoteIfNeeded(arg: string): string {
  if (/[\s"'`$\\]/.test(arg)) {
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
  return arg;
}

function redactPathIfNeeded(value: string, redact: boolean): string {
  if (!redact || !value) return value;
  // Home-style paths are stripped by redactText's patterns
  // (/home, /Users, /root, /srv, /opt, C:\Users) so HF cache paths
  // like /root/.cache/huggingface/hub/... become ~/.cache/huggingface/hub/...
  const r = redactText(value);
  return r.text;
}

/**
 * From a container's full env, keep only the entries that are useful for
 * reproducing the run — engine knobs, model paths, HuggingFace settings.
 * Everything else (PATH, LANG, OS_* injection) is dropped so the share doc
 * doesn't bloat with 100+ noise lines.
 */
function filterContainerEnv(env: Record<string, string>): Record<string, string> {
  const keep = (k: string): boolean => {
    if (k.startsWith("VLLM_")) return true;
    if (k.startsWith("HF_")) return true;
    if (k.startsWith("HUGGINGFACE_")) return true;
    if (k.startsWith("CUDA_")) return true;
    if (k.startsWith("NCCL_")) return true;
    if (k.startsWith("TORCH_")) return true;
    if (k.startsWith("OMP_")) return true;
    if (k === "NVIDIA_VISIBLE_DEVICES") return true;
    if (k === "NVIDIA_DRIVER_CAPABILITIES") return true;
    return false;
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (keep(k)) out[k] = v;
  }
  return out;
}
