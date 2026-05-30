import { ChartFrame } from "@/components/dashboard/ChartFrame";
import { ComparabilityWarnings } from "@/components/compare/ComparabilityWarnings";
import { CompareBarChart } from "@/components/compare/CompareBarChart";
import { CompareRadar } from "@/components/compare/CompareRadar";
import { CompareSelector } from "@/components/compare/CompareSelector";
import { DeltaTable } from "@/components/compare/DeltaTable";
import { PairedBarCompare } from "@/components/compare/PairedBarCompare";
import { bestMetric, detectIssues } from "@/lib/compare";
import { getTracesByIds } from "@/lib/db/queries/compare";
import { getTraces } from "@/lib/db/queries/traces";
import { readTier, tierAtLeast } from "@/lib/tier/cookie";

export const dynamic = "force-dynamic";

function parseIds(value: string | string[] | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(parseIds);
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function shortLabel(name: string, max = 28): string {
  return name.length <= max ? name : `${name.slice(0, max - 1)}…`;
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const ids = [...new Set(parseIds(sp.ids))];

  const [selected, all, tier] = await Promise.all([
    getTracesByIds(ids),
    getTraces({ sortBy: "created_at", sortDir: "desc" }),
    readTier(),
  ]);

  const showIntermediate = tierAtLeast(tier, "intermediate");
  const showExpert = tierAtLeast(tier, "expert");

  const available = all.map((t) => ({
    id: t.id,
    name: t.name,
    engine: t.engine.type,
    quantization: t.model.quantization,
    contextLength: t.contextLength,
    when: t.completedAt ?? t.startedAt ?? t.createdAt,
  }));

  const issues = detectIssues(selected);
  const baselineId = selected[0]?.id ?? "";

  // Expert-only bar charts: keep parity with previous page behavior.
  const throughputBarData = selected.map((t) => ({
    traceId: t.id,
    shortName: shortLabel(t.name),
    fullName: t.name,
    engine: t.engine.type,
    value: bestMetric(t)?.outputTokensPerSecond ?? null,
  }));
  const latencyBarData = selected.map((t) => ({
    traceId: t.id,
    shortName: shortLabel(t.name),
    fullName: t.name,
    engine: t.engine.type,
    value: bestMetric(t)?.p95TtftMs ?? null,
  }));
  const vramBarData = selected.map((t) => ({
    traceId: t.id,
    shortName: shortLabel(t.name),
    fullName: t.name,
    engine: t.engine.type,
    value: bestMetric(t)?.peakVramGb ?? null,
  }));

  const [a, b] = selected;

  return (
    <div className="p-8 space-y-6 max-w-screen-2xl mx-auto">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Compare traces
        </h1>
        <p className="text-sm text-muted-foreground">
          Side-by-side performance for selected traces. Critical and advisory
          mismatches are flagged but do not block comparison.
        </p>
      </header>

      <CompareSelector
        selectedIds={ids}
        selectedTraces={selected.map((t) => ({
          id: t.id,
          name: t.name,
          engine: t.engine.type,
        }))}
        available={available}
      />

      {selected.length >= 2 && a && b ? (
        <>
          {/* Basic: scorecard only. Intermediate adds radar + delta table.
              Expert layers in comparability warnings and the bar charts. */}
          <PairedBarCompare a={a} b={b} />

          {showIntermediate ? (
            <CompareRadar a={a} b={b} baseline={all} />
          ) : null}

          {showExpert ? (
            <ComparabilityWarnings
              issues={issues}
              traceCount={selected.length}
            />
          ) : null}

          {showExpert ? (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <ChartFrame title="Output tok/s">
                <CompareBarChart
                  data={throughputBarData}
                  title="Output tok/s"
                  unit=" tok/s"
                />
              </ChartFrame>
              <ChartFrame title="TTFT p95">
                <CompareBarChart
                  data={latencyBarData}
                  title="TTFT p95"
                  unit=" ms"
                />
              </ChartFrame>
              <ChartFrame title="Peak VRAM">
                <CompareBarChart
                  data={vramBarData}
                  title="Peak VRAM"
                  unit=" GB"
                />
              </ChartFrame>
            </div>
          ) : null}

          {showIntermediate ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground/80">
                Delta table
              </h2>
              <DeltaTable traces={selected} baselineId={baselineId} />
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
