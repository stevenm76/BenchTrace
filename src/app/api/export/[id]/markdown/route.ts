import { NextResponse } from "next/server";

import { getTraceById } from "@/lib/db/queries/traces";
import { buildMarkdown } from "@/lib/export/markdown";

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
  const { markdown, redactionTotals } = buildMarkdown(trace, {
    redact,
    redactLocalPaths,
  });

  if (download) {
    return new NextResponse(markdown, {
      headers: {
        "Content-Type": "text/markdown",
        "Content-Disposition": `attachment; filename="${slug(trace.name)}.md"`,
      },
    });
  }
  return NextResponse.json({ markdown, redactions: redactionTotals });
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
