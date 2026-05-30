"use client";

/**
 * Basic-tier compare scorecard. One row per metric, two horizontal bars
 * (A=sky-600 / B=slate-400) sized as a percentage of the larger value.
 * Lower-is-better metrics invert the visual fill so the winning value is
 * still the longer bar.
 *
 * Pure HTML/CSS — no SVG, no Recharts. Designed to render comfortably at
 * ~32px per row without scrolling for 4-10 metric rows.
 */

import type { TraceListRow } from "@/lib/db/queries/traces";
import { bestPoint, singleStreamPoint } from "@/lib/dashboard/aggregate";
import { compareColors } from "@/lib/charts/palette";
import { cn } from "@/lib/utils";

type MetricKey =
  | "outputTps"
  | "singleStreamTps"
  | "p95Ttft"
  | "peakVram"
  | "tokensPerWatt"
  | "totalTps";

export interface PairedBarMetric {
  key: MetricKey | string;
  label: string;
  lowerIsBetter: boolean;
  unit: string;
  /** How many decimal places (default 1). */
  precision?: number;
  /** Extract the raw value (number) or null if missing. */
  pick: (trace: TraceListRow) => number | null;
}

interface PairedBarCompareProps {
  a: TraceListRow;
  b: TraceListRow;
  metrics?: PairedBarMetric[];
}

export const DEFAULT_PAIRED_METRICS: PairedBarMetric[] = [
  // Single-stream (c=1) leads — it's the metric most interactive workloads
  // actually feel. Concurrent throughput is the "under load" counterpart.
  {
    key: "singleStreamTps",
    label: "Single-stream tok/s (c=1)",
    lowerIsBetter: false,
    unit: "tok/s",
    precision: 1,
    pick: (t) => singleStreamPoint(t)?.outputTokensPerSecond ?? null,
  },
  {
    key: "outputTps",
    label: "Concurrent tok/s",
    lowerIsBetter: false,
    unit: "tok/s",
    precision: 1,
    pick: (t) => bestPoint(t)?.outputTokensPerSecond ?? null,
  },
  {
    key: "p95Ttft",
    label: "TTFT p95",
    lowerIsBetter: true,
    unit: "ms",
    precision: 0,
    pick: (t) => bestPoint(t)?.p95TtftMs ?? null,
  },
  {
    key: "peakVram",
    label: "Peak VRAM",
    lowerIsBetter: true,
    unit: "GB",
    precision: 1,
    pick: (t) => bestPoint(t)?.peakVramGb ?? null,
  },
];

function formatValue(value: number, unit: string, precision: number): string {
  const v = value.toFixed(precision);
  return unit ? `${v} ${unit}` : v;
}

function shortName(name: string, max = 26): string {
  return name.length <= max ? name : `${name.slice(0, max - 1)}…`;
}

/** Returns [aPct, bPct] in [0,100] describing how much of the row each bar
 *  should fill, given the raw values and direction. */
function barWidths(
  aValue: number | null,
  bValue: number | null,
  lowerIsBetter: boolean,
): [number, number] {
  const a = aValue;
  const b = bValue;
  if (a == null && b == null) return [0, 0];
  if (a == null) return [0, lowerIsBetter ? 100 : 100];
  if (b == null) return [lowerIsBetter ? 100 : 100, 0];

  const max = Math.max(Math.abs(a), Math.abs(b));
  if (max === 0) return [0, 0];

  if (!lowerIsBetter) {
    return [
      Math.min(100, (a / max) * 100),
      Math.min(100, (b / max) * 100),
    ];
  }

  // Lower-is-better: invert so the smaller value gets the longer bar.
  // Formula from spec: (2 - value/max(a,b)) * 100, clamped to [0,100].
  const aPct = Math.max(0, Math.min(100, (2 - a / max) * 100));
  const bPct = Math.max(0, Math.min(100, (2 - b / max) * 100));
  return [aPct, bPct];
}

function pickWinner(
  aValue: number | null,
  bValue: number | null,
  lowerIsBetter: boolean,
): "a" | "b" | null {
  if (aValue == null && bValue == null) return null;
  if (aValue == null) return "b";
  if (bValue == null) return "a";
  if (aValue === bValue) return null;
  if (lowerIsBetter) return aValue < bValue ? "a" : "b";
  return aValue > bValue ? "a" : "b";
}

export function PairedBarCompare({
  a,
  b,
  metrics = DEFAULT_PAIRED_METRICS,
}: PairedBarCompareProps) {
  const colors = compareColors("light");

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-4 text-xs uppercase tracking-wider text-muted-foreground">
        <span>Scorecard</span>
        <div className="flex items-center gap-4 normal-case tracking-normal">
          <Legend color={colors.a} label={`A · ${shortName(a.name)}`} />
          <Legend color={colors.b} label={`B · ${shortName(b.name)}`} />
        </div>
      </div>

      <div className="divide-y divide-border">
        {metrics.map((m) => {
          const aValue = m.pick(a);
          const bValue = m.pick(b);
          const winner = pickWinner(aValue, bValue, m.lowerIsBetter);
          const [aPct, bPct] = barWidths(aValue, bValue, m.lowerIsBetter);
          const precision = m.precision ?? 1;

          return (
            <div key={m.key} className="px-5 py-2.5">
              <div className="grid grid-cols-12 items-center gap-3 min-h-[28px]">
                <div className="col-span-3 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">
                    {m.label}
                  </div>
                  {m.lowerIsBetter ? (
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
                      lower is better
                    </div>
                  ) : null}
                </div>

                <BarSide
                  side="a"
                  pct={aPct}
                  value={aValue}
                  isWinner={winner === "a"}
                  color={colors.a}
                  unit={m.unit}
                  precision={precision}
                />
                <BarSide
                  side="b"
                  pct={bPct}
                  value={bValue}
                  isWinner={winner === "b"}
                  color={colors.b}
                  unit={m.unit}
                  precision={precision}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BarSide({
  side,
  pct,
  value,
  isWinner,
  color,
  unit,
  precision,
}: {
  side: "a" | "b";
  pct: number;
  value: number | null;
  isWinner: boolean;
  color: string;
  unit: string;
  precision: number;
}) {
  // A bar grows right-to-... A grows leftwards from center? No — spec says
  // two horizontal bars per row. Layout: bar fills the cell from left to
  // right, value sits on the right edge.
  const containerClasses = cn(
    "col-span-4 lg:col-span-4 relative h-5 rounded-sm",
    isWinner ? "ring-1 ring-sky-200/80" : "ring-0",
  );
  return (
    <div className="col-span-4 grid grid-cols-[1fr_auto] items-center gap-2">
      <div
        className={cn(
          containerClasses,
          isWinner ? "bg-sky-50" : "bg-muted/40",
        )}
        aria-hidden
      >
        {value != null ? (
          <div
            className="h-full rounded-sm transition-[width] duration-200"
            style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.85 }}
          />
        ) : (
          <NaPill />
        )}
      </div>
      <div
        className={cn(
          "tabular-nums text-sm text-right min-w-[64px]",
          isWinner ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
      >
        {value == null ? (
          <span className="text-muted-foreground/70 text-xs">n/a</span>
        ) : (
          <ValueLabel value={value} unit={unit} precision={precision} />
        )}
      </div>
      {/* side is a data attribute purely for debugging */}
      <span className="sr-only" data-side={side} />
    </div>
  );
}

function ValueLabel({
  value,
  unit,
  precision,
}: {
  value: number;
  unit: string;
  precision: number;
}) {
  return (
    <span>
      {formatValue(value, "", precision)}
      {unit ? (
        <span className="text-[10px] text-muted-foreground ml-1">{unit}</span>
      ) : null}
    </span>
  );
}

function NaPill() {
  return (
    <div
      className="absolute inset-0 flex items-center justify-start pl-2"
      title="No data"
    >
      <span
        className="text-[10px] uppercase tracking-wider text-muted-foreground/70 px-1.5 py-0.5 rounded-sm"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, rgba(148,163,184,0.18) 0 4px, transparent 4px 8px)",
        }}
      >
        n/a
      </span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className="inline-block size-2.5 rounded-sm"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="truncate max-w-[180px]">{label}</span>
    </span>
  );
}
