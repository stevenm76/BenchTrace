export type ConcurrencyStrategy =
  | "fixed_1"
  | "ramped"
  | "fixed"
  | "request_rate"
  | "max_valid_concurrency";

export interface BenchmarkProfileDefinition {
  profileId: string;
  profileVersion: string;
  name: string;
  shortLabel: string;
  purpose: string;
  workloadType:
    | "single_user"
    | "coding_agent"
    | "batch"
    | "long_context"
    | "serving"
    | "prefill_decode_split";
  recommendedInputLength: number | null;
  recommendedOutputLength: number | null;
  concurrencyStrategy: ConcurrencyStrategy;
  streamingEnabled: boolean;
  warmupRuns: number;
  randomSeed: number;
  requiredMetrics: string[];
  optionalMetrics: string[];
  ttftSlaMs: number | null;
  tpotSlaMs: number | null;
  compatibleEngines: string[];
  comparabilityNotes: string;
  /**
   * Stream/concurrency levels the native runner uses by default. Single
   * fixed level for chat / code / long-context profiles; sweep for serve.
   * Users can override via --streams; this is just the unsurprising default.
   */
  defaultStreams: number[];
  /** Prompts per stream level. */
  defaultNumPrompts: number;
}

const ALL_ENGINES = [
  "vllm",
  "sglang",
  "llamacpp",
  "ollama",
  "generic_openai",
];

const SERVING_ENGINES = ["vllm", "sglang", "generic_openai"];

export const BENCHMARK_PROFILES = {
  "BT-CHAT-001": {
    profileId: "BT-CHAT-001",
    profileVersion: "1.0",
    name: "Single-user Chat",
    shortLabel: "Chat",
    purpose:
      "Measures interactive single-user chat performance. Prioritizes TTFT, TPOT, and output tok/s.",
    workloadType: "single_user",
    recommendedInputLength: 512,
    recommendedOutputLength: 512,
    concurrencyStrategy: "fixed_1",
    streamingEnabled: true,
    warmupRuns: 2,
    randomSeed: 42,
    requiredMetrics: [
      "output_tokens_per_second",
      "p50_ttft_ms",
      "p95_ttft_ms",
      "p50_tpot_ms",
      "p95_tpot_ms",
    ],
    optionalMetrics: [
      "peak_vram_gb",
      "p99_ttft_ms",
      "tokens_per_watt",
      "gpu_utilization_avg",
    ],
    ttftSlaMs: 500,
    tpotSlaMs: 50,
    compatibleEngines: ALL_ENGINES,
    comparabilityNotes:
      "Comparable when input/output lengths are within 10% and streaming is enabled.",
    defaultStreams: [1],
    defaultNumPrompts: 50,
  },
  "BT-CODE-001": {
    profileId: "BT-CODE-001",
    profileVersion: "1.0",
    name: "Coding Agent",
    shortLabel: "Code",
    purpose:
      "Measures long-prompt coding-assistant workload with large context and large output. Prioritizes prefill speed, output tok/s, and latency.",
    workloadType: "coding_agent",
    recommendedInputLength: 4096,
    recommendedOutputLength: 1024,
    concurrencyStrategy: "fixed_1",
    streamingEnabled: true,
    warmupRuns: 1,
    randomSeed: 42,
    requiredMetrics: [
      "prefill_tokens_per_second",
      "output_tokens_per_second",
      "p95_ttft_ms",
      "p95_tpot_ms",
    ],
    optionalMetrics: [
      "p99_ttft_ms",
      "peak_vram_gb",
      "p95_e2e_latency_ms",
    ],
    ttftSlaMs: 2000,
    tpotSlaMs: 60,
    compatibleEngines: ALL_ENGINES,
    comparabilityNotes:
      "Comparable when input context length is within 25% across runs.",
    defaultStreams: [1],
    defaultNumPrompts: 25,
  },
  "BT-BATCH-001": {
    profileId: "BT-BATCH-001",
    profileVersion: "1.0",
    name: "Batch Generation",
    shortLabel: "Batch",
    purpose:
      "Measures total throughput for batch generation. Prioritizes total tok/s, requests/sec, and failure rate.",
    workloadType: "batch",
    recommendedInputLength: 256,
    recommendedOutputLength: 256,
    concurrencyStrategy: "fixed",
    streamingEnabled: false,
    warmupRuns: 1,
    randomSeed: 42,
    requiredMetrics: [
      "total_tokens_per_second",
      "output_tokens_per_second",
      "requests_per_second",
      "failure_rate",
    ],
    optionalMetrics: ["peak_vram_gb", "gpu_utilization_avg"],
    ttftSlaMs: null,
    tpotSlaMs: null,
    compatibleEngines: SERVING_ENGINES,
    comparabilityNotes:
      "Comparable when concurrency, input length, and output length are identical.",
    defaultStreams: [32],
    defaultNumPrompts: 200,
  },
  "BT-LONGCTX-001": {
    profileId: "BT-LONGCTX-001",
    profileVersion: "1.0",
    name: "Long Context",
    shortLabel: "Long-ctx",
    purpose:
      "Measures behavior at very long contexts. Prioritizes max context tested, prefill speed, VRAM, and absence of CPU offload.",
    workloadType: "long_context",
    recommendedInputLength: 32768,
    recommendedOutputLength: 256,
    concurrencyStrategy: "fixed_1",
    streamingEnabled: true,
    warmupRuns: 1,
    randomSeed: 42,
    requiredMetrics: [
      "prefill_tokens_per_second",
      "p95_ttft_ms",
      "output_tokens_per_second",
      "peak_vram_gb",
    ],
    optionalMetrics: ["p99_ttft_ms", "gpu_utilization_peak"],
    ttftSlaMs: null,
    tpotSlaMs: null,
    compatibleEngines: ALL_ENGINES,
    comparabilityNotes:
      "Comparable only when context length tested is identical and CPU offload settings match.",
    defaultStreams: [1],
    defaultNumPrompts: 10,
  },
  "BT-SERVE-001": {
    profileId: "BT-SERVE-001",
    profileVersion: "1.0",
    name: "Serving Concurrency",
    shortLabel: "Serve",
    purpose:
      "Measures max valid concurrency under SLA. Prioritizes max valid concurrency, throughput at that concurrency, TTFT/TPOT SLAs, and failure rate.",
    workloadType: "serving",
    recommendedInputLength: 1024,
    // 512 output tokens is the floor that lets speculative-decoding /
    // MTP-enabled servers amortize their per-step draft overhead. With
    // output_len=256 the first few mispredictions dominate the decode
    // window and we systematically under-report serving throughput
    // (~30% low vs the model's real-workload number on this hardware).
    recommendedOutputLength: 512,
    concurrencyStrategy: "max_valid_concurrency",
    streamingEnabled: true,
    warmupRuns: 1,
    randomSeed: 42,
    requiredMetrics: [
      "max_valid_concurrency",
      "output_tokens_per_second",
      "p95_ttft_ms",
      "p95_tpot_ms",
      "failure_rate",
    ],
    optionalMetrics: [
      "requests_per_second",
      "p99_ttft_ms",
      "p99_tpot_ms",
    ],
    ttftSlaMs: 5000,
    tpotSlaMs: 100,
    compatibleEngines: SERVING_ENGINES,
    comparabilityNotes:
      "Comparable when SLA thresholds and input/output lengths match.",
    defaultStreams: [1, 2, 4, 8],
    // Halved from 100 so total wall-clock at 4× longer output stays in
    // the same ballpark. Still plenty for stable percentiles.
    defaultNumPrompts: 50,
  },
  "BT-PREFILL-DECODE-001": {
    profileId: "BT-PREFILL-DECODE-001",
    profileVersion: "1.0",
    name: "Prefill vs Decode Split",
    shortLabel: "Prefill/Decode",
    purpose:
      "Separates prefill from decode performance. Measures prefill tok/s independently from decode tok/s.",
    workloadType: "prefill_decode_split",
    recommendedInputLength: 2048,
    recommendedOutputLength: 128,
    concurrencyStrategy: "fixed_1",
    streamingEnabled: true,
    warmupRuns: 2,
    randomSeed: 42,
    requiredMetrics: [
      "prefill_tokens_per_second",
      "output_tokens_per_second",
      "p95_ttft_ms",
    ],
    optionalMetrics: ["p95_tpot_ms", "peak_vram_gb"],
    ttftSlaMs: null,
    tpotSlaMs: null,
    compatibleEngines: ALL_ENGINES,
    comparabilityNotes:
      "Comparable when input and output lengths match exactly. Used to diagnose prefill-bound vs decode-bound bottlenecks.",
    defaultStreams: [1],
    defaultNumPrompts: 25,
  },
} as const satisfies Record<string, BenchmarkProfileDefinition>;

export type BenchmarkProfileId = keyof typeof BENCHMARK_PROFILES;

export function getBenchmarkProfile(
  id: string,
): BenchmarkProfileDefinition | null {
  if (id in BENCHMARK_PROFILES) {
    return BENCHMARK_PROFILES[id as BenchmarkProfileId];
  }
  return null;
}

export const BENCHMARK_PROFILE_LIST: BenchmarkProfileDefinition[] =
  Object.values(BENCHMARK_PROFILES);
