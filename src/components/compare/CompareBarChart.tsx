"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  CHART_AXIS_STROKE,
  CHART_CATEGORY_TICK_STYLE,
  CHART_GRID_STROKE,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
} from "@/components/dashboard/chart-theme";
import { useChartMount } from "@/components/dashboard/useChartMount";
import { buildRunColorMap, middleTruncate } from "@/lib/charts/run-identity";

interface CompareBarPoint {
  traceId: string;
  shortName: string;
  fullName: string;
  engine: string;
  value: number | null;
}

interface CompareBarChartProps {
  data: CompareBarPoint[];
  unit?: string;
  title: string;
}

interface TooltipPayloadEntry {
  payload: CompareBarPoint;
}

function CompareTooltip({
  active,
  payload,
  unit,
  title,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  unit: string;
  title: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload;
  return (
    <div style={CHART_TOOLTIP_STYLE}>
      <div style={CHART_TOOLTIP_LABEL_STYLE}>{p.engine}</div>
      <div style={{ ...CHART_TOOLTIP_ITEM_STYLE, fontWeight: 500 }}>
        {p.fullName}
      </div>
      <div className="font-mono text-xs text-muted-foreground mt-1">
        {p.value?.toFixed(1)}
        {unit} {title}
      </div>
    </div>
  );
}

function RunTick(props: {
  x?: number | string;
  y?: number | string;
  payload?: { value?: string };
  labelById: Map<string, { label: string; full: string }>;
}) {
  const { x = 0, y = 0, payload, labelById } = props;
  const entry = payload?.value ? labelById.get(payload.value) : undefined;
  if (!entry) return null;
  return (
    <g transform={`translate(${Number(x)},${Number(y)})`}>
      <text
        x={-4}
        y={0}
        dy="0.32em"
        textAnchor="end"
        fill={CHART_CATEGORY_TICK_STYLE.fill}
        fontSize={CHART_CATEGORY_TICK_STYLE.fontSize}
        fontWeight={CHART_CATEGORY_TICK_STYLE.fontWeight}
        fontFamily={CHART_CATEGORY_TICK_STYLE.fontFamily}
      >
        {entry.label}
        <title>{entry.full}</title>
      </text>
    </g>
  );
}

export function CompareBarChart({ data, unit, title }: CompareBarChartProps) {
  const mounted = useChartMount();
  if (!mounted) return null;
  const filtered = data.filter(
    (d): d is CompareBarPoint & { value: number } => d.value != null,
  );
  if (filtered.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        No data for {title}
      </div>
    );
  }
  const labelById = new Map<string, { label: string; full: string }>(
    filtered.map((d) => [
      d.traceId,
      { label: middleTruncate(d.fullName, 34), full: d.fullName },
    ]),
  );
  const colorById = buildRunColorMap(filtered.map((d) => d.traceId));
  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      minWidth={0}
      minHeight={0}
      initialDimension={{ width: 1, height: 1 }}
    >
      <BarChart
        data={filtered}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
      >
        <CartesianGrid
          stroke={CHART_GRID_STROKE}
          strokeDasharray="3 3"
          horizontal={false}
        />
        <XAxis
          type="number"
          tick={CHART_TICK_STYLE}
          stroke={CHART_AXIS_STROKE}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="traceId"
          tick={(tickProps) => <RunTick {...tickProps} labelById={labelById} />}
          stroke={CHART_AXIS_STROKE}
          tickLine={false}
          width={200}
          interval={0}
        />
        <Tooltip
          cursor={{ fill: "var(--accent)", fillOpacity: 0.4 }}
          content={<CompareTooltip unit={unit ?? ""} title={title} />}
        />
        <Bar
          dataKey="value"
          radius={[0, 4, 4, 0]}
          maxBarSize={28}
          isAnimationActive={false}
        >
          {filtered.map((d) => (
            <Cell key={d.traceId} fill={colorById.get(d.traceId)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
