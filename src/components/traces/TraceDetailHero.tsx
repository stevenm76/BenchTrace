import { Activity, Calendar, Hash } from "lucide-react";
import type { ReactNode } from "react";

import { EngineBadge } from "@/components/common/EngineBadge";
import { NativeBadge, isNativeBenchTrace } from "@/components/common/NativeBadge";
import { QuantBadge } from "@/components/common/QuantBadge";
import { VerificationBadge } from "@/components/common/VerificationBadge";
import { Badge } from "@/components/ui/badge";
import { formatAbsolute } from "@/lib/format/time";

import type { TraceDetail } from "@/lib/db/queries/traces";

export function TraceDetailHero({
  trace,
  shareAction,
}: {
  trace: TraceDetail;
  shareAction?: ReactNode;
}) {
  return (
    <header className="space-y-4 pb-6 border-b border-border">
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-2 min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {trace.name}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <EngineBadge
              engine={trace.engine.type}
              version={trace.engine.version}
            />
            {isNativeBenchTrace({
              nativeBenchmarkTool: trace.nativeBenchmarkTool,
              benchmarkProfile: trace.benchmarkProfile,
            }) ? (
              <NativeBadge />
            ) : null}
            <QuantBadge quantization={trace.model.quantization} />
            {trace.contextLength ? (
              <Badge variant="outline" className="font-mono text-xs">
                {(trace.contextLength / 1024).toFixed(0)}k ctx
              </Badge>
            ) : null}
            {trace.loaderConfig?.tensorParallelSize &&
            trace.loaderConfig.tensorParallelSize > 1 ? (
              <Badge variant="outline" className="font-mono text-xs">
                TP={trace.loaderConfig.tensorParallelSize}
              </Badge>
            ) : null}
            {trace.loaderConfig?.kvCacheDtype ? (
              <Badge variant="outline" className="font-mono text-xs">
                KV={trace.loaderConfig.kvCacheDtype}
              </Badge>
            ) : null}
            {trace.loaderConfig?.speculativeDecoding ? (
              <Badge variant="outline" className="font-mono text-xs">
                spec-decode
              </Badge>
            ) : null}
            {trace.loaderConfig?.mtpEnabled ? (
              <Badge variant="outline" className="font-mono text-xs">
                MTP
              </Badge>
            ) : null}
            <VerificationBadge level={trace.verificationLevel} />
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="size-3.5" />
              {formatAbsolute(
                trace.completedAt ?? trace.startedAt ?? trace.createdAt,
              )}
            </span>
            {trace.fingerprint ? (
              <span className="inline-flex items-center gap-1.5 font-mono">
                <Hash className="size-3.5" />
                {trace.fingerprint}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              <Activity className="size-3.5" />
              {trace.metricPoints.length} metric point
              {trace.metricPoints.length === 1 ? "" : "s"}
            </span>
          </div>

          {trace.tags?.length ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {trace.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="font-mono text-xs"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>

        <div className="shrink-0">{shareAction}</div>
      </div>

      {trace.notes ? (
        <p className="text-sm text-muted-foreground bg-card/40 border border-border rounded-md px-3 py-2">
          {trace.notes}
        </p>
      ) : null}
    </header>
  );
}
