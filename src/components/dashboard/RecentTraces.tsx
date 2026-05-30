import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { EngineBadge } from "@/components/common/EngineBadge";
import { MetricValue } from "@/components/common/MetricValue";
import { NativeBadge, isNativeBenchTrace } from "@/components/common/NativeBadge";
import { QuantBadge } from "@/components/common/QuantBadge";
import { VerificationBadge } from "@/components/common/VerificationBadge";
import { bestPoint, type DashboardTrace } from "@/lib/dashboard/aggregate";
import { formatAbsolute, formatRelativeShort } from "@/lib/format/time";

interface RecentTracesProps {
  traces: DashboardTrace[];
}

export function RecentTraces({ traces }: RecentTracesProps) {
  if (traces.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/30 px-4 py-6 text-center text-sm text-muted-foreground">
        No traces yet. Import one to get started.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-card/40 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
        <h3 className="text-sm font-semibold">Recent traces</h3>
        <Link
          href="/traces"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          View all
          <ArrowRight className="size-3" />
        </Link>
      </div>
      <div className="divide-y divide-border/60">
        {traces.map((t) => {
          const best = bestPoint(t);
          return (
            <Link
              key={t.id}
              href={`/traces/${t.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors"
            >
              <EngineBadge engine={t.engine.type} />
              {isNativeBenchTrace({
                nativeBenchmarkTool: t.nativeBenchmarkTool,
                benchmarkProfile: null,
              }) ? (
                <NativeBadge showIcon={false} />
              ) : null}
              <QuantBadge quantization={t.model.quantization} />
              <span
                className="flex-1 min-w-0 text-sm truncate"
                title={t.name}
              >
                {t.name}
              </span>
              <span className="font-mono text-xs text-muted-foreground tabular-nums shrink-0 w-24 text-right">
                <MetricValue
                  value={best?.outputTokensPerSecond ?? null}
                  unit=" tok/s"
                />
              </span>
              <span
                className="font-mono text-xs text-muted-foreground shrink-0 w-20 text-right"
                title={formatAbsolute(
                  t.completedAt ?? t.startedAt ?? t.createdAt,
                )}
              >
                {formatRelativeShort(
                  t.completedAt ?? t.startedAt ?? t.createdAt,
                )}
              </span>
              <VerificationBadge level={t.verificationLevel} compact />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
