import {
  emptyParseResult,
  type BenchmarkAdapter,
  type ParseResult,
} from "./types";

/**
 * Parser for vLLM benchmark output. Supports the JSON shape emitted by
 * `vllm.entrypoints.cli.bench serve` / `bench_serving.py`. Tolerates both
 * the legacy and current key names (e.g. `mean_ttft_ms` vs `mean_ttft`).
 *
 * Fields structurally absent from vLLM bench (power, temperature, VRAM) are
 * surfaced via getUnavailableFields() so the UI can show "not captured".
 */
function pickNumber(obj: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function pickPercentile(
  obj: Record<string, unknown>,
  baseKey: string,
  pct: number,
): number | null {
  // Two shapes are common:
  //   percentiles_ttft_ms: [[50, 102.3], [95, 168.4], [99, 198.1]]
  //   percentiles_ttft_ms: {"50": 102.3, "95": 168.4}
  const v = obj[`percentiles_${baseKey}`];
  if (Array.isArray(v)) {
    for (const entry of v) {
      if (Array.isArray(entry) && entry.length >= 2) {
        const [p, val] = entry;
        if (typeof p === "number" && p === pct && typeof val === "number") {
          return val;
        }
      }
    }
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const val = o[String(pct)] ?? o[`${pct}`];
    if (typeof val === "number") return val;
  }
  // Fallback: explicit `p95_ttft_ms` key from newer vLLM
  const direct = obj[`p${pct}_${baseKey}`];
  if (typeof direct === "number") return direct;
  return null;
}

export const vllmAdapter: BenchmarkAdapter = {
  id: "vllm",
  displayName: "vLLM",
  description:
    "JSON output from vLLM's bench_serving / `python -m vllm.entrypoints.cli.bench`.",

  canParse(input: unknown): boolean {
    if (!input || typeof input !== "object") return false;
    const o = input as Record<string, unknown>;
    const hasThroughput =
      typeof o.output_throughput === "number" ||
      typeof o.total_throughput === "number" ||
      typeof o.request_throughput === "number";
    const hasIdentity =
      o.backend === "vllm" ||
      typeof o.model_id === "string" ||
      typeof o.model === "string";
    return hasThroughput && (hasIdentity || hasThroughput);
  },

  parse(input: unknown): ParseResult {
    const result = emptyParseResult("parsed");
    if (!input || typeof input !== "object") {
      result.parserStatus = "failed";
      result.warnings.push("Input is not a JSON object.");
      return result;
    }
    const o = input as Record<string, unknown>;

    const concurrency = pickNumber(o, "max_concurrency", "concurrency");
    const requestRate = pickNumber(o, "request_rate");
    const numPrompts = pickNumber(o, "num_prompts");
    const completed = pickNumber(o, "completed", "successful_requests");
    const duration = pickNumber(o, "duration", "duration_s");

    const outputTps = pickNumber(o, "output_throughput");
    const totalTps = pickNumber(o, "total_throughput");
    const reqPs = pickNumber(o, "request_throughput");

    const point = {
      concurrency: concurrency != null ? Math.round(concurrency) : null,
      requestRate,
      successfulRequests: completed != null ? Math.round(completed) : null,
      failedRequests:
        completed != null && numPrompts != null
          ? Math.max(0, Math.round(numPrompts - completed))
          : null,
      failureRate:
        completed != null && numPrompts != null && numPrompts > 0
          ? Math.max(0, 1 - completed / numPrompts)
          : null,
      outputTokensPerSecond: outputTps,
      totalTokensPerSecond: totalTps,
      prefillTokensPerSecond: null,
      requestsPerSecond: reqPs,
      p50TtftMs: pickPercentile(o, "ttft_ms", 50) ?? pickNumber(o, "median_ttft_ms"),
      p95TtftMs: pickPercentile(o, "ttft_ms", 95),
      p99TtftMs: pickPercentile(o, "ttft_ms", 99),
      p50TpotMs: pickPercentile(o, "tpot_ms", 50) ?? pickNumber(o, "median_tpot_ms"),
      p95TpotMs: pickPercentile(o, "tpot_ms", 95),
      p99TpotMs: pickPercentile(o, "tpot_ms", 99),
      p50ItlMs: pickPercentile(o, "itl_ms", 50) ?? pickNumber(o, "median_itl_ms"),
      p95ItlMs: pickPercentile(o, "itl_ms", 95),
      p99ItlMs: pickPercentile(o, "itl_ms", 99),
      p50E2eLatencyMs:
        pickPercentile(o, "e2el_ms", 50) ?? pickNumber(o, "median_e2el_ms"),
      p95E2eLatencyMs: pickPercentile(o, "e2el_ms", 95),
      p99E2eLatencyMs: pickPercentile(o, "e2el_ms", 99),
    };

    result.metricPoints.push(point);

    // Trace name + tags
    const modelId =
      (typeof o.model_id === "string" && o.model_id) ||
      (typeof o.model === "string" && o.model) ||
      null;
    if (modelId) {
      result.model.name = modelId;
      result.model.repoOrPath = modelId;
    }
    result.engine.type = "vllm";
    result.engine.name = "vLLM";
    if (typeof o.vllm_version === "string") {
      result.engine.version = o.vllm_version;
    }
    result.benchmarkProfile.tool = "vllm";
    result.benchmarkProfile.workloadType = "serving";
    if (typeof duration === "number") {
      result.benchmarkProfile.measurementDurationSeconds = duration;
    }
    if (numPrompts != null) {
      result.benchmarkProfile.numPrompts = Math.round(numPrompts);
    }
    if (concurrency != null) {
      result.benchmarkProfile.concurrency = Math.round(concurrency);
    }
    if (typeof o.dataset_name === "string") {
      result.benchmarkProfile.dataset = o.dataset_name;
    }
    if (typeof o.random_input_len === "number") {
      result.benchmarkProfile.inputLength = o.random_input_len;
    }
    if (typeof o.random_output_len === "number") {
      result.benchmarkProfile.outputLength = o.random_output_len;
    }
    if (typeof o.random_seed === "number") {
      result.benchmarkProfile.randomSeed = o.random_seed;
    }

    result.unavailableFields = vllmAdapter.getUnavailableFields();
    result.parserConfidence =
      point.outputTokensPerSecond != null || point.p95TtftMs != null ? 0.95 : 0.6;

    if (
      point.outputTokensPerSecond == null &&
      point.p95TtftMs == null &&
      point.requestsPerSecond == null
    ) {
      result.parserStatus = "failed";
      result.warnings.push(
        "No usable throughput or latency keys found in input.",
      );
      result.parserConfidence = 0;
    }

    return result;
  },

  getUnavailableFields(): string[] {
    return [
      "peak_vram_gb",
      "average_vram_gb",
      "gpu_utilization_avg",
      "power_draw_watts_avg",
      "gpu_temperature_avg",
      "tokens_per_watt",
    ];
  },
};
