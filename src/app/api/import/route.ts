import { NextResponse } from "next/server";

import { detectAdapter, getAdapter } from "@/lib/adapters";
import { parseBundle, type BundleFile } from "@/lib/import/bundle";
import {
  bundlePreview,
  runBundleImport,
  runImport,
} from "@/lib/import/pipeline";

export const dynamic = "force-dynamic";

interface PreviewRequest {
  action: "preview";
  rawText: string;
  adapterId?: string;
}

interface CommitRequest {
  action: "commit";
  adapterId: string;
  rawText: string;
  overrides?: { traceName?: string; notes?: string; tags?: string[] };
}

interface BundlePreviewRequest {
  action: "bundle_preview";
  files: BundleFile[];
}

interface BundleCommitRequest {
  action: "bundle_commit";
  files: BundleFile[];
  overrides?: { traceName?: string; notes?: string; tags?: string[] };
}

type ImportRequest =
  | PreviewRequest
  | CommitRequest
  | BundlePreviewRequest
  | BundleCommitRequest;

export async function POST(req: Request) {
  let body: ImportRequest;
  try {
    body = (await req.json()) as ImportRequest;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 },
    );
  }

  // ───────── Bundle preview ─────────
  if (body.action === "bundle_preview") {
    if (!Array.isArray(body.files) || body.files.length === 0) {
      return NextResponse.json({
        ok: false,
        error: "No files provided in bundle.",
      });
    }
    const bundle = parseBundle(body.files);
    return NextResponse.json({ ok: true, ...bundlePreview(bundle) });
  }

  // ───────── Bundle commit ─────────
  if (body.action === "bundle_commit") {
    if (!Array.isArray(body.files) || body.files.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No files provided in bundle." },
        { status: 400 },
      );
    }
    const result = await runBundleImport({
      files: body.files,
      overrides: body.overrides,
    });
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      traceId: result.trace.id,
      traceName: result.trace.name,
      parserStatus: result.parserStatus,
      parserConfidence: result.parserConfidence,
      warnings: result.warnings,
      unavailableFields: result.unavailableFields,
    });
  }

  // ───────── Single-file paths (existing) ─────────
  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(body.rawText);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Could not parse input as JSON",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }

  if (body.action === "preview") {
    const adapter = body.adapterId
      ? getAdapter(body.adapterId)
      : detectAdapter(parsedRaw);
    if (!adapter) {
      return NextResponse.json({
        ok: false,
        error:
          "Could not auto-detect the adapter. Choose one from the dropdown.",
      });
    }
    const parse = adapter.parse(parsedRaw);
    return NextResponse.json({
      ok: true,
      adapterId: adapter.id,
      adapterName: adapter.displayName,
      parserStatus: parse.parserStatus,
      parserConfidence: parse.parserConfidence,
      warnings: parse.warnings,
      unavailableFields: parse.unavailableFields,
      preview: {
        traceName:
          parse.trace.name ??
          `${parse.model.name ?? "Unknown model"} · ${parse.engine.name ?? adapter.displayName}`,
        modelName: parse.model.name,
        modelQuantization: parse.model.quantization,
        engineName: parse.engine.name,
        engineVersion: parse.engine.version,
        contextLength: parse.loaderConfig.maxModelLen,
        metricPointCount: parse.metricPoints.length,
        outputTokensPerSecond:
          parse.metricPoints[0]?.outputTokensPerSecond ?? null,
        p95TtftMs: parse.metricPoints[0]?.p95TtftMs ?? null,
      },
    });
  }

  if (body.action === "commit") {
    const result = await runImport({
      adapterId: body.adapterId,
      rawText: body.rawText,
      rawJson: parsedRaw,
      overrides: body.overrides,
    });
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      traceId: result.trace.id,
      traceName: result.trace.name,
      parserStatus: result.parserStatus,
      parserConfidence: result.parserConfidence,
      warnings: result.warnings,
      unavailableFields: result.unavailableFields,
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
