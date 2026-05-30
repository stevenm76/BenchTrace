"use client";

import {
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  CHART_AXIS_STROKE,
  CHART_GRID_STROKE,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
  engineColor,
} from "./chart-theme";
import { useChartMount } from "./useChartMount";

import type { ChartPoint } from "@/lib/dashboard/aggregate";

interface TooltipPayloadEntry {
  payload: ChartPoint;
}

function PointTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload;
  return (
    <div style={CHART_TOOLTIP_STYLE}>
      <div style={CHART_TOOLTIP_LABEL_STYLE}>{p.engine}</div>
      <div style={{ ...CHART_TOOLTIP_ITEM_STYLE, fontWeight: 500 }}>
        {p.traceName}
      </div>
      <div className="font-mono text-xs text-muted-foreground mt-1">
        {p.contextLength
          ? `${(p.contextLength / 1024).toFixed(0)}k ctx`
          : "—"}{" "}
        · {p.outputTokensPerSecond?.toFixed(1)} tok/s
      </div>
    </div>
  );
}

export function ContextVsThroughputScatter({ data }: { data: ChartPoint[] }) {
  const mounted = useChartMount();
  if (!mounted) return null;
  const filtered = data.filter(
    (d) => d.contextLength != null && d.outputTokensPerSecond != null,
  );

  if (filtered.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Need both context length and throughput to plot
      </div>
    );
  }

  const engines = [...new Set(filtered.map((d) => d.engine))];

  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      minWidth={0}
      minHeight={0}
      initialDimension={{ width: 1, height: 1 }}
    >
      <ScatterChart margin={{ top: 4, right: 16, left: 4, bottom: 20 }}>
        <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="contextLength"
          name="Context length"
          tick={CHART_TICK_STYLE}
          stroke={CHART_AXIS_STROKE}
          tickLine={false}
          tickFormatter={(v: number) => `${(v / 1024).toFixed(0)}k`}
          label={{
            value: "Context length",
            position: "bottom",
            offset: 0,
            fill: "var(--muted-foreground)",
            fontSize: 11,
          }}
        />
        <YAxis
          type="number"
          dataKey="outputTokensPerSecond"
          name="Output tok/s"
          tick={CHART_TICK_STYLE}
          stroke={CHART_AXIS_STROKE}
          tickLine={false}
        />
        <Tooltip content={<PointTooltip />} />
        <Legend
          verticalAlign="top"
          height={24}
          iconSize={10}
          wrapperStyle={{
            fontSize: 11,
            fontFamily: "var(--font-jetbrains-mono), monospace",
          }}
        />
        {engines.map((eng) => (
          <Scatter
            key={eng}
            name={eng}
            data={filtered.filter((d) => d.engine === eng)}
            fill={engineColor(eng)}
            isAnimationActive={false}
            shape={(props: {
              cx?: number;
              cy?: number;
              fill?: string;
              payload?: ChartPoint;
            }) => (
              <circle
                cx={props.cx ?? 0}
                cy={props.cy ?? 0}
                r={7}
                fill={props.fill}
                stroke="var(--background)"
                strokeWidth={1.5}
              >
                {props.payload ? (
                  <title>
                    {props.payload.traceName} ·{" "}
                    {props.payload.contextLength
                      ? `${(props.payload.contextLength / 1024).toFixed(0)}k ctx`
                      : "—"}{" "}
                    · {props.payload.outputTokensPerSecond?.toFixed(1)} tok/s
                  </title>
                ) : null}
              </circle>
            )}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}
