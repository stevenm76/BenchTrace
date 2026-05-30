/**
 * Chart-theme constants shared across all Recharts wrappers. Engine colors
 * now resolve through the central palette in src/lib/charts/palette.ts so
 * the same engine reads the same in every chart. CSS-var fallbacks remain
 * for charts that don't have an engine key.
 */
import { engineColor as paletteEngineColor } from "@/lib/charts/palette";

export function engineColor(engine: string | null | undefined): string {
  return paletteEngineColor(engine, "light");
}

/** Value-axis ticks (numbers). Lighter is fine — they're context, not content. */
export const CHART_TICK_STYLE = {
  fill: "var(--muted-foreground)",
  fontSize: 11,
  fontFamily: "var(--font-jetbrains-mono), var(--font-geist-mono), monospace",
};

/** Category-axis ticks (trace names, engine names, etc.). These ARE the
 *  content — they need to be legible. Darker + slightly larger than the
 *  numeric ticks. */
export const CHART_CATEGORY_TICK_STYLE = {
  fill: "var(--foreground)",
  fontSize: 13,
  fontWeight: 500,
  fontFamily: "var(--font-jetbrains-mono), var(--font-geist-mono), monospace",
};

export const CHART_AXIS_STROKE = "var(--border)";
export const CHART_GRID_STROKE = "var(--border)";

export const CHART_TOOLTIP_STYLE = {
  backgroundColor: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
  padding: "6px 10px",
  fontFamily: "var(--font-geist-sans)",
  boxShadow: "0 4px 12px rgba(15,23,42,0.08)",
};

export const CHART_TOOLTIP_ITEM_STYLE = {
  color: "var(--foreground)",
};

export const CHART_TOOLTIP_LABEL_STYLE = {
  color: "var(--muted-foreground)",
  fontSize: 11,
  marginBottom: 2,
};
