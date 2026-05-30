import assert from "node:assert/strict";

import { manualAdapter } from "../../lib/adapters/manual";
import type { ReproJsonV1 } from "../../lib/schemas/repro-json";

function minimalShareDoc(): ReproJsonV1 {
  return {
    schema_version: "benchtrace.share.v1",
    trace: {
      name: "test-trace",
      created_at: "2026-05-26T00:00:00.000Z",
      tags: ["benchtrace-native", "BT-SERVE-001"],
      fingerprint: "abc123def456",
    },
    hardware: {
      cpu: "AMD Ryzen 9 7950X",
      ram_gb: 64,
      motherboard: "ASUS X670E",
      chipset: "AMD · X670E",
      storage: "/dev/nvme0n1p2 · 2T · ext4",
      os: "Ubuntu 26.04",
      kernel: "7.0.0-15",
      gpus: [
        {
          name: "NVIDIA RTX 5060 Ti",
          vram_gb: 15.9,
          pcie_generation: "Gen 5",
          pcie_width: "x8",
        },
      ],
      driver_version: "595.71.05",
      cuda_version: "13.2",
      rocm_version: null,
      container_runtime: "docker",
      container_image: "vllm/vllm-openai:v0.20.2",
    },
    model: {
      name: "Qwen/Qwen3-32B",
      provider: "vllm",
      repo_or_path: "Qwen/Qwen3-32B",
      architecture: "Qwen3MoeForCausalLM",
      dense_or_moe: "moe",
      parameter_count: 35_000_000_000,
      active_parameter_count: 3_000_000_000,
      quantization: "NVFP4",
      precision: "fp4",
      format: "safetensors",
      tokenizer: "Qwen2Tokenizer",
      claimed_context_length: 262144,
      modality: "text",
      capabilities: ["text"],
      license: "apache-2.0",
      model_hash: "deadbeef",
    },
    loader: {
      name: "vLLM",
      version: "0.20.2",
      openai_compatible: true,
      launch_command: "vllm serve Qwen/Qwen3-32B --tensor-parallel-size 2",
      environment_variables: { VLLM_USE_FLASHINFER: "1" },
      environment: {
        tensor_parallel_size: 2,
        pipeline_parallel_size: null,
        data_parallel_size: null,
        kv_cache_dtype: "fp8",
        gpu_memory_utilization: 0.95,
        max_model_len: 262144,
        flash_attention: null,
        speculative_decoding: null,
        draft_model: null,
        mtp_enabled: null,
        chunked_prefill: null,
        prefix_caching: true,
        cpu_offload: null,
        gpu_residency: null,
      },
    },
    benchmark: {
      tool: "benchtrace",
      tool_version: "0.1.0",
      command: "npx benchtrace serve --base-url http://localhost:8001",
      dataset: "synthetic",
      prompt_source: "mulberry32(seed=42)",
      workload_type: "serving",
      input_length: 512,
      output_length: 256,
      num_prompts: 100,
      concurrency: 8,
      request_rate: null,
      concurrency_strategy: "max_valid_concurrency",
      warmup_runs: 1,
      measurement_duration_seconds: 180,
      random_seed: 42,
      streaming_enabled: true,
      endpoint: "http://localhost:8001/v1/completions",
      ttft_sla_ms: 5000,
      tpot_sla_ms: 100,
    },
    benchmark_profile: {
      profile_id: "BT-SERVE-001",
      profile_version: "1.0",
      purpose: "Max valid concurrency under SLA",
      required_metrics: ["max_valid_concurrency"],
      optional_metrics: [],
      compatible_engines: ["vllm"],
      comparability_notes: "",
    },
    results: {
      best_output_tokens_per_second: 423.5,
      best_total_tokens_per_second: 2974.5,
      prefill_tokens_per_second: null,
      requests_per_second: 1.65,
      max_valid_concurrency: 8,
      p50_ttft_ms: 327,
      p95_ttft_ms: 1035,
      p99_ttft_ms: 1968,
      p50_tpot_ms: 51,
      p95_tpot_ms: 55,
      p99_tpot_ms: 56,
      p50_itl_ms: 34,
      p95_itl_ms: 256,
      p99_itl_ms: 260,
      p50_e2e_latency_ms: 4707,
      p95_e2e_latency_ms: 5771,
      p99_e2e_latency_ms: 6321,
      peak_vram_gb: 30.5,
      average_vram_gb: 30.5,
      peak_ram_gb: null,
      average_ram_gb: null,
      gpu_utilization_avg: 96.9,
      gpu_utilization_peak: 100,
      cpu_utilization_avg: null,
      cpu_utilization_peak: null,
      power_draw_watts_avg: 193.9,
      power_draw_watts_peak: 211.3,
      gpu_temperature_avg: 52.8,
      gpu_temperature_peak: 54,
      tokens_per_watt: 2.18,
      tokens_per_dollar: null,
      cost_per_1m_generated_tokens: null,
      cost_per_1m_total_tokens: null,
      successful_requests: 100,
      failed_requests: 0,
      failure_rate: 0,
    },
    metric_definitions: [],
    cost: null,
    verification: {
      level: "strong",
      artifacts: [
        {
          type: "aggregate_metrics",
          filename: "raw/aggregate-results.json",
          sha256: "abc",
          parser_status: "parsed",
        },
      ],
      missing_fields: [],
      warnings: [],
      notes: null,
    },
  };
}

export const tests = [
  {
    name: "manual adapter accepts a valid share-v1 doc",
    run() {
      const doc = minimalShareDoc();
      const result = manualAdapter.parse(doc);
      assert.equal(result.parserStatus, "parsed");
      assert.equal(result.parserConfidence, 1);
    },
  },
  {
    name: "manual adapter preserves trace identity",
    run() {
      const doc = minimalShareDoc();
      const r = manualAdapter.parse(doc);
      assert.equal(r.trace.name, "test-trace");
      assert.equal(r.trace.fingerprint, "abc123def456");
      assert.deepEqual(r.trace.tags, ["benchtrace-native", "BT-SERVE-001"]);
    },
  },
  {
    name: "manual adapter preserves model fields",
    run() {
      const doc = minimalShareDoc();
      const r = manualAdapter.parse(doc);
      assert.equal(r.model?.name, "Qwen/Qwen3-32B");
      assert.equal(r.model?.quantization, "NVFP4");
      assert.equal(r.model?.precision, "fp4");
      assert.equal(r.model?.tokenizer, "Qwen2Tokenizer");
      assert.equal(r.model?.activeParameterCount, 3_000_000_000);
      assert.equal(r.model?.modelHash, "deadbeef");
    },
  },
  {
    name: "manual adapter preserves loader environment booleans",
    run() {
      const doc = minimalShareDoc();
      const r = manualAdapter.parse(doc);
      assert.equal(r.loaderConfig?.tensorParallelSize, 2);
      assert.equal(r.loaderConfig?.kvCacheDtype, "fp8");
      assert.equal(r.loaderConfig?.gpuMemoryUtilization, 0.95);
      assert.equal(r.loaderConfig?.maxModelLen, 262144);
      assert.equal(r.loaderConfig?.prefixCaching, true);
    },
  },
  {
    name: "manual adapter preserves hardware fields including container_image",
    run() {
      const doc = minimalShareDoc();
      const r = manualAdapter.parse(doc);
      assert.equal(r.hardware?.motherboard, "ASUS X670E");
      assert.equal(r.hardware?.cudaVersion, "13.2");
      assert.equal(r.hardware?.gpuCount, 1);
      assert.equal(
        r.hardware?.containerImage,
        "vllm/vllm-openai:v0.20.2",
      );
    },
  },
  {
    name: "manual adapter rejects an invalid doc",
    run() {
      const bad = { schema_version: "benchtrace.share.v1" };
      const r = manualAdapter.parse(bad);
      assert.equal(r.parserStatus, "failed");
      assert.ok(r.warnings.length > 0);
    },
  },
];
