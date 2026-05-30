import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getAdapter } from "@/lib/adapters";
import { emptyParseResult, type ParseResult } from "@/lib/adapters/types";
import {
  parseBundle,
  roleArtifactType,
  type BundleFile,
  type BundleParseResult,
} from "@/lib/import/bundle";
import { computeVerification } from "@/lib/verification";
import type { Trace } from "@/lib/db/schema";

export interface ImportInput {
  adapterId: string;
  rawText: string;
  rawJson: unknown;
  /** Optional human-editable overrides — merged on top of the parser output. */
  overrides?: {
    traceName?: string;
    notes?: string;
    tags?: string[];
  };
}

export interface BundleImportInput {
  files: BundleFile[];
  overrides?: {
    traceName?: string;
    notes?: string;
    tags?: string[];
  };
}

export interface ImportResult {
  ok: true;
  trace: Trace;
  parserStatus: ParseResult["parserStatus"];
  parserConfidence: number;
  warnings: string[];
  unavailableFields: string[];
}

export interface ImportError {
  ok: false;
  error: string;
  warnings: string[];
}

function fingerprint(parts: (string | number | null | undefined)[]): string {
  const h = createHash("sha256");
  h.update(parts.map((p) => String(p ?? "∅")).join("|"));
  return h.digest("hex").slice(0, 16);
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

interface PersistOptions {
  /** Native benchmark tool tag stored on the trace row. */
  nativeBenchmarkTool: string;
  /** Used as a fingerprint seed (first 16 hex chars of sha256). */
  fingerprintSeed: string;
  overrides?: ImportInput["overrides"];
}

/**
 * Shared persist path. Writes the model/engine/hardware/loader/profile/trace/
 * metric/artifact rows from a ParseResult, then recomputes verification.
 *
 * Callers responsible for putting any "raw input" artifact into
 * `parse.artifacts` before invoking this — the persister attaches whatever
 * is there and adds nothing extra.
 */
async function persistParseResult(
  parse: ParseResult,
  options: PersistOptions,
): Promise<Trace> {
  const modelName =
    options.overrides?.traceName ?? parse.model.name ?? "Unknown model";

  const [model] = db
    .insert(schema.models)
    .values({
      provider: parse.model.provider ?? null,
      name: modelName,
      repoOrPath: parse.model.repoOrPath ?? null,
      architecture: parse.model.architecture ?? null,
      denseOrMoe: parse.model.denseOrMoe ?? null,
      parameterCount: parse.model.parameterCount ?? null,
      activeParameterCount: parse.model.activeParameterCount ?? null,
      quantization: parse.model.quantization ?? null,
      precision: parse.model.precision ?? null,
      format: parse.model.format ?? null,
      tokenizer: parse.model.tokenizer ?? null,
      claimedContextLength: parse.model.claimedContextLength ?? null,
      modality: parse.model.modality ?? null,
      capabilities: parse.model.capabilities ?? null,
      license: parse.model.license ?? null,
      modelHash: parse.model.modelHash ?? null,
    })
    .returning()
    .all();

  const [engine] = db
    .insert(schema.engines)
    .values({
      name: parse.engine.name ?? options.nativeBenchmarkTool,
      version: parse.engine.version ?? null,
      type: parse.engine.type ?? "other",
      openAICompatible: parse.engine.openAICompatible ?? null,
      containerImage: parse.engine.containerImage ?? null,
      gitSha: parse.engine.gitSha ?? null,
    })
    .returning()
    .all();

  const [hardware] = db
    .insert(schema.hardwareProfiles)
    .values({
      name: parse.hardware.name ?? "Imported hardware",
      cpu: parse.hardware.cpu ?? null,
      ramGb: parse.hardware.ramGb ?? null,
      motherboard: parse.hardware.motherboard ?? null,
      chipset: parse.hardware.chipset ?? null,
      storage: parse.hardware.storage ?? null,
      os: parse.hardware.os ?? null,
      kernel: parse.hardware.kernel ?? null,
      gpuCount: parse.hardware.gpuCount ?? null,
      gpuModels: parse.hardware.gpuModels ?? null,
      gpuVramGb: parse.hardware.gpuVramGb ?? null,
      gpuPcieGeneration: parse.hardware.gpuPcieGeneration ?? null,
      gpuPcieWidth: parse.hardware.gpuPcieWidth ?? null,
      driverVersion: parse.hardware.driverVersion ?? null,
      cudaVersion: parse.hardware.cudaVersion ?? null,
      rocmVersion: parse.hardware.rocmVersion ?? null,
      containerRuntime: parse.hardware.containerRuntime ?? null,
      containerImage: parse.hardware.containerImage ?? null,
    })
    .returning()
    .all();

  let loaderConfigId: string | null = null;
  if (Object.keys(parse.loaderConfig).length > 0) {
    const [lc] = db
      .insert(schema.loaderConfigs)
      .values({
        engineId: engine!.id,
        launchCommand: parse.loaderConfig.launchCommand ?? null,
        environmentVariables: parse.loaderConfig.environmentVariables ?? null,
        tensorParallelSize: parse.loaderConfig.tensorParallelSize ?? null,
        pipelineParallelSize: parse.loaderConfig.pipelineParallelSize ?? null,
        dataParallelSize: parse.loaderConfig.dataParallelSize ?? null,
        kvCacheDtype: parse.loaderConfig.kvCacheDtype ?? null,
        maxModelLen: parse.loaderConfig.maxModelLen ?? null,
        gpuMemoryUtilization: parse.loaderConfig.gpuMemoryUtilization ?? null,
        flashAttention: parse.loaderConfig.flashAttention ?? null,
        speculativeDecoding: parse.loaderConfig.speculativeDecoding ?? null,
        draftModel: parse.loaderConfig.draftModel ?? null,
        mtpEnabled: parse.loaderConfig.mtpEnabled ?? null,
        chunkedPrefill: parse.loaderConfig.chunkedPrefill ?? null,
        prefixCaching: parse.loaderConfig.prefixCaching ?? null,
        cpuOffload: parse.loaderConfig.cpuOffload ?? null,
        gpuResidency: parse.loaderConfig.gpuResidency ?? null,
        batchSizeSettings: parse.loaderConfig.batchSizeSettings ?? null,
        schedulerSettings: parse.loaderConfig.schedulerSettings ?? null,
      })
      .returning()
      .all();
    loaderConfigId = lc!.id;
  }

  let benchmarkProfileId: string | null = null;
  if (Object.keys(parse.benchmarkProfile).length > 0) {
    const [bp] = db
      .insert(schema.benchmarkProfiles)
      .values({
        profileId: parse.benchmarkProfile.profileId ?? null,
        profileVersion: parse.benchmarkProfile.profileVersion ?? null,
        name: parse.benchmarkProfile.name ?? "Imported workload",
        purpose: parse.benchmarkProfile.purpose ?? null,
        tool: parse.benchmarkProfile.tool ?? null,
        toolVersion: parse.benchmarkProfile.toolVersion ?? null,
        command: parse.benchmarkProfile.command ?? null,
        dataset: parse.benchmarkProfile.dataset ?? null,
        promptSource: parse.benchmarkProfile.promptSource ?? null,
        workloadType: parse.benchmarkProfile.workloadType ?? null,
        inputLength: parse.benchmarkProfile.inputLength ?? null,
        outputLength: parse.benchmarkProfile.outputLength ?? null,
        numPrompts: parse.benchmarkProfile.numPrompts ?? null,
        concurrency: parse.benchmarkProfile.concurrency ?? null,
        requestRate: parse.benchmarkProfile.requestRate ?? null,
        concurrencyStrategy: parse.benchmarkProfile.concurrencyStrategy ?? null,
        warmupRuns: parse.benchmarkProfile.warmupRuns ?? null,
        measurementDurationSeconds:
          parse.benchmarkProfile.measurementDurationSeconds ?? null,
        randomSeed: parse.benchmarkProfile.randomSeed ?? null,
        streamingEnabled: parse.benchmarkProfile.streamingEnabled ?? null,
        endpoint: parse.benchmarkProfile.endpoint ?? null,
        ttftSlaMs: parse.benchmarkProfile.ttftSlaMs ?? null,
        tpotSlaMs: parse.benchmarkProfile.tpotSlaMs ?? null,
        requiredMetrics: parse.benchmarkProfile.requiredMetrics ?? null,
        optionalMetrics: parse.benchmarkProfile.optionalMetrics ?? null,
        compatibleEngines: parse.benchmarkProfile.compatibleEngines ?? null,
        comparabilityNotes: parse.benchmarkProfile.comparabilityNotes ?? null,
      })
      .returning()
      .all();
    benchmarkProfileId = bp!.id;
  }

  const traceName =
    options.overrides?.traceName ??
    parse.trace.name ??
    `${model!.name} · ${engine!.name}${engine!.version ? ` ${engine.version}` : ""}`;
  const contextLength =
    parse.trace.contextLength ??
    parse.loaderConfig.maxModelLen ??
    parse.model.claimedContextLength ??
    null;

  const fp = fingerprint([
    engine!.type,
    engine!.version,
    model!.name,
    model!.quantization,
    contextLength,
    parse.loaderConfig.tensorParallelSize,
    parse.benchmarkProfile.profileId ?? null,
    options.fingerprintSeed,
  ]);

  const [trace] = db
    .insert(schema.traces)
    .values({
      name: traceName,
      startedAt: parse.trace.startedAt ?? null,
      completedAt: parse.trace.completedAt ?? new Date(),
      status: parse.trace.status ?? "imported",
      modelId: model!.id,
      engineId: engine!.id,
      hardwareProfileId: hardware!.id,
      loaderConfigId,
      benchmarkProfileId,
      nativeBenchmarkTool: options.nativeBenchmarkTool,
      contextLength,
      tags: options.overrides?.tags ?? parse.trace.tags ?? null,
      notes: options.overrides?.notes ?? parse.trace.notes ?? null,
      verificationLevel: "weak",
      fingerprint: fp,
    })
    .returning()
    .all();

  const metricPointRows: { id: string; index: number }[] = [];
  for (const [idx, mp] of parse.metricPoints.entries()) {
    const [row] = db
      .insert(schema.metricPoints)
      .values({ ...mp, traceId: trace!.id })
      .returning()
      .all();
    metricPointRows.push({ id: row!.id, index: idx });
  }

  for (const md of parse.metricDefinitions) {
    const point = metricPointRows.find((r) => r.index === md.metricPointIndex);
    if (!point) continue;
    db.insert(schema.metricDefinitions)
      .values({
        metricPointId: point.id,
        normalizedMetricName: md.normalizedMetricName,
        rawMetricName: md.rawMetricName ?? null,
        metricSource: md.metricSource ?? null,
        sourceToolVersion: md.sourceToolVersion ?? null,
        definition: md.definition ?? null,
        aggregationMethod: md.aggregationMethod ?? null,
        percentile: md.percentile ?? null,
        notes: md.notes ?? null,
      })
      .run();
  }

  for (const a of parse.artifacts) {
    db.insert(schema.artifacts)
      .values({ ...a, traceId: trace!.id })
      .run();
  }

  // Refetch + compute verification.
  const full = await db.query.traces.findFirst({
    where: eq(schema.traces.id, trace!.id),
    with: {
      project: true,
      model: true,
      engine: true,
      hardwareProfile: true,
      loaderConfig: true,
      benchmarkProfile: true,
      costProfile: true,
      artifacts: true,
      metricPoints: { with: { metricDefinitions: true } },
    },
  });
  if (full) {
    const v = computeVerification(full);
    db.update(schema.traces)
      .set({ verificationLevel: v.level })
      .where(eq(schema.traces.id, trace!.id))
      .run();
  }

  return trace!;
}

/**
 * Single-file import. Routes the input through the named adapter (or
 * auto-detect), then persists.
 */
export async function runImport(
  input: ImportInput,
): Promise<ImportResult | ImportError> {
  const adapter = getAdapter(input.adapterId);
  if (!adapter) {
    return {
      ok: false,
      error: `Unknown adapter "${input.adapterId}".`,
      warnings: [],
    };
  }

  const parse = adapter.parse(input.rawJson);

  if (parse.parserStatus === "failed") {
    return {
      ok: false,
      error: parse.warnings[0] ?? "Parser failed.",
      warnings: parse.warnings,
    };
  }

  // Attach the raw input as the primary benchmark_result artifact.
  parse.artifacts.unshift({
    type: "benchmark_result",
    filename: `${adapter.id}-import.json`,
    sha256: sha256Hex(input.rawText),
    parser: adapter.id,
    parserStatus: parse.parserStatus,
    parserConfidence: parse.parserConfidence,
    rawJson: input.rawText,
    path: null,
  });

  const trace = await persistParseResult(parse, {
    nativeBenchmarkTool: adapter.id,
    fingerprintSeed: sha256Hex(input.rawText).slice(0, 16),
    overrides: input.overrides,
  });

  return {
    ok: true,
    trace,
    parserStatus: parse.parserStatus,
    parserConfidence: parse.parserConfidence,
    warnings: parse.warnings,
    unavailableFields: parse.unavailableFields,
  };
}

/**
 * Bundle import. Accepts a set of files, routes the benchmark_result through
 * the normal adapter chain, layers in commands/notes/hardware from the
 * companion files, attaches every file as an artifact with its sha256.
 */
export async function runBundleImport(
  input: BundleImportInput,
): Promise<ImportResult | ImportError> {
  const bundle = parseBundle(input.files);
  const usable =
    bundle.parsed != null ||
    bundle.benchmarkCommand != null ||
    bundle.launchCommand != null;
  if (!usable) {
    return {
      ok: false,
      error:
        "No usable data in this bundle. At minimum include benchmark_result.json and/or benchmark_command.txt.",
      warnings: bundle.warnings,
    };
  }

  const parse: ParseResult =
    bundle.parsed ?? emptyParseResult("manual");

  // Merge commands into the existing loader/benchmark config.
  if (bundle.launchCommand) {
    parse.loaderConfig.launchCommand = bundle.launchCommand;
  }
  if (bundle.benchmarkCommand) {
    parse.benchmarkProfile.command = bundle.benchmarkCommand;
    if (!parse.benchmarkProfile.name) {
      parse.benchmarkProfile.name = "Bundle import workload";
    }
  }

  // Merge nvidia-smi hardware on top of whatever the adapter provided.
  if (bundle.hardwareFromSmi) {
    const smi = bundle.hardwareFromSmi;
    parse.hardware.driverVersion =
      smi.driverVersion ?? parse.hardware.driverVersion ?? null;
    parse.hardware.cudaVersion =
      smi.cudaVersion ?? parse.hardware.cudaVersion ?? null;
    if (smi.gpuModels.length > 0) {
      parse.hardware.gpuModels = smi.gpuModels;
      parse.hardware.gpuCount = smi.gpuCount;
      parse.hardware.gpuVramGb = smi.gpuVramGb ?? parse.hardware.gpuVramGb ?? null;
    }
    if (!parse.hardware.name) {
      parse.hardware.name = "Hardware from nvidia-smi";
    }
  }

  // Notes from notes.md (overrides take precedence in persistParseResult).
  if (bundle.notes && !parse.trace.notes) {
    parse.trace.notes = bundle.notes;
  }

  // Every bundle file becomes an artifact, with sha256.
  const adapterId = bundle.adapterId ?? "bundle";
  for (const c of bundle.classified) {
    parse.artifacts.push({
      type: roleArtifactType(c.role),
      filename: c.file.name,
      sha256: c.sha256,
      parser: c.role === "benchmark_result" ? adapterId : null,
      parserStatus:
        c.role === "benchmark_result"
          ? (parse.parserStatus ?? "manual")
          : "manual",
      parserConfidence:
        c.role === "benchmark_result" ? parse.parserConfidence : null,
      rawJson: c.file.content,
      path: null,
    });
  }

  // Seed the fingerprint from the benchmark_result hash if available, else
  // a concat of every file's hash.
  const resultArtifact = bundle.classified.find(
    (c) => c.role === "benchmark_result",
  );
  const fingerprintSeed = resultArtifact
    ? resultArtifact.sha256.slice(0, 16)
    : sha256Hex(bundle.classified.map((c) => c.sha256).join("|")).slice(0, 16);

  // If the sub-adapter recognized a BenchTrace-native run (benchmark.tool ===
  // "benchtrace"), tag the trace as native so the dashboard and traces table
  // can render the badge without re-querying the benchmark profile.
  const isNativeResult = parse.benchmarkProfile.tool === "benchtrace";
  const nativeBenchmarkTool = isNativeResult
    ? "benchtrace"
    : adapterId === "bundle"
      ? "bundle"
      : adapterId;

  const trace = await persistParseResult(parse, {
    nativeBenchmarkTool,
    fingerprintSeed,
    overrides: input.overrides,
  });

  return {
    ok: true,
    trace,
    parserStatus: parse.parserStatus,
    parserConfidence: parse.parserConfidence,
    warnings: bundle.warnings,
    unavailableFields: parse.unavailableFields,
  };
}

export function bundlePreview(bundle: BundleParseResult) {
  return {
    classified: bundle.classified.map((c) => ({
      filename: c.file.name,
      role: c.role,
      sha256: c.sha256,
      size: c.file.size,
    })),
    adapterId: bundle.adapterId,
    parserStatus: bundle.parsed?.parserStatus ?? null,
    parserConfidence: bundle.parsed?.parserConfidence ?? null,
    launchCommandPresent: bundle.launchCommand != null,
    benchmarkCommandPresent: bundle.benchmarkCommand != null,
    hardwareDetected: bundle.hardwareFromSmi
      ? {
          driverVersion: bundle.hardwareFromSmi.driverVersion,
          cudaVersion: bundle.hardwareFromSmi.cudaVersion,
          gpuCount: bundle.hardwareFromSmi.gpuCount,
          firstGpuName: bundle.hardwareFromSmi.gpuModels[0]?.name ?? null,
        }
      : null,
    metricPointCount: bundle.parsed?.metricPoints.length ?? 0,
    outputTokensPerSecond:
      bundle.parsed?.metricPoints[0]?.outputTokensPerSecond ?? null,
    p95TtftMs: bundle.parsed?.metricPoints[0]?.p95TtftMs ?? null,
    missingExpected: bundle.missingExpected,
    warnings: bundle.warnings,
    notesPresent: bundle.notes != null,
  };
}
