import { createId } from "@paralleldrive/cuid2";
import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => createId());

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

export type ParserStatus = "parsed" | "partially_parsed" | "failed" | "manual";
export type VerificationLevel = "strong" | "medium" | "weak" | "suspicious";
export type TraceStatus = "completed" | "running" | "failed" | "imported";
export type EngineType =
  | "vllm"
  | "sglang"
  | "llamacpp"
  | "ollama"
  | "generic_openai"
  | "other";

export const projects = sqliteTable("projects", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const models = sqliteTable(
  "models",
  {
    id: id(),
    provider: text("provider"),
    name: text("name").notNull(),
    repoOrPath: text("repo_or_path"),
    architecture: text("architecture"),
    denseOrMoe: text("dense_or_moe"),
    parameterCount: real("parameter_count"),
    activeParameterCount: real("active_parameter_count"),
    quantization: text("quantization"),
    precision: text("precision"),
    format: text("format"),
    tokenizer: text("tokenizer"),
    claimedContextLength: integer("claimed_context_length"),
    modality: text("modality"),
    capabilities: text("capabilities", { mode: "json" }).$type<string[]>(),
    license: text("license"),
    modelHash: text("model_hash"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("models_name_idx").on(t.name),
    index("models_quantization_idx").on(t.quantization),
    index("models_architecture_idx").on(t.architecture),
  ],
);

export const engines = sqliteTable(
  "engines",
  {
    id: id(),
    name: text("name").notNull(),
    version: text("version"),
    type: text("type").$type<EngineType>().notNull(),
    openAICompatible: integer("openai_compatible", { mode: "boolean" }),
    containerImage: text("container_image"),
    gitSha: text("git_sha"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("engines_type_idx").on(t.type),
    index("engines_version_idx").on(t.version),
  ],
);

export type GpuInfo = {
  name: string;
  vramGb?: number | null;
  pcieGeneration?: string | null;
  pcieWidth?: string | null;
};

export const hardwareProfiles = sqliteTable("hardware_profiles", {
  id: id(),
  name: text("name").notNull(),
  cpu: text("cpu"),
  ramGb: real("ram_gb"),
  motherboard: text("motherboard"),
  chipset: text("chipset"),
  storage: text("storage"),
  os: text("os"),
  kernel: text("kernel"),
  gpuCount: integer("gpu_count"),
  gpuModels: text("gpu_models", { mode: "json" }).$type<GpuInfo[]>(),
  gpuVramGb: real("gpu_vram_gb"),
  gpuPcieGeneration: text("gpu_pcie_generation"),
  gpuPcieWidth: text("gpu_pcie_width"),
  driverVersion: text("driver_version"),
  cudaVersion: text("cuda_version"),
  rocmVersion: text("rocm_version"),
  containerRuntime: text("container_runtime"),
  containerImage: text("container_image"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const loaderConfigs = sqliteTable("loader_configs", {
  id: id(),
  engineId: text("engine_id")
    .notNull()
    .references(() => engines.id, { onDelete: "cascade" }),
  launchCommand: text("launch_command"),
  environmentVariables: text("environment_variables", {
    mode: "json",
  }).$type<Record<string, string>>(),
  tensorParallelSize: integer("tensor_parallel_size"),
  pipelineParallelSize: integer("pipeline_parallel_size"),
  dataParallelSize: integer("data_parallel_size"),
  kvCacheDtype: text("kv_cache_dtype"),
  maxModelLen: integer("max_model_len"),
  gpuMemoryUtilization: real("gpu_memory_utilization"),
  flashAttention: integer("flash_attention", { mode: "boolean" }),
  speculativeDecoding: integer("speculative_decoding", { mode: "boolean" }),
  draftModel: text("draft_model"),
  mtpEnabled: integer("mtp_enabled", { mode: "boolean" }),
  chunkedPrefill: integer("chunked_prefill", { mode: "boolean" }),
  prefixCaching: integer("prefix_caching", { mode: "boolean" }),
  cpuOffload: integer("cpu_offload", { mode: "boolean" }),
  gpuResidency: text("gpu_residency"),
  batchSizeSettings: text("batch_size_settings", {
    mode: "json",
  }).$type<Record<string, unknown>>(),
  schedulerSettings: text("scheduler_settings", {
    mode: "json",
  }).$type<Record<string, unknown>>(),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const benchmarkProfiles = sqliteTable("benchmark_profiles", {
  id: id(),
  profileId: text("profile_id"),
  profileVersion: text("profile_version"),
  name: text("name").notNull(),
  purpose: text("purpose"),
  tool: text("tool"),
  toolVersion: text("tool_version"),
  command: text("command"),
  dataset: text("dataset"),
  promptSource: text("prompt_source"),
  workloadType: text("workload_type"),
  inputLength: integer("input_length"),
  outputLength: integer("output_length"),
  numPrompts: integer("num_prompts"),
  concurrency: integer("concurrency"),
  requestRate: real("request_rate"),
  concurrencyStrategy: text("concurrency_strategy"),
  warmupRuns: integer("warmup_runs"),
  measurementDurationSeconds: real("measurement_duration_seconds"),
  randomSeed: integer("random_seed"),
  streamingEnabled: integer("streaming_enabled", { mode: "boolean" }),
  endpoint: text("endpoint"),
  ttftSlaMs: real("ttft_sla_ms"),
  tpotSlaMs: real("tpot_sla_ms"),
  requiredMetrics: text("required_metrics", { mode: "json" }).$type<string[]>(),
  optionalMetrics: text("optional_metrics", { mode: "json" }).$type<string[]>(),
  compatibleEngines: text("compatible_engines", {
    mode: "json",
  }).$type<string[]>(),
  comparabilityNotes: text("comparability_notes"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const traces = sqliteTable(
  "traces",
  {
    id: id(),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    status: text("status").$type<TraceStatus>().notNull().default("imported"),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "restrict" }),
    engineId: text("engine_id")
      .notNull()
      .references(() => engines.id, { onDelete: "restrict" }),
    hardwareProfileId: text("hardware_profile_id")
      .notNull()
      .references(() => hardwareProfiles.id, { onDelete: "restrict" }),
    loaderConfigId: text("loader_config_id").references(
      () => loaderConfigs.id,
      { onDelete: "set null" },
    ),
    benchmarkProfileId: text("benchmark_profile_id").references(
      () => benchmarkProfiles.id,
      { onDelete: "set null" },
    ),
    nativeBenchmarkTool: text("native_benchmark_tool"),
    // Which metric family is the headline for this trace:
    // "native" | "vllm-compatible" | "both" | null (legacy/unspecified).
    metricMode: text("metric_mode"),
    contextLength: integer("context_length"),
    tags: text("tags", { mode: "json" }).$type<string[]>(),
    notes: text("notes"),
    verificationLevel: text("verification_level")
      .$type<VerificationLevel>()
      .notNull()
      .default("weak"),
    fingerprint: text("fingerprint"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("traces_model_id_idx").on(t.modelId),
    index("traces_engine_id_idx").on(t.engineId),
    index("traces_verification_idx").on(t.verificationLevel),
    index("traces_created_at_idx").on(t.createdAt),
    index("traces_fingerprint_idx").on(t.fingerprint),
  ],
);

export const metricPoints = sqliteTable(
  "metric_points",
  {
    id: id(),
    traceId: text("trace_id")
      .notNull()
      .references(() => traces.id, { onDelete: "cascade" }),
    concurrency: integer("concurrency"),
    requestRate: real("request_rate"),
    successfulRequests: integer("successful_requests"),
    failedRequests: integer("failed_requests"),
    failureRate: real("failure_rate"),
    outputTokensPerSecond: real("output_tokens_per_second"),
    totalTokensPerSecond: real("total_tokens_per_second"),
    prefillTokensPerSecond: real("prefill_tokens_per_second"),
    requestsPerSecond: real("requests_per_second"),
    p50TtftMs: real("p50_ttft_ms"),
    p95TtftMs: real("p95_ttft_ms"),
    p99TtftMs: real("p99_ttft_ms"),
    p50TpotMs: real("p50_tpot_ms"),
    p95TpotMs: real("p95_tpot_ms"),
    p99TpotMs: real("p99_tpot_ms"),
    // Native chunk-gap latency family — mean inter-chunk arrival gap, NOT
    // token-normalized. Diverges from p*TpotMs (token-normalized) when an SSE
    // chunk carries more than one token (e.g. speculative decoding / MTP).
    // Kept separate so the dashboard never silently shows chunk-gap as "TPOT".
    p50ChunkGapMs: real("p50_chunk_gap_ms"),
    p95ChunkGapMs: real("p95_chunk_gap_ms"),
    p99ChunkGapMs: real("p99_chunk_gap_ms"),
    meanChunksPerRequest: real("mean_chunks_per_request"),
    meanTokensPerChunk: real("mean_tokens_per_chunk"),
    // Provenance of the output token count used for token-normalized TPOT:
    // "server_usage" | "estimated" | "unknown".
    outputTokenCountSource: text("output_token_count_source"),
    p50ItlMs: real("p50_itl_ms"),
    p95ItlMs: real("p95_itl_ms"),
    p99ItlMs: real("p99_itl_ms"),
    p50E2eLatencyMs: real("p50_e2e_latency_ms"),
    p95E2eLatencyMs: real("p95_e2e_latency_ms"),
    p99E2eLatencyMs: real("p99_e2e_latency_ms"),
    peakVramGb: real("peak_vram_gb"),
    averageVramGb: real("average_vram_gb"),
    peakRamGb: real("peak_ram_gb"),
    averageRamGb: real("average_ram_gb"),
    gpuUtilizationAvg: real("gpu_utilization_avg"),
    gpuUtilizationPeak: real("gpu_utilization_peak"),
    cpuUtilizationAvg: real("cpu_utilization_avg"),
    cpuUtilizationPeak: real("cpu_utilization_peak"),
    powerDrawWattsAvg: real("power_draw_watts_avg"),
    powerDrawWattsPeak: real("power_draw_watts_peak"),
    gpuTemperatureAvg: real("gpu_temperature_avg"),
    gpuTemperaturePeak: real("gpu_temperature_peak"),
    tokensPerWatt: real("tokens_per_watt"),
    tokensPerDollar: real("tokens_per_dollar"),
    costPer1mGeneratedTokens: real("cost_per_1m_generated_tokens"),
    costPer1mTotalTokens: real("cost_per_1m_total_tokens"),
    createdAt: createdAt(),
  },
  (t) => [
    index("metric_points_trace_id_idx").on(t.traceId),
    index("metric_points_output_tps_idx").on(t.outputTokensPerSecond),
    index("metric_points_p95_ttft_idx").on(t.p95TtftMs),
  ],
);

export const metricDefinitions = sqliteTable("metric_definitions", {
  id: id(),
  metricPointId: text("metric_point_id")
    .notNull()
    .references(() => metricPoints.id, { onDelete: "cascade" }),
  normalizedMetricName: text("normalized_metric_name").notNull(),
  rawMetricName: text("raw_metric_name"),
  metricSource: text("metric_source"),
  sourceToolVersion: text("source_tool_version"),
  definition: text("definition"),
  aggregationMethod: text("aggregation_method"),
  percentile: real("percentile"),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const costProfiles = sqliteTable("cost_profiles", {
  id: id(),
  traceId: text("trace_id")
    .notNull()
    .references(() => traces.id, { onDelete: "cascade" }),
  estimatedSystemCost: real("estimated_system_cost"),
  estimatedGpuCost: real("estimated_gpu_cost"),
  currency: text("currency"),
  costBasisNotes: text("cost_basis_notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: id(),
    traceId: text("trace_id")
      .notNull()
      .references(() => traces.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    filename: text("filename").notNull(),
    path: text("path"),
    sha256: text("sha256"),
    parser: text("parser"),
    parserStatus: text("parser_status").$type<ParserStatus>(),
    parserConfidence: real("parser_confidence"),
    rawJson: text("raw_json"),
    createdAt: createdAt(),
  },
  (t) => [index("artifacts_trace_id_idx").on(t.traceId)],
);

// ---------- Relations ----------

export const projectRelations = relations(projects, ({ many }) => ({
  traces: many(traces),
}));

export const modelRelations = relations(models, ({ many }) => ({
  traces: many(traces),
}));

export const engineRelations = relations(engines, ({ many }) => ({
  traces: many(traces),
  loaderConfigs: many(loaderConfigs),
}));

export const hardwareProfileRelations = relations(
  hardwareProfiles,
  ({ many }) => ({
    traces: many(traces),
  }),
);

export const loaderConfigRelations = relations(loaderConfigs, ({ one, many }) => ({
  engine: one(engines, {
    fields: [loaderConfigs.engineId],
    references: [engines.id],
  }),
  traces: many(traces),
}));

export const benchmarkProfileRelations = relations(
  benchmarkProfiles,
  ({ many }) => ({
    traces: many(traces),
  }),
);

export const traceRelations = relations(traces, ({ one, many }) => ({
  project: one(projects, {
    fields: [traces.projectId],
    references: [projects.id],
  }),
  model: one(models, {
    fields: [traces.modelId],
    references: [models.id],
  }),
  engine: one(engines, {
    fields: [traces.engineId],
    references: [engines.id],
  }),
  hardwareProfile: one(hardwareProfiles, {
    fields: [traces.hardwareProfileId],
    references: [hardwareProfiles.id],
  }),
  loaderConfig: one(loaderConfigs, {
    fields: [traces.loaderConfigId],
    references: [loaderConfigs.id],
  }),
  benchmarkProfile: one(benchmarkProfiles, {
    fields: [traces.benchmarkProfileId],
    references: [benchmarkProfiles.id],
  }),
  metricPoints: many(metricPoints),
  artifacts: many(artifacts),
  costProfile: one(costProfiles, {
    fields: [traces.id],
    references: [costProfiles.traceId],
  }),
}));

export const metricPointRelations = relations(
  metricPoints,
  ({ one, many }) => ({
    trace: one(traces, {
      fields: [metricPoints.traceId],
      references: [traces.id],
    }),
    metricDefinitions: many(metricDefinitions),
  }),
);

export const metricDefinitionRelations = relations(
  metricDefinitions,
  ({ one }) => ({
    metricPoint: one(metricPoints, {
      fields: [metricDefinitions.metricPointId],
      references: [metricPoints.id],
    }),
  }),
);

export const costProfileRelations = relations(costProfiles, ({ one }) => ({
  trace: one(traces, {
    fields: [costProfiles.traceId],
    references: [traces.id],
  }),
}));

export const artifactRelations = relations(artifacts, ({ one }) => ({
  trace: one(traces, {
    fields: [artifacts.traceId],
    references: [traces.id],
  }),
}));

// Useful inferred types for the rest of the app
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Model = typeof models.$inferSelect;
export type NewModel = typeof models.$inferInsert;
export type Engine = typeof engines.$inferSelect;
export type NewEngine = typeof engines.$inferInsert;
export type HardwareProfile = typeof hardwareProfiles.$inferSelect;
export type NewHardwareProfile = typeof hardwareProfiles.$inferInsert;
export type LoaderConfig = typeof loaderConfigs.$inferSelect;
export type NewLoaderConfig = typeof loaderConfigs.$inferInsert;
export type BenchmarkProfile = typeof benchmarkProfiles.$inferSelect;
export type NewBenchmarkProfile = typeof benchmarkProfiles.$inferInsert;
export type Trace = typeof traces.$inferSelect;
export type NewTrace = typeof traces.$inferInsert;
export type MetricPoint = typeof metricPoints.$inferSelect;
export type NewMetricPoint = typeof metricPoints.$inferInsert;
export type MetricDefinition = typeof metricDefinitions.$inferSelect;
export type NewMetricDefinition = typeof metricDefinitions.$inferInsert;
export type CostProfile = typeof costProfiles.$inferSelect;
export type NewCostProfile = typeof costProfiles.$inferInsert;
export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;

// Quiet unused-import warnings for sql template tag (handy when adding raw SQL later).
export const _sql = sql;
