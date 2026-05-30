import {
  Activity,
  AlertTriangle,
  Clock,
  Gauge,
  Maximize2,
  Zap,
} from "lucide-react";
import Link from "next/link";

import { MetricValue } from "@/components/common/MetricValue";
import { Badge } from "@/components/ui/badge";
import type { DashboardSummary } from "@/lib/dashboard/aggregate";
import { formatRelativeShort } from "@/lib/format/time";

interface SummaryCardsProps {
  summary: DashboardSummary;
}

export function SummaryCards({ summary }: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
      <StatCard
        icon={Gauge}
        label="Best overall tok/s"
        primary={
          <MetricValue
            value={summary.bestThroughput?.point.outputTokensPerSecond ?? null}
            unit=" tok/s"
            emphasis="prominent"
          />
        }
        href={summary.bestThroughput?.trace.id}
        subtitle={
          summary.bestThroughput
            ? `@ c=${summary.bestThroughput.point.concurrency ?? "—"} · ${summary.bestThroughput.trace.name}`
            : undefined
        }
        subtitleMono
      />
      <StatCard
        icon={Zap}
        label="Best single-stream"
        primary={
          <MetricValue
            value={
              summary.bestSingleStreamThroughput?.point.outputTokensPerSecond ??
              null
            }
            unit=" tok/s"
            emphasis="prominent"
          />
        }
        href={summary.bestSingleStreamThroughput?.trace.id}
        subtitle={
          summary.bestSingleStreamThroughput
            ? `c=1 · ${summary.bestSingleStreamThroughput.trace.name}`
            : "no c=1 measurement"
        }
        subtitleMono
      />
      <StatCard
        icon={Activity}
        label="Best latency"
        primary={
          <MetricValue
            value={summary.bestLatency?.point.p95TtftMs ?? null}
            unit=" ms"
            precision={0}
            emphasis="prominent"
          />
        }
        href={summary.bestLatency?.trace.id}
        subtitle={
          summary.bestLatency
            ? `TTFT p95 · ${summary.bestLatency.trace.name}`
            : "no latency data"
        }
        subtitleMono
      />
      <StatCard
        icon={Maximize2}
        label="Longest context tested"
        primary={
          <MetricValue
            value={
              summary.bestLongContext?.contextLength != null
                ? `${(summary.bestLongContext.contextLength / 1024).toFixed(0)}k`
                : null
            }
            emphasis="prominent"
          />
        }
        href={summary.bestLongContext?.id}
        subtitle={summary.bestLongContext?.name}
        subtitleMono
      />
      <StatCard
        icon={Clock}
        label="Latest trace"
        primary={
          <MetricValue
            value={
              summary.latestTrace
                ? formatRelativeShort(
                    summary.latestTrace.completedAt ??
                      summary.latestTrace.startedAt ??
                      summary.latestTrace.createdAt,
                  )
                : null
            }
            emphasis="prominent"
            mono={false}
          />
        }
        href={summary.latestTrace?.id}
        subtitle={summary.latestTrace?.name}
        subtitleMono
      />
      <StatCard
        icon={AlertTriangle}
        label="Needs review"
        primary={
          <span
            className={`text-2xl font-mono ${summary.needsReviewCount > 0 ? "text-amber-300" : "text-emerald-300"}`}
          >
            {summary.needsReviewCount}
          </span>
        }
        subtitle={
          summary.needsReviewCount > 0 ? (
            <Link
              href="/traces?verifications=weak,suspicious"
              className="hover:text-foreground transition-colors"
            >
              View weak / suspicious →
            </Link>
          ) : (
            "all traces verified"
          )
        }
      />
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  primary,
  subtitle,
  subtitleMono,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  primary: React.ReactNode;
  subtitle?: React.ReactNode;
  subtitleMono?: boolean;
  href?: string | null;
}) {
  const inner = (
    <div className="rounded-lg border border-border bg-card/60 px-4 py-3.5 h-full flex flex-col gap-1.5 transition-colors hover:bg-card/80">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="tabular-nums">{primary}</div>
      {subtitle ? (
        <div
          className={`text-xs text-muted-foreground line-clamp-1 ${subtitleMono ? "font-mono" : ""}`}
        >
          {subtitle}
        </div>
      ) : null}
    </div>
  );
  if (href) {
    return (
      <Link href={`/traces/${href}`} className="block">
        {inner}
      </Link>
    );
  }
  return inner;
}

// Re-export Badge here for the engine strip below
export { Badge };
