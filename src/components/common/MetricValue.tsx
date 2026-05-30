import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface MetricValueProps {
  /** The captured value. `null` / `undefined` render as "not captured". */
  value: number | string | null | undefined;
  /** Suffix (" tok/s", " ms", " GB"). Includes its own leading space if needed. */
  unit?: string;
  /** Decimal places when value is numeric. Default 1. Pass 0 for integers. */
  precision?: number;
  /** Label shown in the tooltip when the value is missing. */
  missingLabel?: string;
  /** When true (default) numeric values render in the monospace font. */
  mono?: boolean;
  /** Visual emphasis. `subtle` is for inline cell values, `prominent` for hero stats. */
  emphasis?: "subtle" | "prominent";
  /** Override the wrapper class — useful for grid alignment. */
  className?: string;
}

/**
 * Renders a captured metric — or an explicit "not captured" indicator when
 * the value is absent. The MVP design principle is that missing data must
 * be visible, never silently omitted.
 */
export function MetricValue({
  value,
  unit,
  precision = 1,
  missingLabel = "not captured",
  mono = true,
  emphasis = "subtle",
  className,
}: MetricValueProps) {
  const isMissing = value === null || value === undefined;

  if (isMissing) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={cn(
                "cursor-help select-none text-amber-400/70",
                mono && "font-mono",
                emphasis === "prominent" && "text-2xl",
                className,
              )}
              aria-label={missingLabel}
            >
              —
            </span>
          }
        />
        <TooltipContent>{missingLabel}</TooltipContent>
      </Tooltip>
    );
  }

  let rendered: string;
  if (typeof value === "number") {
    rendered = Number.isInteger(value) && precision === 0
      ? value.toLocaleString()
      : value.toFixed(precision);
  } else {
    rendered = value;
  }

  return (
    <span
      className={cn(
        mono && "font-mono tabular-nums",
        emphasis === "prominent" && "text-2xl",
        className,
      )}
    >
      {rendered}
      {unit ? <span className="text-muted-foreground">{unit}</span> : null}
    </span>
  );
}
