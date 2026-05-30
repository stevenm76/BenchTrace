import { FileX2 } from "lucide-react";

import { EmptyState } from "@/components/common/EmptyState";
import { TraceFilters } from "@/components/traces/TraceFilters";
import { TracesTable } from "@/components/traces/TracesTable";
import {
  bestMetricPoint,
  getFilterDimensions,
  getTraces,
} from "@/lib/db/queries/traces";
import { parseTraceFilters } from "@/lib/traces/url-filters";

export const dynamic = "force-dynamic";

export default async function TracesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = parseTraceFilters(sp);
  const [traces, dimensions] = await Promise.all([
    getTraces(filters),
    getFilterDimensions(),
  ]);

  const withBest = traces.map((t) => {
    const m = bestMetricPoint(t);
    return {
      ...t,
      bestMetric: m
        ? {
            outputTokensPerSecond: m.outputTokensPerSecond,
            p95TtftMs: m.p95TtftMs,
            p95TpotMs: m.p95TpotMs,
            peakVramGb: m.peakVramGb,
            concurrency: m.concurrency,
          }
        : null,
    };
  });

  return (
    <div className="flex min-h-screen">
      <TraceFilters dimensions={dimensions} />

      <div className="flex-1 min-w-0 p-6 space-y-4">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Traces</h1>
            <p className="text-sm text-muted-foreground">
              {traces.length} trace{traces.length === 1 ? "" : "s"}
            </p>
          </div>
        </header>

        {withBest.length === 0 ? (
          <EmptyState
            icon={FileX2}
            title="No traces match these filters"
            description="Clear filters to see all imported traces, or add a new trace via Import."
          />
        ) : (
          <TracesTable traces={withBest} />
        )}
      </div>
    </div>
  );
}
