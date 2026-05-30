import { Sparkles } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { DashboardSummary } from "@/lib/dashboard/aggregate";
import { bestPoint, singleStreamPoint } from "@/lib/dashboard/aggregate";
import { formatRelativeShort } from "@/lib/format/time";
import type { Tier } from "@/lib/tier/types";
import { TIER_RANK } from "@/lib/tier/types";

/**
 * Single hero card on the Dashboard. The card shape is the same across all
 * tiers — Intermediate and Expert add more inline metrics, the layout
 * doesn't fork.
 *
 * The hero is anchored on a single "top run" trace and shows two views
 * of THAT SAME trace's performance:
 *   1. Single-stream (c=1) — the primary metric, since it's what most
 *      interactive workloads actually feel.
 *   2. Concurrent (best SLA-valid c) — the under-load number.
 * Showing both from the same trace keeps the labels consistent and lets
 * the reader compare single-stream vs concurrent on equal footing.
 */
export function HeroSummaryCard({
  summary,
  tier,
}: {
  summary: DashboardSummary;
  tier: Tier;
}) {
  // Lead with the single-stream (c=1) champion, since c=1 is the hero's
  // primary metric. Only fall back to the throughput champion when no trace
  // has a c=1 measurement at all.
  const headline = summary.bestSingleStreamThroughput ?? summary.bestThroughput;
  if (!headline) return <EmptyHero summary={summary} />;
  const top = {
    trace: headline.trace,
    point: bestPoint(headline.trace) ?? headline.point,
  };

  // Pull c=1 from the SAME trace as the top run — keeps the two numbers
  // comparable instead of mixing data across traces.
  const ownC1 = singleStreamPoint(top.trace);

  // The "Concurrent" number must come from a genuine under-load (c>1) point of
  // this same trace — never echo the c=1 number. Null when the run was only
  // ever measured at c=1.
  const concurrentPoint = top.trace.metricPoints
    .filter((m) => (m.concurrency ?? 1) > 1 && m.outputTokensPerSecond != null)
    .reduce<(typeof top.point) | null>(
      (best, m) =>
        best == null ||
        (m.outputTokensPerSecond ?? 0) > (best.outputTokensPerSecond ?? 0)
          ? m
          : best,
      null,
    );

  const ts =
    top.trace.completedAt ?? top.trace.startedAt ?? top.trace.createdAt;
  const verification = top.trace.verificationLevel;

  // What lives in the hero metrics row depends on tier.
  const showIntermediate = TIER_RANK[tier] >= TIER_RANK.intermediate;
  const showExpert = TIER_RANK[tier] >= TIER_RANK.expert;

  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <Link href={`/traces/${top.trace.id}`} className="block min-w-0 group">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Sparkles className="size-3.5 text-amber-500" />
            Top run
          </div>
          <div className="text-base font-semibold text-foreground mt-0.5 truncate group-hover:text-primary transition-colors">
            {top.trace.name}
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-0.5 flex flex-wrap items-center gap-x-2">
            <span>{top.trace.engine.type}</span>
            {top.trace.engine.version ? <span>· {top.trace.engine.version}</span> : null}
            {ts ? <span>· {formatRelativeShort(ts)}</span> : null}
            {showIntermediate ? (
              <span>· {summary.totalTraces} traces · {summary.strongCount} strong</span>
            ) : null}
            {showExpert && summary.needsReviewCount > 0 ? (
              <span className="text-amber-600">· {summary.needsReviewCount} need review</span>
            ) : null}
          </div>
        </Link>
        <VerificationChip level={verification} />
      </div>

      <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
        <Metric
          label="Single-stream"
          value={fmt(ownC1?.outputTokensPerSecond)}
          unit="tok/s"
          sub="@ c=1"
          primary
          dim={!ownC1}
        />
        <Metric
          label="Concurrent"
          value={fmt(concurrentPoint?.outputTokensPerSecond)}
          unit="tok/s"
          sub={
            concurrentPoint?.concurrency != null
              ? `@ c=${concurrentPoint.concurrency}`
              : "no c>1 run"
          }
          dim={!concurrentPoint}
        />
        <Metric
          label="TTFT p95"
          value={fmt(top.point.p95TtftMs, 0)}
          unit="ms"
        />

        {showIntermediate ? (
          <>
            <Metric
              label="Max concurrency"
              value={top.point.concurrency != null ? String(top.point.concurrency) : "—"}
              sub="SLA-valid"
            />
            <Metric
              label="VRAM"
              value={fmt(top.point.peakVramGb, 1)}
              unit="GB"
              dim={top.point.peakVramGb == null}
            />
          </>
        ) : null}

        {showExpert ? (
          <>
            <Metric
              label="TPOT p95"
              value={fmt(top.point.p95TpotMs, 1)}
              unit="ms"
              dim={top.point.p95TpotMs == null}
            />
            <Metric
              label="Tokens/W"
              value={fmt(top.point.tokensPerWatt, 2)}
              dim={top.point.tokensPerWatt == null}
            />
            <Metric
              label="GPU util"
              value={fmt(top.point.gpuUtilizationAvg, 0)}
              unit="%"
              dim={top.point.gpuUtilizationAvg == null}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  sub,
  dim,
  primary,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  dim?: boolean;
  /** Visually emphasized — larger number, primary-tinted label. */
  primary?: boolean;
}) {
  return (
    <div className={dim ? "opacity-60" : undefined}>
      <div
        className={
          "text-[10px] uppercase tracking-wider " +
          (primary ? "text-primary font-medium" : "text-muted-foreground")
        }
      >
        {label}
      </div>
      <div
        className={
          "text-2xl font-semibold tabular-nums leading-tight " +
          (primary ? "text-primary" : "text-foreground")
        }
      >
        {value}
        {unit ? (
          <span className="text-sm font-normal text-muted-foreground ml-0.5">
            {unit}
          </span>
        ) : null}
      </div>
      {sub ? (
        <div
          className={
            "text-[11px] font-mono mt-0.5 " +
            (primary ? "text-primary" : "text-muted-foreground")
          }
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
}

function VerificationChip({ level }: { level: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    strong: { bg: "bg-emerald-100", fg: "text-emerald-700", label: "strong" },
    weak: { bg: "bg-amber-100", fg: "text-amber-700", label: "weak" },
    suspicious: { bg: "bg-rose-100", fg: "text-rose-700", label: "suspicious" },
    unverified: { bg: "bg-slate-100", fg: "text-slate-600", label: "unverified" },
  };
  const m = map[level] ?? map.unverified;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium font-mono ${m.bg} ${m.fg}`}
    >
      {m.label}
    </span>
  );
}

function EmptyHero({ summary }: { summary: DashboardSummary }) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-6 shadow-sm">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        Dashboard
      </div>
      <div className="text-lg font-semibold mt-1">No traces yet</div>
      <div className="text-sm text-muted-foreground mt-1">
        Run <code className="font-mono">npm run bench -- serve …</code> to capture your first trace, or use the <Link href="/import" className="text-primary underline">Import</Link> page for an existing share bundle.
      </div>
      <div className="text-xs text-muted-foreground mt-3 font-mono">
        {summary.totalTraces} traces · {summary.strongCount} strong
      </div>
    </div>
  );
}

function fmt(v: number | null | undefined, decimals = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (decimals === 0) return Math.round(v).toLocaleString();
  return v.toFixed(decimals);
}

// Re-export Badge so importers can pull it from here too if they want.
export { Badge };
