import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { buildMarkdownSummary } from "./markdown";
import { buildShareJson } from "./share-json";

import type { SweepResult } from "../runner/aggregate";
import type { ModelNameInfo } from "../runner/model-name";
import type { ProbeResult } from "../runner/probe";
import type { PromptPool } from "../runner/prompts";
import type { BenchServeOptions } from "../runner/sweep";
import type { RequestResult } from "../runner/request";
import type { ContainerProbe } from "../snapshot/container";
import type { HardwareSnapshot } from "../snapshot/hardware";
import type { ModelConfigProbe } from "../snapshot/model-config";

export interface WriteRunInput {
  outDir: string;
  options: BenchServeOptions;
  startedAt: Date;
  completedAt: Date;
  sweep: SweepResult;
  perRequest: RequestResult[];
  hardwareBefore: HardwareSnapshot;
  hardwareAfter: HardwareSnapshot;
  nvidiaSmiBefore: string | null;
  nvidiaSmiAfter: string | null;
  launchCommand: string | null;
  probed: ProbeResult;
  nameInfo: ModelNameInfo;
  /** Docker container serving the model (if found). */
  container: ContainerProbe | null;
  /** HF config.json + tokenizer_config.json (if readable). */
  modelConfig: ModelConfigProbe | null;
  /** Selected prompt corpus + sampled prompts. */
  promptPool: PromptPool;
}

function sha256(s: string | Buffer): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Atomically lay out the run folder:
 *
 *   <outDir>/
 *     benchtrace.share.v1.json
 *     share-summary.md
 *     manifest.json
 *     raw/
 *       per-request-results.jsonl
 *       aggregate-results.json
 *       benchmark-command.txt
 *       launch-command.txt
 *       hardware-snapshot-before.json
 *       hardware-snapshot-after.json
 *       nvidia-smi-before.txt
 *       nvidia-smi-after.txt
 *
 * Writes to <outDir>.tmp first, renames to <outDir> on success. Refuses to
 * overwrite an existing folder.
 */
export interface WriteRunResult {
  /** The comparison_validity verdict from the share doc, if computed. */
  comparisonVerdict:
    | "strongly_comparable"
    | "weakly_comparable"
    | "not_comparable"
    | null;
}

export async function writeRun(input: WriteRunInput): Promise<WriteRunResult> {
  const finalDir = path.resolve(input.outDir);
  const tmpDir = `${finalDir}.tmp`;

  const existing = await fs.stat(finalDir).catch(() => null);
  if (existing) {
    throw new Error(
      `Output directory already exists: ${finalDir} (refusing to overwrite). Pass a different --out.`,
    );
  }

  await fs.mkdir(path.join(tmpDir, "raw"), { recursive: true });

  // Raw artifacts first (their hashes feed verification.artifacts in share.v1).
  const rawFiles: { name: string; content: string; type: string }[] = [];
  const perRequestJsonl = input.perRequest.map((r) => JSON.stringify(r)).join("\n") + "\n";
  rawFiles.push({
    name: "per-request-results.jsonl",
    content: perRequestJsonl,
    type: "raw_metrics",
  });
  rawFiles.push({
    name: "aggregate-results.json",
    content: JSON.stringify(input.sweep, null, 2),
    type: "aggregate_metrics",
  });
  const benchCmd = buildBenchmarkCommand(input.options);
  rawFiles.push({
    name: "benchmark-command.txt",
    content: benchCmd + "\n",
    type: "benchmark_command",
  });
  rawFiles.push({
    name: "launch-command.txt",
    content:
      (input.launchCommand && input.launchCommand.trim().length > 0
        ? input.launchCommand
        : "# launch_command_not_provided") + "\n",
    type: "launch_command",
  });
  rawFiles.push({
    name: "hardware-snapshot-before.json",
    content: JSON.stringify(input.hardwareBefore, null, 2),
    type: "hardware_snapshot",
  });
  rawFiles.push({
    name: "hardware-snapshot-after.json",
    content: JSON.stringify(input.hardwareAfter, null, 2),
    type: "hardware_snapshot",
  });
  if (input.nvidiaSmiBefore != null) {
    rawFiles.push({
      name: "nvidia-smi-before.txt",
      content: input.nvidiaSmiBefore,
      type: "nvidia_smi",
    });
  }
  if (input.nvidiaSmiAfter != null) {
    rawFiles.push({
      name: "nvidia-smi-after.txt",
      content: input.nvidiaSmiAfter,
      type: "nvidia_smi",
    });
  }

  // Write raw artifacts and compute sha256 inline.
  const artifactEntries: {
    type: string;
    filename: string;
    sha256: string;
    parserStatus: "parsed" | "manual";
  }[] = [];
  for (const f of rawFiles) {
    const p = path.join(tmpDir, "raw", f.name);
    await fs.writeFile(p, f.content);
    artifactEntries.push({
      type: f.type,
      filename: `raw/${f.name}`,
      sha256: sha256(f.content),
      parserStatus: f.name === "aggregate-results.json" ? "parsed" : "manual",
    });
  }

  // Build share.v1
  const built = buildShareJson({
    options: input.options,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    sweep: input.sweep,
    hardware: input.hardwareBefore,
    launchCommand: input.launchCommand,
    artifacts: artifactEntries,
    probed: input.probed,
    nameInfo: input.nameInfo,
    container: input.container,
    modelConfig: input.modelConfig,
    promptPool: input.promptPool,
  });

  // share json + summary
  const sharePath = path.join(tmpDir, "benchtrace.share.v1.json");
  const shareContent = JSON.stringify(built.json, null, 2) + "\n";
  await fs.writeFile(sharePath, shareContent);

  let summary: string | null = null;
  if (!input.options.jsonOnly) {
    summary = buildMarkdownSummary({
      options: input.options,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      sweep: input.sweep,
      hardware: input.hardwareBefore,
      launchCommandPresent: !!input.launchCommand,
      verificationLevel: built.verification.level,
      redactedBenchmarkCommand: built.json.benchmark.command ?? "",
      redactedLaunchCommand: built.json.loader.launch_command,
    });
    await fs.writeFile(path.join(tmpDir, "share-summary.md"), summary);
  }

  // Manifest
  const manifest: Record<string, string> = {
    "benchtrace.share.v1.json": sha256(shareContent),
  };
  if (summary) manifest["share-summary.md"] = sha256(summary);
  for (const a of artifactEntries) manifest[a.filename] = a.sha256;
  await fs.writeFile(
    path.join(tmpDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  // Commit atomically
  await fs.rename(tmpDir, finalDir);

  return {
    comparisonVerdict: built.json.comparison_validity?.verdict ?? null,
  };
}

function buildBenchmarkCommand(opts: BenchServeOptions): string {
  const argv = opts.argv;
  const args = argv.length > 0 ? argv.join(" ") : "(unknown argv)";
  return `npx benchtrace ${args}`;
}
