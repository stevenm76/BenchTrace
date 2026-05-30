import { Crown } from "lucide-react";

import { MetricValue } from "@/components/common/MetricValue";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { COMPARE_METRICS, pickWinner, type MetricSpec } from "@/lib/compare";
import type { CompareTrace } from "@/lib/db/queries/compare";
import { cn } from "@/lib/utils";

interface DeltaTableProps {
  traces: CompareTrace[];
  /** Trace ID treated as the baseline (relative deltas computed against this). */
  baselineId: string;
}

export function DeltaTable({ traces, baselineId }: DeltaTableProps) {
  const baseline = traces.find((t) => t.id === baselineId);
  return (
    <div className="rounded-md border border-border overflow-hidden bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground sticky left-0 bg-card">
              Metric
            </TableHead>
            {traces.map((t) => (
              <TableHead
                key={t.id}
                className="text-right text-xs uppercase tracking-wider text-muted-foreground min-w-32"
              >
                <span
                  className={cn(
                    t.id === baselineId && "text-foreground",
                  )}
                  title={t.name}
                >
                  {shortName(t.name)}
                </span>
                {t.id === baselineId ? (
                  <div className="text-[10px] mt-0.5 text-amber-400/80">
                    baseline
                  </div>
                ) : null}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {COMPARE_METRICS.map((spec) => (
            <MetricRow
              key={spec.key}
              spec={spec}
              traces={traces}
              baseline={baseline}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function MetricRow({
  spec,
  traces,
  baseline,
}: {
  spec: MetricSpec;
  traces: CompareTrace[];
  baseline: CompareTrace | undefined;
}) {
  const values = traces.map((t) => ({ traceId: t.id, value: spec.pick(t) }));
  const winnerId = pickWinner(spec, values);
  const baselineValue = baseline ? spec.pick(baseline) : null;

  return (
    <TableRow>
      <TableCell className="font-medium text-sm sticky left-0 bg-card">
        {spec.label}
      </TableCell>
      {values.map(({ traceId, value }) => {
        const isWinner = traceId === winnerId;
        const isBaseline = traceId === baseline?.id;
        const delta =
          baselineValue != null && value != null && !isBaseline
            ? relativeDelta(spec, baselineValue, value)
            : null;
        return (
          <TableCell
            key={traceId}
            className={cn(
              "text-right tabular-nums",
              isWinner && "bg-emerald-500/10",
            )}
          >
            <div className="flex items-center justify-end gap-1.5">
              {isWinner ? (
                <Crown className="size-3 text-emerald-400" />
              ) : null}
              <MetricValue
                value={value}
                unit={spec.unit}
                precision={spec.precision}
              />
            </div>
            {delta != null ? (
              <div
                className={cn(
                  "text-[10px] font-mono mt-0.5",
                  delta > 0.01
                    ? "text-emerald-400/80"
                    : delta < -0.01
                      ? "text-red-400/80"
                      : "text-muted-foreground",
                )}
              >
                {formatDelta(delta)}
              </div>
            ) : null}
          </TableCell>
        );
      })}
    </TableRow>
  );
}

function relativeDelta(spec: MetricSpec, baseline: number, other: number) {
  if (baseline === 0) return 0;
  const raw = (other - baseline) / Math.abs(baseline);
  return spec.betterWhen === "high" ? raw : -raw;
}

function formatDelta(d: number): string {
  const pct = d * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function shortName(name: string): string {
  if (name.length <= 36) return name;
  return name.slice(0, 35) + "…";
}
