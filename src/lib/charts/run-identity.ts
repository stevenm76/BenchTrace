/**
 * Per-run chart identity: color, compact label, and disambiguator text.
 *
 * Runs are identified by their unique `traceId`, never by engine family or a
 * truncated name. This keeps a run the same color in every chart and across
 * re-renders/sorts, and guarantees two distinct runs are distinguishable even
 * when their names share a long prefix. See docs/ui-audit/.
 */
import { seriesPalette } from "@/lib/charts/palette";

/**
 * Assign a distinct color to each run in a chart. Colors are handed out by
 * sorted traceId so the mapping is deterministic and stable for a given set
 * of runs (same color across charts that show the same runs), and — unlike a
 * per-id hash — no two runs share a color until the run count exceeds the
 * palette size. Only then does it wrap.
 */
export function buildRunColorMap(
  traceIds: string[],
  mode: "light" | "dark" = "light",
): Map<string, string> {
  const wheel = seriesPalette(mode);
  const ordered = [...new Set(traceIds)].sort();
  const map = new Map<string, string>();
  ordered.forEach((id, i) => map.set(id, wheel[i % wheel.length]!));
  return map;
}

/**
 * Middle-truncate so BOTH the model prefix AND the distinguishing suffix
 * (c=, in/out lens, date) survive — the suffix is exactly what end-truncation
 * threw away.
 */
export function middleTruncate(name: string, maxLen = 40): string {
  if (name.length <= maxLen) return name;
  const keep = maxLen - 1; // room for the ellipsis
  const head = Math.ceil(keep * 0.55);
  const tail = keep - head;
  return name.slice(0, head) + "…" + name.slice(name.length - tail);
}

export interface RunDisambig {
  concurrency: number | null;
  contextLength: number | null;
}

/** Human disambiguator suffix for tooltips, e.g. "c=1 · 2k ctx". */
export function disambigLabel(d: RunDisambig): string {
  const parts: string[] = [];
  if (d.concurrency != null) parts.push(`c=${d.concurrency}`);
  if (d.contextLength != null) {
    parts.push(`${(d.contextLength / 1024).toFixed(0)}k ctx`);
  }
  return parts.join(" · ");
}
