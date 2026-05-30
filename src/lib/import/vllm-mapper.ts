/**
 * Map a vLLM `result.json` (from `vllm bench serve --save-result`) into a
 * BenchTrace `benchtrace.share.v1` share doc. The mapped doc passes the
 * existing zod validator and flows through the same /api/import handler
 * as a native run, so the imported vLLM trace shows up in the dashboard
 * with no special-casing downstream.
 *
 * Fidelity caveats:
 *  - vLLM doesn't capture hardware/loader metadata in its result.json, so
 *    those blocks are mostly null. Verification level lands at "weak".
 *  - vLLM emits mean/median/p99 but not p50/p95. We map median → p50 and
 *    leave p95 null; p99 is preserved. Downstream charts handle nulls.
 *  - benchmark.tool is "vllm" (not "benchtrace") and
 *    benchmark.benchmark_mode is "vllm-compatible". Verification carve-out
 *    for native traces does NOT apply.
 */

const SCHEMA_VERSION = "benchtrace.share.v1" as const;

export interface VllmResultJson {
  // Top-level keys observed in vllm bench serve --save-result output.
  date?: string;
  backend?: string;
  endpoint_type?: string;
  model_id?: string;
  tokenizer_id?: string;
  num_prompts?: number;
  request_rate?: number | "inf";
  max_concurrency?: number | null;
  burstiness?: number;
  completed?: number;
  failed?: number;
  duration?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  request_throughput?: number;
  output_throughput?: number;
  mean_ttft_ms?: number;
  median_ttft_ms?: number;
  p99_ttft_ms?: number;
  mean_tpot_ms?: number;
  median_tpot_ms?: number;
  p99_tpot_ms?: number;
  mean_itl_ms?: number;
  median_itl_ms?: number;
  p99_itl_ms?: number;
  mean_e2el_ms?: number;
  median_e2el_ms?: number;
  p99_e2el_ms?: number;
  input_lens?: number[];
  output_lens?: number[];
  ttfts?: number[];
  itls?: number[][];
  label?: string;
}

/** Cheap predicate: is this JSON shaped like a vLLM result? */
export function isVllmResult(j: unknown): j is VllmResultJson {
  if (j == null || typeof j !== "object" || Array.isArray(j)) return false;
  const o = j as Record<string, unknown>;
  // These three together are unique enough to disambiguate.
  return (
    typeof o.output_throughput === "number" &&
    typeof o.mean_ttft_ms === "number" &&
    Array.isArray(o.input_lens)
  );
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function nonEmpty<T>(v: T | undefined | null, fallback: T): T {
  return v == null ? fallback : v;
}

export interface MapOptions {
  /** Override the trace name. Default: derived from model + endpoint + max_concurrency. */
  traceName?: string;
  /** Extra tags merged in. */
  tags?: string[];
}

export function mapVllmResultToShareDoc(
  v: VllmResultJson,
  options: MapOptions = {},
): Record<string, unknown> {
  const concurrency = num(v.max_concurrency);
  const requestRate =
    v.request_rate === "inf" || v.request_rate == null ? null : Number(v.request_rate);

  const traceName =
    options.traceName ??
    `vllm bench · ${nonEmpty(v.model_id, "unknown-model")} · ${nonEmpty(
      v.endpoint_type,
      "unknown",
    )} · c=${concurrency ?? "?"}`;

  const tags = ["vllm-bench-import", ...(options.tags ?? [])];

  const created_at = v.date ? toIsoString(v.date) : new Date().toISOString();

  return {
    schema_version: SCHEMA_VERSION,
    trace: {
      name: traceName,
      created_at,
      tags,
      fingerprint: null,
    },
    hardware: {
      cpu: null,
      ram_gb: null,
      motherboard: null,
      chipset: null,
      storage: null,
      os: null,
      kernel: null,
      gpus: [],
      driver_version: null,
      cuda_version: null,
      rocm_version: null,
      container_runtime: null,
      container_image: null,
    },
    model: {
      name: nonEmpty(v.model_id, "unknown"),
      provider: null,
      repo_or_path: null,
      architecture: null,
      dense_or_moe: null,
      parameter_count: null,
      active_parameter_count: null,
      quantization: null,
      precision: null,
      format: null,
      tokenizer: v.tokenizer_id ?? null,
      claimed_context_length: null,
      modality: null,
      capabilities: [],
      license: null,
      model_hash: null,
    },
    loader: {
      name: nonEmpty(v.backend, "vllm"),
      version: null,
      openai_compatible: true,
      launch_command: null,
      environment_variables: {},
      environment: {
        tensor_parallel_size: null,
        pipeline_parallel_size: null,
        data_parallel_size: null,
        kv_cache_dtype: null,
        gpu_memory_utilization: null,
        max_model_len: null,
        flash_attention: null,
        speculative_decoding: null,
        draft_model: null,
        mtp_enabled: null,
        chunked_prefill: null,
        prefix_caching: null,
        cpu_offload: null,
        gpu_residency: null,
      },
    },
    benchmark: {
      tool: "vllm",
      tool_version: null,
      command: null,
      dataset: null,
      prompt_source: null,
      workload_type: "serving",
      input_length: avg(v.input_lens) ?? null,
      output_length: avg(v.output_lens) ?? null,
      num_prompts: num(v.num_prompts),
      concurrency,
      request_rate: requestRate,
      concurrency_strategy: "max_valid_concurrency",
      warmup_runs: 0,
      measurement_duration_seconds: num(v.duration),
      random_seed: null,
      streaming_enabled: true,
      endpoint: v.endpoint_type ?? null,
      ttft_sla_ms: null,
      tpot_sla_ms: null,
      benchmark_mode: "vllm-compatible",
      metric_mode: "vllm-compatible",
      api_format: v.endpoint_type === "openai-chat" ? "chat" : "completions",
      ignore_eos: null,
      extra_body: null,
      range_ratio: null,
    },
    benchmark_profile: null,
    results: {
      best_output_tokens_per_second: num(v.output_throughput),
      best_total_tokens_per_second:
        num(v.total_input_tokens) != null &&
        num(v.total_output_tokens) != null &&
        num(v.duration) != null &&
        v.duration! > 0
          ? (v.total_input_tokens! + v.total_output_tokens!) / v.duration!
          : null,
      prefill_tokens_per_second: null,
      requests_per_second: num(v.request_throughput),
      max_valid_concurrency: concurrency,
      // vLLM emits median + mean + p99; map median→p50, leave p95 null.
      p50_ttft_ms: num(v.median_ttft_ms),
      p95_ttft_ms: null,
      p99_ttft_ms: num(v.p99_ttft_ms),
      p50_tpot_ms: num(v.median_tpot_ms),
      p95_tpot_ms: null,
      p99_tpot_ms: num(v.p99_tpot_ms),
      // vLLM's TPOT is token-normalized from server-side token counts. It has
      // no chunk-gap family; leave those null so the dashboard shows only the
      // vLLM-compatible column for an imported vLLM run.
      p50_chunk_gap_ms: null,
      p95_chunk_gap_ms: null,
      p99_chunk_gap_ms: null,
      mean_chunks_per_request: null,
      mean_tokens_per_chunk: null,
      output_token_count_source: "server_usage",
      p50_itl_ms: num(v.median_itl_ms),
      p95_itl_ms: null,
      p99_itl_ms: num(v.p99_itl_ms),
      p50_e2e_latency_ms: num(v.median_e2el_ms),
      p95_e2e_latency_ms: null,
      p99_e2e_latency_ms: num(v.p99_e2el_ms),
      peak_vram_gb: null,
      average_vram_gb: null,
      peak_ram_gb: null,
      average_ram_gb: null,
      gpu_utilization_avg: null,
      gpu_utilization_peak: null,
      cpu_utilization_avg: null,
      cpu_utilization_peak: null,
      power_draw_watts_avg: null,
      power_draw_watts_peak: null,
      gpu_temperature_avg: null,
      gpu_temperature_peak: null,
      tokens_per_watt: null,
      tokens_per_dollar: null,
      cost_per_1m_generated_tokens: null,
      cost_per_1m_total_tokens: null,
      successful_requests: num(v.completed),
      failed_requests: num(v.failed),
      failure_rate:
        num(v.completed) != null && num(v.failed) != null
          ? v.failed! / Math.max(1, v.completed! + v.failed!)
          : null,
    },
    metric_definitions: [
      {
        normalized_metric_name: "output_tokens_per_second",
        raw_metric_name: "output_throughput",
        metric_source: "vllm.benchmarks.serve.calculate_metrics",
        source_tool_version: null,
        definition:
          "sum(generated_tokens) / wall_clock_seconds (vllm bench_serve.py)",
        aggregation_method: "wall_clock",
        percentile: null,
        notes: null,
      },
    ],
    cost: null,
    verification: {
      // Foreign-tool import; no native artifacts → weak by default. The
      // native-tool carve-out in computeVerificationCore explicitly skips
      // anything with tool !== "benchtrace".
      level: "weak" as const,
      artifacts: [],
      missing_fields: [
        "hardware",
        "loader.launch_command",
        "model.architecture",
        "model.quantization",
      ],
      warnings: [
        "Imported from vllm bench serve; hardware + loader metadata not captured by vLLM's result.json. Verification level capped at weak. Re-run with `benchtrace bench serve` (or both) for a strong-verified trace.",
      ],
      notes: null,
    },
  };
}

function toIsoString(maybeDate: string): string {
  // vLLM emits like "20251231-235959" or "2025-12-31 23:59:59"; either way
  // anything Date can parse is fine. Otherwise fall back to "now".
  const tryFmt = maybeDate.replace(
    /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/,
    "$1-$2-$3T$4:$5:$6Z",
  );
  const d = new Date(tryFmt);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

function avg(arr: number[] | undefined): number | null {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const sum = arr.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  return sum / arr.length;
}
