import { z } from "zod";

export const VERIFICATION_LEVELS = [
  "strong",
  "medium",
  "weak",
  "suspicious",
] as const;

export const traceMetaSchema = z.object({
  name: z.string(),
  created_at: z.string(),
  tags: z.array(z.string()),
  fingerprint: z.string().nullable(),
});

export const gpuSchema = z.object({
  name: z.string(),
  vram_gb: z.number().nullable(),
  pcie_generation: z.string().nullable(),
  pcie_width: z.string().nullable(),
});

export const hardwareSchema = z.object({
  cpu: z.string().nullable(),
  ram_gb: z.number().nullable(),
  motherboard: z.string().nullable(),
  chipset: z.string().nullable(),
  storage: z.string().nullable(),
  os: z.string().nullable(),
  kernel: z.string().nullable(),
  gpus: z.array(gpuSchema),
  driver_version: z.string().nullable(),
  cuda_version: z.string().nullable(),
  rocm_version: z.string().nullable(),
  container_runtime: z.string().nullable(),
  container_image: z.string().nullable(),
});

export const modelSchema = z.object({
  name: z.string(),
  provider: z.string().nullable(),
  repo_or_path: z.string().nullable(),
  architecture: z.string().nullable(),
  dense_or_moe: z.string().nullable(),
  parameter_count: z.number().nullable(),
  active_parameter_count: z.number().nullable(),
  quantization: z.string().nullable(),
  precision: z.string().nullable(),
  format: z.string().nullable(),
  tokenizer: z.string().nullable(),
  claimed_context_length: z.number().nullable(),
  modality: z.string().nullable(),
  capabilities: z.array(z.string()),
  license: z.string().nullable(),
  model_hash: z.string().nullable(),
});

export const loaderEnvironmentSchema = z.object({
  tensor_parallel_size: z.number().nullable(),
  pipeline_parallel_size: z.number().nullable(),
  data_parallel_size: z.number().nullable(),
  kv_cache_dtype: z.string().nullable(),
  gpu_memory_utilization: z.number().nullable(),
  max_model_len: z.number().nullable(),
  flash_attention: z.boolean().nullable(),
  speculative_decoding: z.boolean().nullable(),
  draft_model: z.string().nullable(),
  mtp_enabled: z.boolean().nullable(),
  chunked_prefill: z.boolean().nullable(),
  prefix_caching: z.boolean().nullable(),
  cpu_offload: z.boolean().nullable(),
  gpu_residency: z.string().nullable(),
});

export const loaderSchema = z.object({
  name: z.string(),
  version: z.string().nullable(),
  openai_compatible: z.boolean().nullable(),
  launch_command: z.string().nullable(),
  environment_variables: z.record(z.string(), z.string()),
  environment: loaderEnvironmentSchema,
});

export const randomTokenMetadataSchema = z.object({
  /** Random-token sampling mode: BenchTrace-conservative vs vLLM-aligned. */
  mode: z.enum(["benchtrace", "vllm-compatible"]).nullable(),
  /** Tokenizer vocabulary size the sampler drew from. */
  vocab_size: z.number().nullable(),
  /** Inclusive minimum token id sampled. */
  token_id_min: z.number().nullable(),
  /** Inclusive maximum token id sampled. */
  token_id_max: z.number().nullable(),
  /** How special tokens were treated ("excluded" | "included" | "unknown"). */
  special_token_policy: z.string().nullable(),
  /** Where the vocab size came from ("server_tokenize_probe" | "config" | "fallback"). */
  tokenizer_source: z.string().nullable(),
  /** How token ids became prompt text ("server_detokenize" | "local" | "none"). */
  detokenize_method: z.string().nullable(),
  /** Seed used for the token sampler RNG. */
  random_seed: z.number().nullable(),
  /** Version tag for the sampler algorithm so changes are auditable. */
  random_token_sampler_version: z.string().nullable(),
});

export const benchmarkSchema = z.object({
  tool: z.string().nullable(),
  tool_version: z.string().nullable(),
  command: z.string().nullable(),
  dataset: z.string().nullable(),
  prompt_source: z.string().nullable(),
  workload_type: z.string().nullable(),
  input_length: z.number().nullable(),
  output_length: z.number().nullable(),
  num_prompts: z.number().nullable(),
  concurrency: z.number().nullable(),
  request_rate: z.number().nullable(),
  concurrency_strategy: z.string().nullable(),
  warmup_runs: z.number().nullable(),
  measurement_duration_seconds: z.number().nullable(),
  random_seed: z.number().nullable(),
  streaming_enabled: z.boolean().nullable(),
  endpoint: z.string().nullable(),
  ttft_sla_ms: z.number().nullable(),
  tpot_sla_ms: z.number().nullable(),
  benchmark_mode: z.enum(["native", "vllm-compatible"]).nullable().optional(),
  /** Which metric family is the headline; the run always computes both. */
  metric_mode: z.enum(["native", "vllm-compatible", "both"]).nullable().optional(),
  api_format: z.enum(["chat", "completions"]).nullable().optional(),
  ignore_eos: z.boolean().nullable().optional(),
  extra_body: z.record(z.string(), z.unknown()).nullable().optional(),
  range_ratio: z.number().nullable().optional(),
  /**
   * Random-token dataset provenance — what makes the synthetic workload
   * byte-comparable (or not) to vLLM's RandomDataset.
   */
  random_token_metadata: randomTokenMetadataSchema.nullable().optional(),
});

export const benchmarkProfileSchema = z.object({
  profile_id: z.string(),
  profile_version: z.string(),
  purpose: z.string(),
  required_metrics: z.array(z.string()),
  optional_metrics: z.array(z.string()),
  compatible_engines: z.array(z.string()),
  comparability_notes: z.string(),
});

export const resultsSchema = z.object({
  best_output_tokens_per_second: z.number().nullable(),
  best_total_tokens_per_second: z.number().nullable(),
  prefill_tokens_per_second: z.number().nullable(),
  requests_per_second: z.number().nullable(),
  max_valid_concurrency: z.number().nullable(),
  p50_ttft_ms: z.number().nullable(),
  p95_ttft_ms: z.number().nullable(),
  p99_ttft_ms: z.number().nullable(),
  // p*_tpot_ms carry the vLLM-compatible token-normalized TPOT — the family
  // that is safe to compare against `vllm bench serve`. The BenchTrace-native
  // mean chunk-gap latency lives in the p*_chunk_gap_ms fields below and must
  // never be presented under a "TPOT" label.
  p50_tpot_ms: z.number().nullable(),
  p95_tpot_ms: z.number().nullable(),
  p99_tpot_ms: z.number().nullable(),
  p50_chunk_gap_ms: z.number().nullable().optional(),
  p95_chunk_gap_ms: z.number().nullable().optional(),
  p99_chunk_gap_ms: z.number().nullable().optional(),
  mean_chunks_per_request: z.number().nullable().optional(),
  mean_tokens_per_chunk: z.number().nullable().optional(),
  output_token_count_source: z
    .enum(["server_usage", "estimated", "unknown"])
    .nullable()
    .optional(),
  p50_itl_ms: z.number().nullable(),
  p95_itl_ms: z.number().nullable(),
  p99_itl_ms: z.number().nullable(),
  p50_e2e_latency_ms: z.number().nullable(),
  p95_e2e_latency_ms: z.number().nullable(),
  p99_e2e_latency_ms: z.number().nullable(),
  peak_vram_gb: z.number().nullable(),
  average_vram_gb: z.number().nullable(),
  peak_ram_gb: z.number().nullable(),
  average_ram_gb: z.number().nullable(),
  gpu_utilization_avg: z.number().nullable(),
  gpu_utilization_peak: z.number().nullable(),
  cpu_utilization_avg: z.number().nullable(),
  cpu_utilization_peak: z.number().nullable(),
  power_draw_watts_avg: z.number().nullable(),
  power_draw_watts_peak: z.number().nullable(),
  gpu_temperature_avg: z.number().nullable(),
  gpu_temperature_peak: z.number().nullable(),
  tokens_per_watt: z.number().nullable(),
  tokens_per_dollar: z.number().nullable(),
  cost_per_1m_generated_tokens: z.number().nullable(),
  cost_per_1m_total_tokens: z.number().nullable(),
  successful_requests: z.number().nullable(),
  failed_requests: z.number().nullable(),
  failure_rate: z.number().nullable(),
});

export const metricDefinitionSchema = z.object({
  normalized_metric_name: z.string(),
  raw_metric_name: z.string().nullable(),
  metric_source: z.string().nullable(),
  source_tool_version: z.string().nullable(),
  definition: z.string().nullable(),
  aggregation_method: z.string().nullable(),
  percentile: z.number().nullable(),
  notes: z.string().nullable(),
});

export const costSchema = z.object({
  estimated_system_cost: z.number().nullable(),
  estimated_gpu_cost: z.number().nullable(),
  currency: z.string().nullable(),
  cost_basis_notes: z.string().nullable(),
});

export const verificationSchema = z.object({
  level: z.enum(VERIFICATION_LEVELS),
  artifacts: z.array(
    z.object({
      type: z.string(),
      filename: z.string(),
      sha256: z.string().nullable(),
      parser_status: z.string().nullable(),
    }),
  ),
  missing_fields: z.array(z.string()),
  warnings: z.array(z.string()),
  notes: z.string().nullable(),
});

/**
 * Records whether this run can be honestly compared against `vllm bench serve`.
 * Each `same_*` field is a tri-state: true (matches vLLM convention), false
 * (differs), or null (cannot be determined without the paired vLLM run, e.g.
 * exact prompt bytes). The `verdict` summarizes comparability.
 */
export const comparisonValiditySchema = z.object({
  same_endpoint: z.boolean().nullable(),
  same_api_format: z.boolean().nullable(),
  same_dataset: z.boolean().nullable(),
  same_dataset_bytes: z.boolean().nullable(),
  same_prompt_bytes: z.boolean().nullable(),
  same_payload_fields: z.boolean().nullable().optional(),
  same_input_length_policy: z.boolean().nullable(),
  same_output_length_policy: z.boolean().nullable(),
  same_ignore_eos: z.boolean().nullable(),
  same_max_tokens: z.boolean().nullable(),
  same_temperature: z.boolean().nullable(),
  same_seed: z.boolean().nullable(),
  same_tokenizer_vocab: z.boolean().nullable(),
  same_metric_formula: z.boolean().nullable(),
  same_output_tokens: z.boolean().nullable().optional(),
  same_accepted_tokens_per_chunk: z.boolean().nullable().optional(),
  has_reference: z.boolean().optional(),
  output_token_count_source: z
    .enum(["server_usage", "estimated", "unknown"])
    .nullable(),
  verdict: z.enum([
    "strongly_comparable",
    "weakly_comparable",
    "not_comparable",
  ]),
  notes: z.array(z.string()),
});

export const reproJsonV1Schema = z.object({
  schema_version: z.literal("benchtrace.share.v1"),
  trace: traceMetaSchema,
  hardware: hardwareSchema,
  model: modelSchema,
  loader: loaderSchema,
  benchmark: benchmarkSchema,
  benchmark_profile: benchmarkProfileSchema.nullable(),
  results: resultsSchema,
  metric_definitions: z.array(metricDefinitionSchema),
  cost: costSchema.nullable(),
  comparison_validity: comparisonValiditySchema.nullable().optional(),
  verification: verificationSchema,
});

export type ReproJsonV1 = z.infer<typeof reproJsonV1Schema>;
export type ComparisonValidity = z.infer<typeof comparisonValiditySchema>;
export type RandomTokenMetadata = z.infer<typeof randomTokenMetadataSchema>;
export type ReproVerification = z.infer<typeof verificationSchema>;
export type ReproResults = z.infer<typeof resultsSchema>;
export type ReproMetricDefinition = z.infer<typeof metricDefinitionSchema>;
