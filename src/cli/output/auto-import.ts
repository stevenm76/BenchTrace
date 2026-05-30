import fs from "node:fs/promises";
import path from "node:path";

import {
  isVllmResult,
  mapVllmResultToShareDoc,
} from "@/lib/import/vllm-mapper";

export interface AutoImportOptions {
  /** Path to the run folder (or a benchtrace.share.v1.json file). */
  inputPath: string;
  /** Base URL of the running dashboard. */
  baseUrl: string;
  /** Override the trace's tags + notes. */
  overrides?: { tags?: string[]; notes?: string };
  /** Connect timeout (ms) for the dashboard reachability check. */
  timeoutMs?: number;
}

export interface AutoImportResult {
  ok: boolean;
  /** Reason the import didn't run, or null on success. */
  skipReason: "unreachable" | "import_failed" | null;
  traceId?: string;
  traceName?: string;
  url?: string;
  error?: string;
  warnings?: string[];
}

/**
 * Read a run folder (or a single share.v1 file) and POST it to a running
 * dashboard's /api/import. Returns a structured result instead of throwing,
 * so callers can fall back to printing the manual command.
 */
export async function autoImport(
  opts: AutoImportOptions,
): Promise<AutoImportResult> {
  const files = await readFilesForImport(opts.inputPath);
  if (files.length === 0) {
    return {
      ok: false,
      skipReason: "import_failed",
      error: "No importable files found in the input path.",
    };
  }

  // Reachability check — short timeout so the benchmark never blocks here.
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? 2000,
  );
  try {
    await fetch(opts.baseUrl, { signal: controller.signal });
  } catch {
    clearTimeout(timer);
    return { ok: false, skipReason: "unreachable" };
  }
  clearTimeout(timer);

  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/import`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "bundle_commit",
      files,
      overrides: opts.overrides,
    }),
  }).catch((err: Error) => err);

  if (res instanceof Error) {
    return {
      ok: false,
      skipReason: "import_failed",
      error: res.message,
    };
  }

  const body = (await res.json()) as {
    ok: boolean;
    traceId?: string;
    traceName?: string;
    error?: string;
    warnings?: string[];
  };
  if (!body.ok) {
    return {
      ok: false,
      skipReason: "import_failed",
      error: body.error ?? "import_failed",
      warnings: body.warnings,
    };
  }
  return {
    ok: true,
    skipReason: null,
    traceId: body.traceId,
    traceName: body.traceName,
    url: `${opts.baseUrl.replace(/\/$/, "")}/traces/${body.traceId}`,
    warnings: body.warnings,
  };
}

async function readFilesForImport(
  inputPath: string,
): Promise<{ name: string; content: string; size: number }[]> {
  const stat = await fs.stat(inputPath).catch(() => null);
  if (!stat) return [];

  if (stat.isFile()) {
    const buf = await fs.readFile(inputPath);
    const text = buf.toString("utf8");

    // Foreign-tool support: a vllm bench serve result.json gets mapped
    // into a synthetic benchtrace.share.v1 here so the existing
    // /api/import handler doesn't need to know about vLLM at all.
    if (inputPath.endsWith(".json")) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (isVllmResult(parsed)) {
          const mapped = JSON.stringify(mapVllmResultToShareDoc(parsed));
          return [
            {
              name: "benchtrace.share.v1.json",
              content: mapped,
              size: Buffer.byteLength(mapped, "utf8"),
            },
          ];
        }
      } catch {
        // not JSON or not vLLM-shaped — fall through to opaque file pass.
      }
    }

    return [
      { name: path.basename(inputPath), content: text, size: buf.byteLength },
    ];
  }

  const out: { name: string; content: string; size: number }[] = [];
  const rootEntries = await fs.readdir(inputPath, { withFileTypes: true });
  for (const e of rootEntries) {
    if (!e.isFile()) continue;
    const buf = await fs.readFile(path.join(inputPath, e.name));
    out.push({ name: e.name, content: buf.toString("utf8"), size: buf.byteLength });
  }
  const rawDir = path.join(inputPath, "raw");
  const rawStat = await fs.stat(rawDir).catch(() => null);
  if (rawStat?.isDirectory()) {
    const rawEntries = await fs.readdir(rawDir, { withFileTypes: true });
    for (const e of rawEntries) {
      if (!e.isFile()) continue;
      const buf = await fs.readFile(path.join(rawDir, e.name));
      out.push({ name: e.name, content: buf.toString("utf8"), size: buf.byteLength });
    }
  }
  return out;
}
