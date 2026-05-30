import { NextResponse } from "next/server";

import { getTraceById } from "@/lib/db/queries/traces";
import { buildReproJson } from "@/lib/export/repro-json";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const url = new URL(req.url);
  const redact = url.searchParams.get("redact") !== "0";
  const redactLocalPaths = url.searchParams.get("paths") === "1";
  const download = url.searchParams.get("download") === "1";

  const trace = await getTraceById(id);
  if (!trace) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const { json, redactionTotals } = buildReproJson(trace, {
    redact,
    redactLocalPaths,
  });

  if (download) {
    return new NextResponse(JSON.stringify(json, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${slug(trace.name)}.benchtrace.json"`,
      },
    });
  }
  return NextResponse.json({ json, redactions: redactionTotals });
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
