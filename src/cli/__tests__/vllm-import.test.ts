import assert from "node:assert/strict";

import {
  isVllmResult,
  mapVllmResultToShareDoc,
} from "@/lib/import/vllm-mapper";
import { reproJsonV1Schema } from "@/lib/schemas/repro-json";

const VLLM_SAMPLE = {
  date: "20250528-114122",
  backend: "vllm",
  endpoint_type: "vllm",
  model_id: "Qwen/Qwen3-32B",
  tokenizer_id: "Qwen/Qwen3-32B",
  num_prompts: 20,
  request_rate: "inf" as const,
  max_concurrency: 1,
  completed: 20,
  failed: 0,
  duration: 9.501784201000191,
  total_input_tokens: 5120,
  total_output_tokens: 640,
  request_throughput: 2.104867841336023,
  output_throughput: 67.35577092275274,
  mean_ttft_ms: 105.7,
  median_ttft_ms: 82.17012549994251,
  p99_ttft_ms: 397.14812974008015,
  mean_tpot_ms: 11.911639354838696,
  median_tpot_ms: 11.91611885482299,
  p99_tpot_ms: 17.938872166467903,
  mean_itl_ms: 18.4,
  median_itl_ms: 18.3244959998774,
  p99_itl_ms: 19.109031999505532,
  mean_e2el_ms: 474.96,
  median_e2el_ms: 468.5304089998681,
  p99_e2el_ms: 943.4058837604329,
  input_lens: [256, 256, 256],
  output_lens: [32, 32, 32],
  ttfts: [],
  itls: [],
};

export const tests = [
  {
    name: "isVllmResult recognizes the canonical shape",
    run() {
      assert.equal(isVllmResult(VLLM_SAMPLE), true);
      assert.equal(isVllmResult({}), false);
      assert.equal(isVllmResult(null), false);
      assert.equal(isVllmResult({ output_throughput: 1 }), false);
    },
  },
  {
    name: "mapVllmResultToShareDoc produces a schema-valid share doc",
    run() {
      const mapped = mapVllmResultToShareDoc(VLLM_SAMPLE);
      const parsed = reproJsonV1Schema.parse(mapped);
      assert.equal(parsed.benchmark.tool, "vllm");
      assert.equal(parsed.benchmark.benchmark_mode, "vllm-compatible");
      assert.equal(parsed.benchmark.measurement_duration_seconds, 9.501784201000191);
      assert.equal(parsed.results.successful_requests, 20);
      assert.equal(parsed.results.best_output_tokens_per_second, 67.35577092275274);
      assert.equal(parsed.results.p50_ttft_ms, 82.17012549994251);
      assert.equal(parsed.results.p99_ttft_ms, 397.14812974008015);
      assert.equal(parsed.results.p95_ttft_ms, null, "p95 has no vLLM equivalent");
      assert.equal(parsed.verification.level, "weak");
    },
  },
  {
    name: "tags include vllm-bench-import marker for filtering",
    run() {
      const mapped = mapVllmResultToShareDoc(VLLM_SAMPLE, {
        tags: ["smoke", "qwen"],
      });
      const parsed = reproJsonV1Schema.parse(mapped);
      assert.deepEqual(parsed.trace.tags, [
        "vllm-bench-import",
        "smoke",
        "qwen",
      ]);
    },
  },
  {
    name: "input/output_length come from per-request arrays when present",
    run() {
      const mapped = mapVllmResultToShareDoc(VLLM_SAMPLE);
      const parsed = reproJsonV1Schema.parse(mapped);
      assert.equal(parsed.benchmark.input_length, 256);
      assert.equal(parsed.benchmark.output_length, 32);
    },
  },
];
