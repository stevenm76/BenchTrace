import {
  emptyParseResult,
  type BenchmarkAdapter,
  type ParseResult,
} from "./types";

/**
 * Parser for llama.cpp `llama-bench` JSON output (preferred). Accepts both a
 * single result object and an array (llama-bench --output json --output-err
 * none emits an array of runs).
 */
function pickRow(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object") return null;
  if (Array.isArray(input)) {
    const first = input[0];
    return first && typeof first === "object"
      ? (first as Record<string, unknown>)
      : null;
  }
  return input as Record<string, unknown>;
}

export const llamacppAdapter: BenchmarkAdapter = {
  id: "llamacpp",
  displayName: "llama.cpp",
  description:
    "JSON output from `llama-bench --output json`. Single-row or multi-row arrays accepted.",

  canParse(input: unknown): boolean {
    const row = pickRow(input);
    if (!row) return false;
    return (
      "t_pp" in row ||
      "t_tg" in row ||
      "avg_ts" in row ||
      "model_filename" in row
    );
  },

  parse(input: unknown): ParseResult {
    const result = emptyParseResult("parsed");
    const row = pickRow(input);
    if (!row) {
      result.parserStatus = "failed";
      result.warnings.push("Could not extract llama-bench row from input.");
      return result;
    }

    const nPrompt = typeof row.n_prompt === "number" ? row.n_prompt : null;
    const nGen = typeof row.n_gen === "number" ? row.n_gen : null;
    const tPpMs = typeof row.t_pp === "number" ? row.t_pp : null;
    const tTgMs = typeof row.t_tg === "number" ? row.t_tg : null;
    // Some versions emit ts_pp / ts_tg as tokens/sec directly.
    const tsPp = typeof row.ts_pp === "number" ? row.ts_pp : null;
    const tsTg = typeof row.ts_tg === "number" ? row.ts_tg : null;

    const prefillTps =
      tsPp ?? (nPrompt != null && tPpMs ? (nPrompt / tPpMs) * 1000 : null);
    const outputTps =
      tsTg ?? (nGen != null && tTgMs ? (nGen / tTgMs) * 1000 : null);

    result.metricPoints.push({
      concurrency: 1,
      successfulRequests:
        typeof row.n_runs === "number" ? row.n_runs : null,
      failedRequests: 0,
      failureRate: 0,
      outputTokensPerSecond: outputTps,
      prefillTokensPerSecond: prefillTps,
      totalTokensPerSecond: null,
    });

    if (typeof row.model_filename === "string") {
      result.model.repoOrPath = row.model_filename;
      result.model.name = row.model_filename.replace(/\.gguf$/i, "");
    }
    if (typeof row.model_type === "string") {
      result.model.architecture = row.model_type;
    }
    if (typeof row.quant === "string") {
      result.model.quantization = row.quant;
    }
    result.model.format = "gguf";

    result.engine.type = "llamacpp";
    result.engine.name = "llama.cpp";
    if (typeof row.build_commit === "string") {
      result.engine.gitSha = row.build_commit;
    }

    if (typeof row.n_threads === "number") {
      result.loaderConfig.schedulerSettings = {
        ...(result.loaderConfig.schedulerSettings ?? {}),
        n_threads: row.n_threads,
      };
    }
    if (typeof row.n_gpu_layers === "number") {
      result.loaderConfig.schedulerSettings = {
        ...(result.loaderConfig.schedulerSettings ?? {}),
        n_gpu_layers: row.n_gpu_layers,
      };
      result.loaderConfig.gpuResidency =
        row.n_gpu_layers >= 999 ? "full" : "partial";
    }
    if (typeof row.flash_attn === "boolean") {
      result.loaderConfig.flashAttention = row.flash_attn;
    }

    result.benchmarkProfile.tool = "llama-bench";
    result.benchmarkProfile.workloadType = "prefill_decode_split";
    if (nPrompt != null) result.benchmarkProfile.inputLength = nPrompt;
    if (nGen != null) result.benchmarkProfile.outputLength = nGen;

    result.unavailableFields = llamacppAdapter.getUnavailableFields();
    result.parserConfidence =
      outputTps != null && prefillTps != null ? 0.93 : 0.7;
    return result;
  },

  getUnavailableFields(): string[] {
    return [
      "p50_ttft_ms",
      "p95_ttft_ms",
      "p99_ttft_ms",
      "p50_tpot_ms",
      "p95_tpot_ms",
      "p99_tpot_ms",
      "p50_itl_ms",
      "p95_itl_ms",
      "p99_itl_ms",
      "requests_per_second",
      "max_valid_concurrency",
      "failure_rate",
      "peak_vram_gb",
      "power_draw_watts_avg",
      "gpu_temperature_avg",
    ];
  },
};
