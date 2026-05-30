import type {
  NewArtifact,
  NewBenchmarkProfile,
  NewEngine,
  NewHardwareProfile,
  NewLoaderConfig,
  NewMetricDefinition,
  NewMetricPoint,
  NewModel,
  NewTrace,
  ParserStatus,
} from "@/lib/db/schema";

/**
 * Inputs that an adapter can populate. All entity references are partial
 * because adapters typically can't fill every column. Foreign-key IDs are
 * dropped — they are stitched in by the import pipeline once entities are
 * upserted.
 */
export type TraceInput = Omit<
  NewTrace,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "modelId"
  | "engineId"
  | "hardwareProfileId"
  | "loaderConfigId"
  | "benchmarkProfileId"
  | "projectId"
>;

export type ModelInput = Omit<NewModel, "id" | "createdAt" | "updatedAt">;
export type EngineInput = Omit<NewEngine, "id" | "createdAt" | "updatedAt">;
export type HardwareProfileInput = Omit<
  NewHardwareProfile,
  "id" | "createdAt" | "updatedAt"
>;
export type LoaderConfigInput = Omit<
  NewLoaderConfig,
  "id" | "createdAt" | "updatedAt" | "engineId"
>;
export type BenchmarkProfileInput = Omit<
  NewBenchmarkProfile,
  "id" | "createdAt" | "updatedAt"
>;
export type MetricPointInput = Omit<
  NewMetricPoint,
  "id" | "createdAt" | "traceId"
>;
export type MetricDefinitionInput = Omit<
  NewMetricDefinition,
  "id" | "createdAt" | "metricPointId"
> & {
  /** Index in the metricPoints array this definition applies to. */
  metricPointIndex: number;
};
export type ArtifactInput = Omit<
  NewArtifact,
  "id" | "createdAt" | "traceId"
>;

export interface ParseResult {
  trace: Partial<TraceInput>;
  model: Partial<ModelInput>;
  engine: Partial<EngineInput>;
  hardware: Partial<HardwareProfileInput>;
  loaderConfig: Partial<LoaderConfigInput>;
  benchmarkProfile: Partial<BenchmarkProfileInput>;
  metricPoints: Partial<MetricPointInput>[];
  metricDefinitions: MetricDefinitionInput[];
  artifacts: ArtifactInput[];

  parserStatus: ParserStatus;
  /** 0.0 – 1.0 confidence that the parsed values are correct. */
  parserConfidence: number;
  /** Fields the source format structurally cannot provide. */
  unavailableFields: string[];
  /** Free-form parser warnings the user should see. */
  warnings: string[];
}

export interface BenchmarkAdapter {
  /** Stable identifier (vllm | sglang | llamacpp | ollama | generic_openai | manual). */
  id: string;
  displayName: string;
  /** Short description shown in the import wizard. */
  description: string;
  /** Quick detection — should return false fast for non-matching input. */
  canParse(input: unknown): boolean;
  /** Full parse. Must not throw — wrap failures in `parserStatus: 'failed'`. */
  parse(input: unknown): ParseResult;
  /** Fields this adapter structurally never emits. Used for "not captured" UX. */
  getUnavailableFields(): string[];
}

export function emptyParseResult(
  parserStatus: ParserStatus = "failed",
): ParseResult {
  return {
    trace: {},
    model: {},
    engine: {},
    hardware: {},
    loaderConfig: {},
    benchmarkProfile: {},
    metricPoints: [],
    metricDefinitions: [],
    artifacts: [],
    parserStatus,
    parserConfidence: 0,
    unavailableFields: [],
    warnings: [],
  };
}
