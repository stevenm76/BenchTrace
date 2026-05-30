"use client";

/**
 * Intermediate-tier compare radar. 5 default axes; each axis is normalized
 * against the best value seen across the baseline dataset (or max(a,b)
 * if no baseline is passed). Inverted axes (TTFT) normalize as min/value.
 *
 * Plain SVG — no Recharts. Polygons drawn against a 5-step concentric
 * grid; axis labels sit slightly outside the outer ring.
 *
 * Honesty: radar charts encode area, which can be misread as a single
 * "score". We display a banner above the chart to make that explicit,
 * and dashed segments where a value is missing.
 */

import type { TraceListRow } from "@/lib/db/queries/traces";
import { bestPoint, singleStreamPoint } from "@/lib/dashboard/aggregate";
import { compareColors } from "@/lib/charts/palette";

export interface RadarAxis {
  key: string;
  label: string;
  /** When true, smaller raw values are better; normalize as min/value. */
  inverted?: boolean;
  pick: (trace: TraceListRow) => number | null;
}

interface CompareRadarProps {
  a: TraceListRow;
  b: TraceListRow;
  axes?: RadarAxis[];
  /** All loaded traces; used to find best-in-dataset per axis for
   *  normalization. If omitted, normalization falls back to max(a,b). */
  baseline?: TraceListRow[];
}

export const DEFAULT_RADAR_AXES: RadarAxis[] = [
  {
    key: "outputTps",
    label: "Output tok/s",
    pick: (t) => bestPoint(t)?.outputTokensPerSecond ?? null,
  },
  {
    key: "singleStreamTps",
    label: "Single-stream tok/s",
    pick: (t) => singleStreamPoint(t)?.outputTokensPerSecond ?? null,
  },
  {
    key: "p95Ttft",
    label: "TTFT (lower is better)",
    inverted: true,
    pick: (t) => bestPoint(t)?.p95TtftMs ?? null,
  },
  {
    key: "vramEff",
    label: "VRAM eff. (tok/s · GB⁻¹)",
    pick: (t) => {
      const p = bestPoint(t);
      const tps = p?.outputTokensPerSecond ?? null;
      const vram = p?.peakVramGb ?? null;
      if (tps == null || vram == null || vram <= 0) return null;
      return tps / vram;
    },
  },
  {
    key: "tokensPerWatt",
    label: "tokens/Watt",
    pick: (t) => bestPoint(t)?.tokensPerWatt ?? null,
  },
];

interface NormBase {
  /** For non-inverted axes: max across dataset. For inverted: min across
   *  dataset (must be > 0). */
  basis: number | null;
  inverted: boolean;
}

function computeBases(
  axes: RadarAxis[],
  a: TraceListRow,
  b: TraceListRow,
  baseline: TraceListRow[] | undefined,
): NormBase[] {
  const dataset = baseline && baseline.length > 0 ? baseline : [a, b];
  return axes.map((axis) => {
    const values: number[] = [];
    for (const t of dataset) {
      const v = axis.pick(t);
      if (v != null && Number.isFinite(v) && v > 0) values.push(v);
    }
    if (values.length === 0) return { basis: null, inverted: !!axis.inverted };
    if (axis.inverted) {
      return { basis: Math.min(...values), inverted: true };
    }
    return { basis: Math.max(...values), inverted: false };
  });
}

function normalize(
  rawValue: number | null,
  base: NormBase,
): { norm: number; missing: boolean } {
  if (rawValue == null || base.basis == null || !Number.isFinite(rawValue)) {
    return { norm: 0, missing: true };
  }
  if (base.inverted) {
    if (rawValue <= 0) return { norm: 0, missing: true };
    const n = base.basis / rawValue;
    return { norm: clamp01(n), missing: false };
  }
  if (base.basis <= 0) return { norm: 0, missing: true };
  return { norm: clamp01(rawValue / base.basis), missing: false };
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

interface AxisGeom {
  angle: number; // radians, 0 = top
  cos: number;
  sin: number;
}

function geomForAxes(count: number, cx: number, cy: number, r: number) {
  const geom: AxisGeom[] = [];
  for (let i = 0; i < count; i++) {
    // Start at top (-PI/2), go clockwise.
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    geom.push({ angle, cos: Math.cos(angle), sin: Math.sin(angle) });
  }
  return geom.map((g) => ({
    ...g,
    endX: cx + r * g.cos,
    endY: cy + r * g.sin,
  }));
}

function pointAt(
  cx: number,
  cy: number,
  r: number,
  g: AxisGeom,
  norm: number,
): { x: number; y: number } {
  return {
    x: cx + r * norm * g.cos,
    y: cy + r * norm * g.sin,
  };
}

export function CompareRadar({
  a,
  b,
  axes = DEFAULT_RADAR_AXES,
  baseline,
}: CompareRadarProps) {
  const colors = compareColors("light");

  // SVG layout. The viewBox is fixed so the component scales fluidly.
  const W = 480;
  const H = 380;
  const cx = W / 2;
  const cy = H / 2 + 6;
  const r = 130;

  const geom = geomForAxes(axes.length, cx, cy, r);
  const bases = computeBases(axes, a, b, baseline);

  const aNorm = axes.map((axis, i) => normalize(axis.pick(a), bases[i]));
  const bNorm = axes.map((axis, i) => normalize(axis.pick(b), bases[i]));

  const aPoints = geom.map((g, i) => pointAt(cx, cy, r, g, aNorm[i].norm));
  const bPoints = geom.map((g, i) => pointAt(cx, cy, r, g, bNorm[i].norm));

  const rings = [0.2, 0.4, 0.6, 0.8, 1.0];

  // TODO: hover tooltip showing raw value + normalization base per axis.

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm p-5 space-y-3">
      <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
        Areas are illustrative — the shape isn&apos;t a single score.
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <Swatch color={colors.a} dashed={false} label={`A · ${shorten(a.name)}`} />
        <Swatch color={colors.b} dashed label={`B · ${shorten(b.name)}`} />
        <span className="ml-auto text-[10px] uppercase tracking-wider">
          Normalized vs.{" "}
          {baseline && baseline.length > 0 ? "loaded traces" : "max(A,B)"}
        </span>
      </div>

      <div className="flex justify-center">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full max-w-[520px] h-auto"
          role="img"
          aria-label="Radar comparison of A and B across normalized axes"
        >
          {/* Concentric ring grid */}
          {rings.map((ratio) => (
            <polygon
              key={ratio}
              points={geom
                .map((g) => {
                  const p = pointAt(cx, cy, r, g, ratio);
                  return `${p.x},${p.y}`;
                })
                .join(" ")}
              fill="none"
              stroke="#e2e8f0"
              strokeWidth={1}
            />
          ))}

          {/* Axis spokes */}
          {geom.map((g, i) => (
            <line
              key={`spoke-${i}`}
              x1={cx}
              y1={cy}
              x2={g.endX}
              y2={g.endY}
              stroke="#e2e8f0"
              strokeWidth={1}
            />
          ))}

          {/* B polygon (drawn first so A sits on top) */}
          <RadarPolygon
            points={bPoints}
            normalized={bNorm}
            stroke={colors.b}
            fill={colors.b}
            fillOpacity={0.14}
            dashed
          />

          {/* A polygon */}
          <RadarPolygon
            points={aPoints}
            normalized={aNorm}
            stroke={colors.a}
            fill={colors.a}
            fillOpacity={0.18}
            dashed={false}
          />

          {/* Per-axis vertex markers */}
          {aPoints.map((p, i) => (
            <circle
              key={`a-pt-${i}`}
              cx={p.x}
              cy={p.y}
              r={aNorm[i].missing ? 0 : 3}
              fill={colors.a}
            />
          ))}
          {bPoints.map((p, i) => (
            <circle
              key={`b-pt-${i}`}
              cx={p.x}
              cy={p.y}
              r={bNorm[i].missing ? 0 : 3}
              fill={colors.b}
            />
          ))}

          {/* Axis labels */}
          {geom.map((g, i) => {
            const labelR = r + 22;
            const lx = cx + labelR * g.cos;
            const ly = cy + labelR * g.sin;
            const anchor: "start" | "middle" | "end" =
              Math.abs(g.cos) < 0.15
                ? "middle"
                : g.cos > 0
                  ? "start"
                  : "end";
            return (
              <text
                key={`label-${i}`}
                x={lx}
                y={ly}
                textAnchor={anchor}
                dominantBaseline="middle"
                fontSize={11}
                fill="#64748b"
              >
                {axes[i].label}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/** Build a polygon whose edges go dashed when either endpoint is "missing".
 *  We do this by drawing the filled polygon + a stroked path that draws
 *  each edge individually so we can switch stroke-dasharray on per edge. */
function RadarPolygon({
  points,
  normalized,
  stroke,
  fill,
  fillOpacity,
  dashed,
}: {
  points: { x: number; y: number }[];
  normalized: { norm: number; missing: boolean }[];
  stroke: string;
  fill: string;
  fillOpacity: number;
  dashed: boolean;
}) {
  const polyPoints = points.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <g>
      <polygon
        points={polyPoints}
        fill={fill}
        fillOpacity={fillOpacity}
        stroke="none"
      />
      {/* Edges drawn separately so missing-segment dashing works. */}
      {points.map((p, i) => {
        const next = points[(i + 1) % points.length];
        const segmentMissing =
          normalized[i].missing || normalized[(i + 1) % normalized.length].missing;
        const useDash = dashed || segmentMissing;
        return (
          <line
            key={`edge-${i}`}
            x1={p.x}
            y1={p.y}
            x2={next.x}
            y2={next.y}
            stroke={stroke}
            strokeWidth={2}
            strokeDasharray={useDash ? "4 3" : undefined}
            strokeOpacity={segmentMissing ? 0.55 : 1}
          />
        );
      })}
    </g>
  );
}

function Swatch({
  color,
  dashed,
  label,
}: {
  color: string;
  dashed: boolean;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width={18} height={10} aria-hidden>
        <line
          x1={0}
          y1={5}
          x2={18}
          y2={5}
          stroke={color}
          strokeWidth={2}
          strokeDasharray={dashed ? "4 3" : undefined}
        />
      </svg>
      <span className="truncate max-w-[200px]">{label}</span>
    </span>
  );
}

function shorten(name: string, max = 24): string {
  return name.length <= max ? name : `${name.slice(0, max - 1)}…`;
}
