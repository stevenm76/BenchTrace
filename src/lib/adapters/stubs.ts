import {
  emptyParseResult,
  type BenchmarkAdapter,
  type ParseResult,
} from "./types";

function stub(
  id: string,
  displayName: string,
  description: string,
  unavailable: string[],
): BenchmarkAdapter {
  return {
    id,
    displayName,
    description: `${description} (parser not yet implemented — manual review required)`,
    canParse: () => false,
    parse(_input: unknown): ParseResult {
      const r = emptyParseResult("failed");
      r.warnings.push(
        `${displayName} adapter is not yet implemented. Use Manual import or fill fields by hand.`,
      );
      r.unavailableFields = unavailable;
      return r;
    },
    getUnavailableFields() {
      return unavailable;
    },
  };
}

export const sglangAdapter = stub(
  "sglang",
  "SGLang",
  "Output from `python -m sglang.bench_serving`.",
  ["peak_vram_gb", "power_draw_watts_avg", "gpu_temperature_avg"],
);

export const ollamaAdapter = stub(
  "ollama",
  "Ollama",
  "Output from `ollama ps`, `ollama show`, and ad-hoc chat measurements.",
  ["max_valid_concurrency", "requests_per_second", "p95_ttft_ms"],
);

export const genericOpenAIAdapter = stub(
  "generic_openai",
  "OpenAI-compatible",
  "Generic OpenAI-compatible JSON.",
  ["peak_vram_gb", "power_draw_watts_avg"],
);
