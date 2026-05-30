/**
 * Seed runner. Idempotent-ish: clears all trace-adjacent tables then inserts
 * five synthetic but realistic traces covering the supported engines.
 *
 *   npm run seed         # populate
 *   npm run seed:clear   # clear only, no insert
 */
import { createHash } from "node:crypto";

import { db, schema, sqlite } from "@/lib/db";

const {
  artifacts,
  benchmarkProfiles,
  costProfiles,
  engines,
  hardwareProfiles,
  loaderConfigs,
  metricDefinitions,
  metricPoints,
  models,
  projects,
  traces,
} = schema;

function fingerprint(parts: (string | number | null | undefined)[]): string {
  const h = createHash("sha256");
  h.update(parts.map((p) => String(p ?? "∅")).join("|"));
  return h.digest("hex").slice(0, 16);
}

function clear() {
  console.log("Clearing existing seed data...");
  // children → parents
  db.delete(metricDefinitions).run();
  db.delete(metricPoints).run();
  db.delete(artifacts).run();
  db.delete(costProfiles).run();
  db.delete(traces).run();
  db.delete(loaderConfigs).run();
  db.delete(benchmarkProfiles).run();
  db.delete(models).run();
  db.delete(engines).run();
  db.delete(hardwareProfiles).run();
  db.delete(projects).run();
}

async function seed() {
  console.log("Seeding BenchTrace database...");

  // ────────── Project ──────────
  const [project] = db
    .insert(projects)
    .values({
      name: "Local lab",
      description: "Synthetic seed project for development.",
    })
    .returning()
    .all();

  // ────────── Hardware profiles ──────────
  const [dualBlackwell] = db
    .insert(hardwareProfiles)
    .values({
      name: "2x RTX 5060 Ti — Ryzen lab box",
      cpu: "AMD Ryzen 9 9900X (12C/24T)",
      ramGb: 128,
      motherboard: "ASRock X870E Taichi",
      chipset: "AMD X870E",
      storage: "Samsung 990 Pro 2TB NVMe",
      os: "Ubuntu 24.04 LTS",
      kernel: "6.11.0-15-generic",
      gpuCount: 2,
      gpuModels: [
        {
          name: "NVIDIA GeForce RTX 5060 Ti 16GB",
          vramGb: 16,
          pcieGeneration: "Gen 5",
          pcieWidth: "x8",
        },
        {
          name: "NVIDIA GeForce RTX 5060 Ti 16GB",
          vramGb: 16,
          pcieGeneration: "Gen 5",
          pcieWidth: "x8",
        },
      ],
      gpuVramGb: 32,
      gpuPcieGeneration: "Gen 5",
      gpuPcieWidth: "x8 / x8",
      driverVersion: "565.77",
      cudaVersion: "13.0",
      containerRuntime: "docker",
      containerImage: "vllm/vllm-openai:v0.13.0",
    })
    .returning()
    .all();

  const [singleAda] = db
    .insert(hardwareProfiles)
    .values({
      name: "RTX 4090 — single-GPU workstation",
      cpu: "Intel Core i9-14900K",
      ramGb: 64,
      motherboard: "ASUS ProArt Z790",
      chipset: "Intel Z790",
      storage: "WD Black SN850X 2TB",
      os: "Pop!_OS 22.04",
      kernel: "6.9.3-76060903-generic",
      gpuCount: 1,
      gpuModels: [
        {
          name: "NVIDIA GeForce RTX 4090",
          vramGb: 24,
          pcieGeneration: "Gen 4",
          pcieWidth: "x16",
        },
      ],
      gpuVramGb: 24,
      gpuPcieGeneration: "Gen 4",
      gpuPcieWidth: "x16",
      driverVersion: "550.120",
      cudaVersion: "12.6",
    })
    .returning()
    .all();

  const [macStudio] = db
    .insert(hardwareProfiles)
    .values({
      name: "Mac Studio M2 Pro",
      cpu: "Apple M2 Pro (12-core)",
      ramGb: 32,
      storage: "Apple SSD 1TB",
      os: "macOS 14.6 Sonoma",
      kernel: "Darwin 23.6.0",
      gpuCount: 1,
      gpuModels: [
        {
          name: "Apple M2 Pro 19-core GPU (unified)",
          vramGb: 32,
          pcieGeneration: "unified",
          pcieWidth: "unified",
        },
      ],
      gpuVramGb: 32,
    })
    .returning()
    .all();

  // ────────── Engines ──────────
  const [vllmEngine] = db
    .insert(engines)
    .values({
      name: "vLLM",
      version: "0.13.0",
      type: "vllm",
      openAICompatible: true,
      containerImage: "vllm/vllm-openai:v0.13.0",
      gitSha: "a1b2c3d",
    })
    .returning()
    .all();

  const [sglangEngine] = db
    .insert(engines)
    .values({
      name: "SGLang",
      version: "0.5.6",
      type: "sglang",
      openAICompatible: true,
      gitSha: "deadbeef",
    })
    .returning()
    .all();

  const [llamacppEngine] = db
    .insert(engines)
    .values({
      name: "llama.cpp",
      version: "b4234",
      type: "llamacpp",
      openAICompatible: true,
      gitSha: "9f8e7d6",
    })
    .returning()
    .all();

  const [ollamaEngine] = db
    .insert(engines)
    .values({
      name: "Ollama",
      version: "0.5.4",
      type: "ollama",
      openAICompatible: true,
    })
    .returning()
    .all();

  // ────────── Models ──────────
  const [qwenMoE] = db
    .insert(models)
    .values({
      provider: "Qwen",
      name: "Qwen3-235B-A22B-Instruct",
      repoOrPath: "Qwen/Qwen3-235B-A22B-Instruct-NVFP4",
      architecture: "Qwen3MoeForCausalLM",
      denseOrMoe: "moe",
      parameterCount: 235e9,
      activeParameterCount: 22e9,
      quantization: "NVFP4",
      precision: "fp4",
      format: "safetensors",
      tokenizer: "Qwen/Qwen3-Tokenizer",
      claimedContextLength: 131072,
      modality: "text",
      capabilities: ["text-generation", "function-calling", "long-context"],
      license: "Apache-2.0",
      modelHash: "sha256:a1b2…f0e1",
    })
    .returning()
    .all();

  const [deepseekDistill] = db
    .insert(models)
    .values({
      provider: "DeepSeek",
      name: "DeepSeek-R1-Distill-Qwen-32B",
      repoOrPath: "casperhansen/deepseek-r1-distill-qwen-32b-awq",
      architecture: "Qwen2ForCausalLM",
      denseOrMoe: "dense",
      parameterCount: 32e9,
      quantization: "AWQ",
      precision: "int4",
      format: "safetensors",
      tokenizer: "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
      claimedContextLength: 131072,
      modality: "text",
      capabilities: ["text-generation", "reasoning"],
      license: "MIT",
    })
    .returning()
    .all();

  const [mistralGguf] = db
    .insert(models)
    .values({
      provider: "Mistral AI",
      name: "Mistral-7B-Instruct-v0.3",
      repoOrPath: "bartowski/Mistral-7B-Instruct-v0.3-GGUF",
      architecture: "LlamaForCausalLM",
      denseOrMoe: "dense",
      parameterCount: 7.25e9,
      quantization: "Q8_0",
      precision: "int8",
      format: "gguf",
      tokenizer: "mistralai/Mistral-7B-Instruct-v0.3",
      claimedContextLength: 32768,
      modality: "text",
      capabilities: ["text-generation"],
      license: "Apache-2.0",
    })
    .returning()
    .all();

  const [ollamaLlama] = db
    .insert(models)
    .values({
      provider: "Meta",
      name: "Llama-3.1-8B-Instruct",
      repoOrPath: "ollama:llama3.1:8b",
      architecture: "LlamaForCausalLM",
      denseOrMoe: "dense",
      parameterCount: 8.03e9,
      quantization: "Q4_K_M",
      precision: "int4",
      format: "gguf",
      tokenizer: "meta-llama/Llama-3.1-8B-Instruct",
      claimedContextLength: 131072,
      modality: "text",
      capabilities: ["text-generation"],
      license: "Llama-3.1-Community",
    })
    .returning()
    .all();

  // ────────── Loader configs ──────────
  const [vllmTp2Fp8_65k] = db
    .insert(loaderConfigs)
    .values({
      engineId: vllmEngine.id,
      launchCommand:
        "vllm serve Qwen/Qwen3-235B-A22B-Instruct-NVFP4 --tensor-parallel-size 2 --kv-cache-dtype fp8 --max-model-len 65536 --gpu-memory-utilization 0.92 --enable-chunked-prefill --enable-prefix-caching",
      environmentVariables: {
        CUDA_VISIBLE_DEVICES: "0,1",
        VLLM_ATTENTION_BACKEND: "FLASHINFER",
      },
      tensorParallelSize: 2,
      pipelineParallelSize: 1,
      dataParallelSize: 1,
      kvCacheDtype: "fp8",
      maxModelLen: 65536,
      gpuMemoryUtilization: 0.92,
      flashAttention: true,
      speculativeDecoding: false,
      chunkedPrefill: true,
      prefixCaching: true,
      cpuOffload: false,
      gpuResidency: "full",
    })
    .returning()
    .all();

  const [vllmTp2Fp8_32k] = db
    .insert(loaderConfigs)
    .values({
      engineId: vllmEngine.id,
      launchCommand:
        "vllm serve Qwen/Qwen3-235B-A22B-Instruct-NVFP4 --tensor-parallel-size 2 --kv-cache-dtype fp8 --max-model-len 32768 --gpu-memory-utilization 0.9 --enable-prefix-caching",
      environmentVariables: {
        CUDA_VISIBLE_DEVICES: "0,1",
      },
      tensorParallelSize: 2,
      pipelineParallelSize: 1,
      dataParallelSize: 1,
      kvCacheDtype: "fp8",
      maxModelLen: 32768,
      gpuMemoryUtilization: 0.9,
      flashAttention: true,
      speculativeDecoding: false,
      chunkedPrefill: false,
      prefixCaching: true,
      cpuOffload: false,
      gpuResidency: "full",
    })
    .returning()
    .all();

  const [sglangSpec] = db
    .insert(loaderConfigs)
    .values({
      engineId: sglangEngine.id,
      launchCommand:
        "python -m sglang.launch_server --model casperhansen/deepseek-r1-distill-qwen-32b-awq --tp 2 --speculative-algorithm EAGLE --speculative-num-steps 3 --kv-cache-dtype fp8_e5m2 --context-length 32768",
      environmentVariables: {
        CUDA_VISIBLE_DEVICES: "0,1",
      },
      tensorParallelSize: 2,
      kvCacheDtype: "fp8_e5m2",
      maxModelLen: 32768,
      gpuMemoryUtilization: 0.88,
      flashAttention: true,
      speculativeDecoding: true,
      draftModel: "EAGLE-DeepSeek-R1-Distill-Qwen-32B",
      mtpEnabled: true,
      chunkedPrefill: true,
      prefixCaching: true,
      cpuOffload: false,
      gpuResidency: "full",
    })
    .returning()
    .all();

  const [llamacppRun] = db
    .insert(loaderConfigs)
    .values({
      engineId: llamacppEngine.id,
      launchCommand:
        "./llama-bench -m models/Mistral-7B-Instruct-v0.3.Q8_0.gguf -ngl 999 -p 512 -n 128 -t 12 -fa 1",
      tensorParallelSize: 1,
      maxModelLen: 8192,
      flashAttention: true,
      gpuResidency: "full",
      cpuOffload: false,
      schedulerSettings: {
        n_threads: 12,
        n_gpu_layers: 999,
        n_batch: 2048,
      },
    })
    .returning()
    .all();

  const [ollamaRun] = db
    .insert(loaderConfigs)
    .values({
      engineId: ollamaEngine.id,
      launchCommand: "ollama run llama3.1:8b",
      environmentVariables: {
        OLLAMA_NUM_PARALLEL: "1",
        OLLAMA_KV_CACHE_TYPE: "q8_0",
      },
      maxModelLen: 8192,
      gpuResidency: "full",
      cpuOffload: false,
      schedulerSettings: {
        num_ctx: 8192,
        num_gpu: 33,
      },
    })
    .returning()
    .all();

  // ────────── Benchmark profile rows (per-trace instance, references BT-SERVE-001 etc.) ──────────
  const [bpVllm65k] = db
    .insert(benchmarkProfiles)
    .values({
      profileId: "BT-SERVE-001",
      profileVersion: "1.0",
      name: "Serving Concurrency",
      purpose:
        "Measures max valid concurrency under SLA. Prioritizes max valid concurrency, throughput at that concurrency, TTFT/TPOT SLAs, and failure rate.",
      tool: "vllm",
      toolVersion: "0.13.0",
      command:
        "python -m vllm.entrypoints.cli.bench serve --model Qwen/Qwen3-235B-A22B-Instruct-NVFP4 --dataset-name random --random-input-len 1024 --random-output-len 256 --num-prompts 500 --request-rate inf --max-concurrency 32",
      dataset: "random",
      promptSource: "vllm.bench random",
      workloadType: "serving",
      inputLength: 1024,
      outputLength: 256,
      numPrompts: 500,
      concurrency: 32,
      requestRate: null,
      concurrencyStrategy: "max_valid_concurrency",
      warmupRuns: 1,
      measurementDurationSeconds: 184.2,
      randomSeed: 42,
      streamingEnabled: true,
      endpoint: "http://localhost:8000/v1/completions",
      ttftSlaMs: 1000,
      tpotSlaMs: 80,
      requiredMetrics: [
        "max_valid_concurrency",
        "output_tokens_per_second",
        "p95_ttft_ms",
        "p95_tpot_ms",
        "failure_rate",
      ],
      optionalMetrics: ["requests_per_second", "p99_ttft_ms", "p99_tpot_ms"],
      compatibleEngines: ["vllm", "sglang", "generic_openai"],
      comparabilityNotes:
        "Comparable when SLA thresholds and input/output lengths match.",
    })
    .returning()
    .all();

  const [bpVllm32k] = db
    .insert(benchmarkProfiles)
    .values({
      profileId: "BT-SERVE-001",
      profileVersion: "1.0",
      name: "Serving Concurrency",
      purpose:
        "Measures max valid concurrency under SLA. Prioritizes max valid concurrency, throughput at that concurrency, TTFT/TPOT SLAs, and failure rate.",
      tool: "vllm",
      toolVersion: "0.13.0",
      command:
        "python -m vllm.entrypoints.cli.bench serve --model Qwen/Qwen3-235B-A22B-Instruct-NVFP4 --dataset-name random --random-input-len 1024 --random-output-len 256 --num-prompts 500 --max-concurrency 32",
      dataset: "random",
      workloadType: "serving",
      inputLength: 1024,
      outputLength: 256,
      numPrompts: 500,
      concurrency: 32,
      concurrencyStrategy: "max_valid_concurrency",
      warmupRuns: 1,
      measurementDurationSeconds: 199.7,
      randomSeed: 42,
      streamingEnabled: true,
      endpoint: "http://localhost:8000/v1/completions",
      ttftSlaMs: 1000,
      tpotSlaMs: 80,
      requiredMetrics: [
        "max_valid_concurrency",
        "output_tokens_per_second",
        "p95_ttft_ms",
        "p95_tpot_ms",
      ],
      compatibleEngines: ["vllm", "sglang"],
    })
    .returning()
    .all();

  const [bpSglang] = db
    .insert(benchmarkProfiles)
    .values({
      profileId: "BT-SERVE-001",
      profileVersion: "1.0",
      name: "Serving Concurrency",
      purpose:
        "Measures max valid concurrency under SLA. Prioritizes max valid concurrency, throughput at that concurrency, TTFT/TPOT SLAs, and failure rate.",
      tool: "sglang",
      toolVersion: "0.5.6",
      command:
        "python -m sglang.bench_serving --backend sglang --dataset-name random --random-input-len 1024 --random-output-len 256 --num-prompts 400 --max-concurrency 24",
      dataset: "random",
      workloadType: "serving",
      inputLength: 1024,
      outputLength: 256,
      numPrompts: 400,
      concurrency: 24,
      concurrencyStrategy: "max_valid_concurrency",
      warmupRuns: 1,
      measurementDurationSeconds: 142.3,
      randomSeed: 42,
      streamingEnabled: true,
      endpoint: "http://localhost:30000",
      ttftSlaMs: 1000,
      tpotSlaMs: 80,
      compatibleEngines: ["sglang"],
    })
    .returning()
    .all();

  const [bpLlamacpp] = db
    .insert(benchmarkProfiles)
    .values({
      profileId: "BT-PREFILL-DECODE-001",
      profileVersion: "1.0",
      name: "Prefill vs Decode Split",
      purpose:
        "Separates prefill from decode performance. Measures prefill tok/s independently from decode tok/s.",
      tool: "llama-bench",
      toolVersion: "b4234",
      command:
        "./llama-bench -m models/Mistral-7B-Instruct-v0.3.Q8_0.gguf -ngl 999 -p 512 -n 128 -t 12 -fa 1",
      dataset: "synthetic",
      workloadType: "prefill_decode_split",
      inputLength: 512,
      outputLength: 128,
      numPrompts: 5,
      concurrency: 1,
      concurrencyStrategy: "fixed_1",
      warmupRuns: 2,
      randomSeed: 42,
      streamingEnabled: false,
      ttftSlaMs: null,
      tpotSlaMs: null,
      compatibleEngines: ["llamacpp"],
    })
    .returning()
    .all();

  const [bpOllama] = db
    .insert(benchmarkProfiles)
    .values({
      profileId: "BT-CHAT-001",
      profileVersion: "1.0",
      name: "Single-user Chat",
      purpose:
        "Measures interactive single-user chat performance. Prioritizes TTFT, TPOT, and output tok/s.",
      tool: "manual",
      toolVersion: null,
      command:
        "curl http://localhost:11434/api/chat -d '{ \"model\": \"llama3.1:8b\", \"messages\": [...] }'",
      dataset: "manual conversation samples",
      workloadType: "single_user",
      inputLength: 512,
      outputLength: 512,
      numPrompts: 20,
      concurrency: 1,
      concurrencyStrategy: "fixed_1",
      warmupRuns: 2,
      streamingEnabled: true,
      endpoint: "http://localhost:11434/api/chat",
      ttftSlaMs: 500,
      tpotSlaMs: 50,
      compatibleEngines: ["ollama"],
    })
    .returning()
    .all();

  // ────────── Traces + metric points + artifacts ──────────
  const baseTraceFields = (projectId: string) => ({
    projectId,
    status: "imported" as const,
  });

  // ── Trace 1: vLLM Qwen TP=2, FP8 KV, 65k ctx ──
  const [tVllm65k] = db
    .insert(traces)
    .values({
      ...baseTraceFields(project.id),
      name: "Qwen3-235B-A22B NVFP4 · vLLM · TP=2 · FP8 KV · 65k ctx · 2x RTX 5060 Ti",
      modelId: qwenMoE.id,
      engineId: vllmEngine.id,
      hardwareProfileId: dualBlackwell.id,
      loaderConfigId: vllmTp2Fp8_65k.id,
      benchmarkProfileId: bpVllm65k.id,
      nativeBenchmarkTool: "vllm",
      contextLength: 65536,
      tags: ["vllm", "moe", "nvfp4", "tp2", "fp8-kv", "65k"],
      startedAt: new Date("2026-05-22T20:14:00Z"),
      completedAt: new Date("2026-05-22T20:17:04Z"),
      verificationLevel: "strong",
      fingerprint: fingerprint([
        "vllm",
        "0.13.0",
        "Qwen3-235B-A22B-Instruct-NVFP4",
        "NVFP4",
        65536,
        "TP=2",
        "BT-SERVE-001",
      ]),
      notes: "Reference run: 2x RTX 5060 Ti, NVFP4 weights, FP8 KV cache.",
    })
    .returning()
    .all();

  const vllm65kPoints = db
    .insert(metricPoints)
    .values([
      {
        traceId: tVllm65k.id,
        concurrency: 1,
        successfulRequests: 50,
        failedRequests: 0,
        failureRate: 0,
        outputTokensPerSecond: 87.4,
        totalTokensPerSecond: 411.2,
        prefillTokensPerSecond: 8214.1,
        requestsPerSecond: 0.34,
        p50TtftMs: 124,
        p95TtftMs: 168,
        p99TtftMs: 198,
        p50TpotMs: 11.3,
        p95TpotMs: 12.6,
        p99TpotMs: 14.1,
        p50ItlMs: 11.2,
        p95ItlMs: 13.0,
        p99ItlMs: 15.1,
        p50E2eLatencyMs: 3010,
        p95E2eLatencyMs: 3402,
        p99E2eLatencyMs: 3680,
        peakVramGb: 28.4,
        averageVramGb: 27.9,
        gpuUtilizationAvg: 71.2,
        gpuUtilizationPeak: 88.1,
        powerDrawWattsAvg: 248.4,
        powerDrawWattsPeak: 285.0,
        gpuTemperatureAvg: 68,
        gpuTemperaturePeak: 72,
        tokensPerWatt: 0.352,
      },
      {
        traceId: tVllm65k.id,
        concurrency: 8,
        successfulRequests: 200,
        failedRequests: 0,
        failureRate: 0,
        outputTokensPerSecond: 612.3,
        totalTokensPerSecond: 2871.0,
        prefillTokensPerSecond: 11428.4,
        requestsPerSecond: 2.4,
        p50TtftMs: 268,
        p95TtftMs: 412,
        p99TtftMs: 488,
        p50TpotMs: 12.8,
        p95TpotMs: 15.4,
        p99TpotMs: 18.2,
        p50ItlMs: 12.7,
        p95ItlMs: 15.6,
        p99ItlMs: 19.0,
        p50E2eLatencyMs: 3494,
        p95E2eLatencyMs: 4128,
        p99E2eLatencyMs: 4670,
        peakVramGb: 29.6,
        averageVramGb: 28.7,
        gpuUtilizationAvg: 88.4,
        gpuUtilizationPeak: 96.2,
        powerDrawWattsAvg: 270.2,
        powerDrawWattsPeak: 292.0,
        gpuTemperatureAvg: 72,
        gpuTemperaturePeak: 76,
        tokensPerWatt: 2.266,
      },
      {
        traceId: tVllm65k.id,
        concurrency: 24,
        successfulRequests: 500,
        failedRequests: 0,
        failureRate: 0,
        outputTokensPerSecond: 1248.6,
        totalTokensPerSecond: 5816.0,
        prefillTokensPerSecond: 12102.0,
        requestsPerSecond: 4.88,
        p50TtftMs: 482,
        p95TtftMs: 884,
        p99TtftMs: 1042,
        p50TpotMs: 14.6,
        p95TpotMs: 22.4,
        p99TpotMs: 28.8,
        p50ItlMs: 14.5,
        p95ItlMs: 22.6,
        p99ItlMs: 30.4,
        p50E2eLatencyMs: 4220,
        p95E2eLatencyMs: 6098,
        p99E2eLatencyMs: 7300,
        peakVramGb: 30.2,
        averageVramGb: 29.4,
        gpuUtilizationAvg: 96.1,
        gpuUtilizationPeak: 99.0,
        powerDrawWattsAvg: 281.8,
        powerDrawWattsPeak: 295.0,
        gpuTemperatureAvg: 75,
        gpuTemperaturePeak: 80,
        tokensPerWatt: 4.431,
      },
    ])
    .returning()
    .all();

  db.insert(metricDefinitions)
    .values([
      {
        metricPointId: vllm65kPoints[0]!.id,
        normalizedMetricName: "output_tokens_per_second",
        rawMetricName: "output_throughput",
        metricSource: "vllm.bench_serving",
        sourceToolVersion: "0.13.0",
        definition: "Output tokens / elapsed seconds across completed requests.",
        aggregationMethod: "mean",
      },
      {
        metricPointId: vllm65kPoints[0]!.id,
        normalizedMetricName: "p95_ttft_ms",
        rawMetricName: "percentiles_ttft_ms[95]",
        metricSource: "vllm.bench_serving",
        sourceToolVersion: "0.13.0",
        definition: "Time to first generated token, p95 across requests.",
        aggregationMethod: "percentile",
        percentile: 95,
      },
    ])
    .run();

  db.insert(artifacts)
    .values([
      {
        traceId: tVllm65k.id,
        type: "benchmark_result",
        filename: "benchmark_result.json",
        sha256:
          "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678901234567890abcdef123456",
        parser: "vllm",
        parserStatus: "parsed",
        parserConfidence: 0.97,
        rawJson: JSON.stringify(
          {
            backend: "vllm",
            request_throughput: 4.88,
            output_throughput: 1248.6,
            total_throughput: 5816.0,
            num_prompts: 500,
            duration: 184.2,
          },
          null,
          2,
        ),
      },
      {
        traceId: tVllm65k.id,
        type: "server_log",
        filename: "server.log",
        sha256:
          "0011223344556677889900aabbccddeeff112233445566778899aabbccddeeff",
        parser: "manual",
        parserStatus: "manual",
      },
      {
        traceId: tVllm65k.id,
        type: "nvidia_smi",
        filename: "nvidia-smi.txt",
        parser: "manual",
        parserStatus: "manual",
      },
    ])
    .run();

  // ── Trace 2: vLLM Qwen TP=2, FP8 KV, 32k ctx (comparison) ──
  const [tVllm32k] = db
    .insert(traces)
    .values({
      ...baseTraceFields(project.id),
      name: "Qwen3-235B-A22B NVFP4 · vLLM · TP=2 · FP8 KV · 32k ctx · 2x RTX 5060 Ti",
      modelId: qwenMoE.id,
      engineId: vllmEngine.id,
      hardwareProfileId: dualBlackwell.id,
      loaderConfigId: vllmTp2Fp8_32k.id,
      benchmarkProfileId: bpVllm32k.id,
      nativeBenchmarkTool: "vllm",
      contextLength: 32768,
      tags: ["vllm", "moe", "nvfp4", "tp2", "fp8-kv", "32k", "comparison"],
      startedAt: new Date("2026-05-22T21:02:00Z"),
      completedAt: new Date("2026-05-22T21:05:20Z"),
      verificationLevel: "strong",
      fingerprint: fingerprint([
        "vllm",
        "0.13.0",
        "Qwen3-235B-A22B-Instruct-NVFP4",
        "NVFP4",
        32768,
        "TP=2",
        "BT-SERVE-001",
      ]),
      notes:
        "Lower context. Compared against the 65k run to surface ctx-vs-throughput tradeoff.",
    })
    .returning()
    .all();

  db.insert(metricPoints)
    .values([
      {
        traceId: tVllm32k.id,
        concurrency: 1,
        successfulRequests: 50,
        failedRequests: 0,
        failureRate: 0,
        outputTokensPerSecond: 94.8,
        totalTokensPerSecond: 442.0,
        prefillTokensPerSecond: 9320.0,
        requestsPerSecond: 0.37,
        p50TtftMs: 108,
        p95TtftMs: 142,
        p99TtftMs: 165,
        p50TpotMs: 10.4,
        p95TpotMs: 11.6,
        p99TpotMs: 13.0,
        p50ItlMs: 10.3,
        p95ItlMs: 11.9,
        p99ItlMs: 14.0,
        p50E2eLatencyMs: 2774,
        p95E2eLatencyMs: 3060,
        p99E2eLatencyMs: 3344,
        peakVramGb: 24.8,
        averageVramGb: 24.4,
        gpuUtilizationAvg: 68.0,
        gpuUtilizationPeak: 84.4,
        powerDrawWattsAvg: 240.0,
        powerDrawWattsPeak: 278.0,
      },
      {
        traceId: tVllm32k.id,
        concurrency: 24,
        successfulRequests: 500,
        failedRequests: 0,
        failureRate: 0,
        outputTokensPerSecond: 1320.4,
        totalTokensPerSecond: 6128.0,
        prefillTokensPerSecond: 13044.0,
        requestsPerSecond: 5.16,
        p50TtftMs: 442,
        p95TtftMs: 810,
        p99TtftMs: 968,
        p50TpotMs: 13.9,
        p95TpotMs: 21.0,
        p99TpotMs: 27.0,
        p50ItlMs: 13.8,
        p95ItlMs: 21.3,
        p99ItlMs: 28.4,
        p50E2eLatencyMs: 3980,
        p95E2eLatencyMs: 5810,
        p99E2eLatencyMs: 6940,
        peakVramGb: 26.2,
        averageVramGb: 25.5,
        gpuUtilizationAvg: 95.4,
        gpuUtilizationPeak: 99.0,
        powerDrawWattsAvg: 278.0,
        powerDrawWattsPeak: 293.0,
      },
    ])
    .run();

  db.insert(artifacts)
    .values({
      traceId: tVllm32k.id,
      type: "benchmark_result",
      filename: "benchmark_result.json",
      sha256:
        "b2c3d4e5f60718293a4b5c6d7e8f9012345678901234567890abcdef12345601",
      parser: "vllm",
      parserStatus: "parsed",
      parserConfidence: 0.97,
    })
    .run();

  // ── Trace 3: SGLang DeepSeek with speculative decoding / MTP ──
  const [tSglang] = db
    .insert(traces)
    .values({
      ...baseTraceFields(project.id),
      name: "DeepSeek-R1-Distill-Qwen-32B AWQ · SGLang · TP=2 · spec-decode + MTP · 32k ctx",
      modelId: deepseekDistill.id,
      engineId: sglangEngine.id,
      hardwareProfileId: dualBlackwell.id,
      loaderConfigId: sglangSpec.id,
      benchmarkProfileId: bpSglang.id,
      nativeBenchmarkTool: "sglang",
      contextLength: 32768,
      tags: ["sglang", "awq", "tp2", "spec-decode", "mtp"],
      startedAt: new Date("2026-05-21T18:30:00Z"),
      completedAt: new Date("2026-05-21T18:33:00Z"),
      verificationLevel: "medium",
      fingerprint: fingerprint([
        "sglang",
        "0.5.6",
        "DeepSeek-R1-Distill-Qwen-32B",
        "AWQ",
        32768,
        "TP=2",
        "BT-SERVE-001",
      ]),
      notes:
        "Speculative decoding with EAGLE draft, MTP enabled. Tool-version → parser support is partial; sglang_adapter is a stub.",
    })
    .returning()
    .all();

  db.insert(metricPoints)
    .values([
      {
        traceId: tSglang.id,
        concurrency: 1,
        successfulRequests: 40,
        failedRequests: 0,
        failureRate: 0,
        outputTokensPerSecond: 142.0,
        totalTokensPerSecond: 654.0,
        prefillTokensPerSecond: 7102.0,
        p50TtftMs: 142,
        p95TtftMs: 191,
        p99TtftMs: 224,
        p50TpotMs: 7.0,
        p95TpotMs: 8.4,
        p99TpotMs: 10.0,
        peakVramGb: 22.4,
        averageVramGb: 21.8,
      },
      {
        traceId: tSglang.id,
        concurrency: 16,
        successfulRequests: 400,
        failedRequests: 2,
        failureRate: 0.005,
        outputTokensPerSecond: 1452.0,
        totalTokensPerSecond: 6810.0,
        prefillTokensPerSecond: 8420.0,
        p50TtftMs: 380,
        p95TtftMs: 740,
        p99TtftMs: 902,
        p50TpotMs: 11.0,
        p95TpotMs: 18.2,
        p99TpotMs: 24.0,
        peakVramGb: 24.0,
        averageVramGb: 23.2,
      },
    ])
    .run();

  db.insert(artifacts)
    .values({
      traceId: tSglang.id,
      type: "benchmark_result",
      filename: "sglang_bench.txt",
      parser: "sglang",
      parserStatus: "manual",
      rawJson: null,
    })
    .run();

  // ── Trace 4: llama.cpp Mistral GGUF — prefill vs decode ──
  const [tLlamacpp] = db
    .insert(traces)
    .values({
      ...baseTraceFields(project.id),
      name: "Mistral-7B-Instruct-v0.3 Q8_0 GGUF · llama.cpp · 1x RTX 4090 · flash-attn",
      modelId: mistralGguf.id,
      engineId: llamacppEngine.id,
      hardwareProfileId: singleAda.id,
      loaderConfigId: llamacppRun.id,
      benchmarkProfileId: bpLlamacpp.id,
      nativeBenchmarkTool: "llama-bench",
      contextLength: 8192,
      tags: ["llamacpp", "gguf", "q8_0", "flash-attn", "single-gpu"],
      startedAt: new Date("2026-05-20T22:14:00Z"),
      completedAt: new Date("2026-05-20T22:15:00Z"),
      verificationLevel: "medium",
      fingerprint: fingerprint([
        "llamacpp",
        "b4234",
        "Mistral-7B-Instruct-v0.3",
        "Q8_0",
        8192,
        "ngl=999",
        "BT-PREFILL-DECODE-001",
      ]),
      notes:
        "llama-bench measures prefill (PP) and decode (TG) separately; no streaming / serving metrics available.",
    })
    .returning()
    .all();

  db.insert(metricPoints)
    .values({
      traceId: tLlamacpp.id,
      concurrency: 1,
      successfulRequests: 5,
      failedRequests: 0,
      failureRate: 0,
      outputTokensPerSecond: 168.4,
      totalTokensPerSecond: null,
      prefillTokensPerSecond: 4218.0,
      // TTFT / TPOT / ITL not available from llama-bench
      peakVramGb: 7.8,
      averageVramGb: 7.6,
      gpuUtilizationAvg: 96.0,
      gpuUtilizationPeak: 99.0,
      powerDrawWattsAvg: 320.0,
      powerDrawWattsPeak: 410.0,
      tokensPerWatt: 0.526,
    })
    .run();

  db.insert(artifacts)
    .values({
      traceId: tLlamacpp.id,
      type: "benchmark_result",
      filename: "llama-bench.json",
      sha256:
        "c4d5e6f7081929304a5b6c7d8e9f0a1b2c3d4e5f6071829304a5b6c7d8e9f001",
      parser: "llamacpp",
      parserStatus: "parsed",
      parserConfidence: 0.95,
      rawJson: JSON.stringify(
        {
          model_filename: "Mistral-7B-Instruct-v0.3.Q8_0.gguf",
          n_prompt: 512,
          n_gen: 128,
          t_pp_ms: 121.4,
          t_tg_ms: 760.2,
          n_gpu_layers: 999,
          n_threads: 12,
        },
        null,
        2,
      ),
    })
    .run();

  // ── Trace 5: Ollama Llama-3.1 8B on Mac Studio M2 Pro ──
  const [tOllama] = db
    .insert(traces)
    .values({
      ...baseTraceFields(project.id),
      name: "Llama-3.1-8B-Instruct Q4_K_M · Ollama · M2 Pro · num_ctx 8192",
      modelId: ollamaLlama.id,
      engineId: ollamaEngine.id,
      hardwareProfileId: macStudio.id,
      loaderConfigId: ollamaRun.id,
      benchmarkProfileId: bpOllama.id,
      nativeBenchmarkTool: "ollama",
      contextLength: 8192,
      tags: ["ollama", "gguf", "q4_k_m", "apple-silicon", "chat"],
      startedAt: new Date("2026-05-19T15:10:00Z"),
      completedAt: new Date("2026-05-19T15:13:00Z"),
      verificationLevel: "weak",
      fingerprint: fingerprint([
        "ollama",
        "0.5.4",
        "llama3.1:8b",
        "Q4_K_M",
        8192,
        "M2",
        "BT-CHAT-001",
      ]),
      notes:
        "Manual chat-style measurements. No raw artifact captured; ollama_adapter is a stub.",
    })
    .returning()
    .all();

  db.insert(metricPoints)
    .values({
      traceId: tOllama.id,
      concurrency: 1,
      successfulRequests: 20,
      failedRequests: 0,
      failureRate: 0,
      outputTokensPerSecond: 41.8,
      totalTokensPerSecond: 168.2,
      prefillTokensPerSecond: 412.0,
      p50TtftMs: 612,
      p95TtftMs: 824,
      p99TtftMs: 912,
      p50TpotMs: 23.6,
      p95TpotMs: 26.4,
      p99TpotMs: 28.2,
      peakVramGb: 5.4,
      averageVramGb: 5.2,
      // No nvidia-smi here — unified memory; values inferred from `ollama ps`.
    })
    .run();

  console.log(
    `\nSeeded ${[tVllm65k, tVllm32k, tSglang, tLlamacpp, tOllama].length} traces.`,
  );
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--clear")) {
    clear();
    sqlite.close();
    return;
  }
  clear();
  await seed();
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
