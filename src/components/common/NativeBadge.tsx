import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface NativeBadgeProps {
  /** Show the icon (default true). Set false for very dense rows. */
  showIcon?: boolean;
  className?: string;
}

/**
 * Marks traces produced by the BenchTrace native runner (BT-SERVE-001 etc.).
 * Detection at the call site: `trace.nativeBenchmarkTool === "benchtrace"`
 * or `trace.benchmarkProfile?.tool === "benchtrace"`.
 */
export function NativeBadge({ showIcon = true, className }: NativeBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 text-xs font-medium uppercase tracking-wide",
        "border-sky-400/40 bg-sky-400/15 text-sky-300",
        className,
      )}
    >
      {showIcon ? <Sparkles className="size-3" /> : null}
      Native
    </Badge>
  );
}

/**
 * Helper for predicate use at call sites.
 */
export function isNativeBenchTrace(arg: {
  nativeBenchmarkTool?: string | null;
  benchmarkProfile?: { tool?: string | null } | null;
}): boolean {
  return (
    arg.nativeBenchmarkTool === "benchtrace" ||
    arg.benchmarkProfile?.tool === "benchtrace"
  );
}
