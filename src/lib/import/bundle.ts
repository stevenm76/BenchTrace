/**
 * Trace Bundle import. Accepts a collection of files associated with a
 * single benchmark run — typically:
 *
 *   benchmark_result.json   ← parsed via the normal adapter chain
 *   launch_command.txt      ← copied into LoaderConfig.launchCommand
 *   benchmark_command.txt   ← copied into BenchmarkProfile.command
 *   hardware_snapshot.txt   ← merged into HardwareProfile (notes)
 *   nvidia-smi.txt          ← parsed for GPU model / driver / CUDA
 *   server.log              ← attached as an artifact
 *   stdout.log, stderr.log  ← attached as artifacts
 *   notes.md                ← becomes the trace's notes field
 *
 * Every file is preserved as an Artifact row with its sha256 so the trace
 * is reproducible from its own evidence. Missing expected files are
 * surfaced explicitly rather than silently absent.
 */

import { createHash } from "node:crypto";

import { detectAdapter, getAdapter } from "@/lib/adapters";
import type { ParseResult } from "@/lib/adapters/types";
import { parseNvidiaSmi } from "@/lib/import/nvidia-smi";

export type BundleFileRole =
  | "benchmark_result"
  | "launch_command"
  | "benchmark_command"
  | "hardware_snapshot"
  | "nvidia_smi"
  | "server_log"
  | "stdout"
  | "stderr"
  | "notes"
  | "other";

export interface BundleFile {
  name: string;
  content: string;
  size: number;
}

export interface ClassifiedFile {
  file: BundleFile;
  role: BundleFileRole;
  sha256: string;
}

export interface BundleParseResult {
  classified: ClassifiedFile[];
  /** Sub-adapter that handled the benchmark_result, if found + matched. */
  adapterId: string | null;
  /** ParseResult from the sub-adapter. May be null if no result file found. */
  parsed: ParseResult | null;
  /** Read from launch_command*.txt, post-trim. */
  launchCommand: string | null;
  /** Read from benchmark_command*.txt, post-trim. */
  benchmarkCommand: string | null;
  /** Best-effort parse of nvidia-smi.txt. */
  hardwareFromSmi: ReturnType<typeof parseNvidiaSmi> | null;
  /** notes.md contents — populates Trace.notes when overrides don't override it. */
  notes: string | null;
  /** Roles the user is expected to provide that weren't found. */
  missingExpected: { role: BundleFileRole; reason: string }[];
  /** Free-form warnings (parser bailouts, ambiguous role, etc.). */
  warnings: string[];
}

const EXPECTED_PREFERRED: BundleFileRole[] = [
  "benchmark_result",
  "launch_command",
  "benchmark_command",
  "nvidia_smi",
];

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function classifyFilename(rawName: string): BundleFileRole {
  // Take basename; some uploads include directory parts.
  const base = rawName.split(/[\\/]/).pop()!.toLowerCase();
  const trimmed = base.replace(/\.(json|txt|log|md|out)$/i, "");

  if (
    /^benchmark_result($|[._-])/.test(trimmed) ||
    /^result($|[._-])/.test(trimmed) ||
    /(^|[._-])bench(_|-)?result/.test(trimmed) ||
    // Native BenchTrace runner output — share.v1 json is the primary result.
    /^benchtrace\.share\.v1/.test(trimmed)
  ) {
    return "benchmark_result";
  }
  if (/^launch(_|-)?command/.test(trimmed) || /^launch(_|-)?cmd/.test(trimmed)) {
    return "launch_command";
  }
  if (
    /^bench(mark)?(_|-)?command/.test(trimmed) ||
    /^bench(_|-)?cmd/.test(trimmed)
  ) {
    return "benchmark_command";
  }
  if (/^nvidia[-_]?smi/.test(trimmed)) return "nvidia_smi";
  if (/^hardware(_|-)?snapshot/.test(trimmed) || /^hwinfo/.test(trimmed)) {
    return "hardware_snapshot";
  }
  if (/^server($|[._-])/.test(trimmed) || /(^|[._-])server(_|-)?log/.test(trimmed)) {
    return "server_log";
  }
  if (/^stdout($|[._-])/.test(trimmed)) return "stdout";
  if (/^stderr($|[._-])/.test(trimmed)) return "stderr";
  if (/^notes($|[._-])/.test(trimmed) || base.endsWith(".md")) return "notes";
  return "other";
}

export function parseBundle(files: BundleFile[]): BundleParseResult {
  const classified: ClassifiedFile[] = files.map((file) => ({
    file,
    role: classifyFilename(file.name),
    sha256: sha256(file.content),
  }));

  const byRole = (role: BundleFileRole) =>
    classified.find((c) => c.role === role);

  const warnings: string[] = [];
  const missingExpected: { role: BundleFileRole; reason: string }[] = [];

  // Benchmark result → sub-adapter
  const resultFile = byRole("benchmark_result");
  let parsed: ParseResult | null = null;
  let adapterId: string | null = null;
  if (resultFile) {
    let resultJson: unknown;
    try {
      resultJson = JSON.parse(resultFile.file.content);
    } catch (err) {
      warnings.push(
        `benchmark_result is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (resultJson !== undefined) {
      const adapter = detectAdapter(resultJson);
      if (adapter) {
        adapterId = adapter.id;
        parsed = adapter.parse(resultJson);
      } else {
        warnings.push(
          "Could not auto-detect a parser for benchmark_result. Use the single-file import flow with an explicit adapter.",
        );
      }
    }
  } else {
    missingExpected.push({
      role: "benchmark_result",
      reason: "No benchmark_result.json found — at minimum we need this.",
    });
  }

  // Commands
  const launchFile = byRole("launch_command");
  const launchCommand = launchFile?.file.content.trim() || null;
  if (!launchFile) {
    missingExpected.push({
      role: "launch_command",
      reason: "launch_command.txt not provided — verification will not reach strong.",
    });
  }

  const benchFile = byRole("benchmark_command");
  const benchmarkCommand = benchFile?.file.content.trim() || null;
  if (!benchFile) {
    missingExpected.push({
      role: "benchmark_command",
      reason: "benchmark_command.txt not provided — verification will not reach strong.",
    });
  }

  // Per-level metric points — when a BenchTrace-native run is being
  // imported, the share doc's `results` block only carries one aggregated
  // point. The richer per-level data lives in raw/aggregate-results.json.
  // If we find it, replace the single-point list with one point per level.
  const aggregateFile = classified.find(
    (c) => c.file.name === "aggregate-results.json",
  );
  if (aggregateFile && parsed) {
    try {
      const agg = JSON.parse(aggregateFile.file.content) as {
        perLevel?: Array<{
          streamLevel?: number;
          requestCount?: number;
          successfulRequests?: number;
          failedRequests?: number;
          failureRate?: number;
          outputTokensPerSecond?: number | null;
          totalTokensPerSecond?: number | null;
          prefillTokensPerSecond?: number | null;
          requestsPerSecond?: number | null;
          p50TtftMs?: number | null;
          p95TtftMs?: number | null;
          p99TtftMs?: number | null;
          p50TpotMs?: number | null;
          p95TpotMs?: number | null;
          p99TpotMs?: number | null;
          p50ChunkGapMs?: number | null;
          p95ChunkGapMs?: number | null;
          p99ChunkGapMs?: number | null;
          meanChunksPerRequest?: number | null;
          meanTokensPerChunk?: number | null;
          outputTokenCountSource?: string | null;
          p50ItlMs?: number | null;
          p95ItlMs?: number | null;
          p99ItlMs?: number | null;
          p50E2eLatencyMs?: number | null;
          p95E2eLatencyMs?: number | null;
          p99E2eLatencyMs?: number | null;
          peakVramGb?: number | null;
          averageVramGb?: number | null;
          gpuUtilizationAvg?: number | null;
          gpuUtilizationPeak?: number | null;
          powerDrawWattsAvg?: number | null;
          powerDrawWattsPeak?: number | null;
          gpuTemperatureAvg?: number | null;
          gpuTemperaturePeak?: number | null;
          tokensPerWatt?: number | null;
        }>;
      };
      if (Array.isArray(agg.perLevel) && agg.perLevel.length > 0) {
        parsed.metricPoints = agg.perLevel.map((l) => ({
          concurrency: l.streamLevel ?? null,
          requestRate: null,
          successfulRequests: l.successfulRequests ?? null,
          failedRequests: l.failedRequests ?? null,
          failureRate: l.failureRate ?? null,
          outputTokensPerSecond: l.outputTokensPerSecond ?? null,
          totalTokensPerSecond: l.totalTokensPerSecond ?? null,
          prefillTokensPerSecond: l.prefillTokensPerSecond ?? null,
          requestsPerSecond: l.requestsPerSecond ?? null,
          p50TtftMs: l.p50TtftMs ?? null,
          p95TtftMs: l.p95TtftMs ?? null,
          p99TtftMs: l.p99TtftMs ?? null,
          p50TpotMs: l.p50TpotMs ?? null,
          p95TpotMs: l.p95TpotMs ?? null,
          p99TpotMs: l.p99TpotMs ?? null,
          p50ChunkGapMs: l.p50ChunkGapMs ?? null,
          p95ChunkGapMs: l.p95ChunkGapMs ?? null,
          p99ChunkGapMs: l.p99ChunkGapMs ?? null,
          meanChunksPerRequest: l.meanChunksPerRequest ?? null,
          meanTokensPerChunk: l.meanTokensPerChunk ?? null,
          outputTokenCountSource: l.outputTokenCountSource ?? null,
          p50ItlMs: l.p50ItlMs ?? null,
          p95ItlMs: l.p95ItlMs ?? null,
          p99ItlMs: l.p99ItlMs ?? null,
          p50E2eLatencyMs: l.p50E2eLatencyMs ?? null,
          p95E2eLatencyMs: l.p95E2eLatencyMs ?? null,
          p99E2eLatencyMs: l.p99E2eLatencyMs ?? null,
          peakVramGb: l.peakVramGb ?? null,
          averageVramGb: l.averageVramGb ?? null,
          gpuUtilizationAvg: l.gpuUtilizationAvg ?? null,
          gpuUtilizationPeak: l.gpuUtilizationPeak ?? null,
          powerDrawWattsAvg: l.powerDrawWattsAvg ?? null,
          powerDrawWattsPeak: l.powerDrawWattsPeak ?? null,
          gpuTemperatureAvg: l.gpuTemperatureAvg ?? null,
          gpuTemperaturePeak: l.gpuTemperaturePeak ?? null,
          tokensPerWatt: l.tokensPerWatt ?? null,
        }));
      }
    } catch (err) {
      warnings.push(
        `aggregate-results.json: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Hardware
  const smiFile = byRole("nvidia_smi");
  const hardwareFromSmi = smiFile
    ? parseNvidiaSmi(smiFile.file.content)
    : null;
  if (!smiFile && !byRole("hardware_snapshot")) {
    missingExpected.push({
      role: "nvidia_smi",
      reason:
        "No nvidia-smi.txt or hardware_snapshot.txt — hardware will rely on parser-only data.",
    });
  }

  // Notes
  const notesFile = byRole("notes");
  const notes = notesFile?.file.content.trim() || null;

  // Verify all "preferred" roles are present and warn on duplicates.
  const seenRoles = new Set<BundleFileRole>();
  for (const c of classified) {
    if (c.role !== "other" && seenRoles.has(c.role)) {
      warnings.push(
        `Multiple files classified as ${c.role}; using the first.`,
      );
    }
    seenRoles.add(c.role);
  }
  for (const r of EXPECTED_PREFERRED) {
    if (
      !seenRoles.has(r) &&
      !missingExpected.find((m) => m.role === r)
    ) {
      missingExpected.push({ role: r, reason: "Recommended but not provided." });
    }
  }

  return {
    classified,
    adapterId,
    parsed,
    launchCommand,
    benchmarkCommand,
    hardwareFromSmi,
    notes,
    missingExpected,
    warnings,
  };
}

/** Pretty label for the role badges in the UI. */
export function roleLabel(role: BundleFileRole): string {
  return {
    benchmark_result: "Benchmark result",
    launch_command: "Launch command",
    benchmark_command: "Benchmark command",
    hardware_snapshot: "Hardware snapshot",
    nvidia_smi: "nvidia-smi",
    server_log: "Server log",
    stdout: "stdout",
    stderr: "stderr",
    notes: "Notes",
    other: "Other",
  }[role];
}

/** Map a role to a `type` value for the artifacts table. */
export function roleArtifactType(role: BundleFileRole): string {
  return {
    benchmark_result: "benchmark_result",
    launch_command: "launch_command",
    benchmark_command: "benchmark_command",
    hardware_snapshot: "hardware_snapshot",
    nvidia_smi: "nvidia_smi",
    server_log: "server_log",
    stdout: "stdout_log",
    stderr: "stderr_log",
    notes: "notes",
    other: "other",
  }[role];
}

export { getAdapter };
