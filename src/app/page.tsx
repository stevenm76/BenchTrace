import { ChartFrame } from "@/components/dashboard/ChartFrame";
import { ContextVsThroughputScatter } from "@/components/dashboard/ContextVsThroughputScatter";
import { EngineDistribution } from "@/components/dashboard/EngineDistribution";
import { HeroSummaryCard } from "@/components/dashboard/HeroSummaryCard";
import { LatencyByTraceBar } from "@/components/dashboard/LatencyByTraceBar";
import { RecentTraces } from "@/components/dashboard/RecentTraces";
import { ThroughputByTraceBar } from "@/components/dashboard/ThroughputByTraceBar";
import { ThroughputVsLatencyScatter } from "@/components/dashboard/ThroughputVsLatencyScatter";
import { getTraces } from "@/lib/db/queries/traces";
import {
  allMetricPoints,
  bestPointPerTrace,
  engineDistribution,
  singleStreamPerTrace,
  summarize,
} from "@/lib/dashboard/aggregate";
import { readTier, tierAtLeast } from "@/lib/tier/cookie";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const traces = await getTraces({ sortBy: "created_at", sortDir: "desc" });
  const tier = await readTier();

  const summary = summarize(traces);
  const distribution = engineDistribution(traces);
  const perTraceBest = bestPointPerTrace(traces);
  const perTraceSingleStream = singleStreamPerTrace(traces);
  const allPoints = allMetricPoints(traces);

  const isIntermediate = tierAtLeast(tier, "intermediate");
  const isExpert = tierAtLeast(tier, "expert");

  const recentLimit = isExpert ? 10 : isIntermediate ? 5 : 3;

  return (
    <div className="p-8 space-y-6 max-w-screen-2xl mx-auto">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        {isIntermediate ? (
          <p className="text-sm text-muted-foreground">
            {summary.totalTraces} traces · {summary.strongCount} verified strong
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {summary.totalTraces} trace{summary.totalTraces === 1 ? "" : "s"}
          </p>
        )}
      </header>

      <HeroSummaryCard summary={summary} tier={tier} />

      {/* Primary: single-stream (c=1) throughput. This is the metric most
          people actually feel, so we lead with it. */}
      <ChartFrame
        title="Single-stream tok/s by trace (c=1)"
        description="One stream, one request at a time. The interactive number."
      >
        <ThroughputByTraceBar data={perTraceSingleStream} />
      </ChartFrame>

      {isIntermediate ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ChartFrame
            title="Concurrent tok/s by trace"
            description="Best SLA-valid metric point per trace (any concurrency). Total throughput under load."
          >
            <ThroughputByTraceBar data={perTraceBest} />
          </ChartFrame>
          <ChartFrame
            title="TTFT p95 by trace"
            description="Lower is better. Best p95 across measured concurrencies."
          >
            <LatencyByTraceBar data={perTraceBest} />
          </ChartFrame>
        </div>
      ) : null}

      {isIntermediate ? (
        <EngineDistribution
          distribution={distribution}
          totalTraces={summary.totalTraces}
        />
      ) : null}

      {isExpert ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ChartFrame
            title="Throughput vs latency"
            description="Every concurrency point, scatter. Top-left is the goal."
          >
            <ThroughputVsLatencyScatter data={allPoints} />
          </ChartFrame>
          <ChartFrame
            title="Context length vs throughput"
            description="Does throughput hold up as context grows?"
          >
            <ContextVsThroughputScatter data={perTraceBest} />
          </ChartFrame>
        </div>
      ) : null}

      <RecentTraces traces={traces.slice(0, recentLimit)} />
    </div>
  );
}
