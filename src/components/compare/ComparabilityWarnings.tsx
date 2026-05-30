import { AlertOctagon, AlertTriangle, CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ComparabilityIssue } from "@/lib/compare";

interface Props {
  issues: ComparabilityIssue[];
  traceCount: number;
}

export function ComparabilityWarnings({ issues, traceCount }: Props) {
  const critical = issues.filter((i) => i.severity === "critical");
  const advisory = issues.filter((i) => i.severity === "advisory");

  if (traceCount < 2) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card/30 px-4 py-3 text-sm text-muted-foreground">
        Add at least two traces to see a comparison.
      </div>
    );
  }

  const apples = issues.length === 0;

  return (
    <div className="space-y-2">
      {apples ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 flex items-center gap-2 text-sm">
          <CheckCircle2 className="size-4 text-emerald-400" />
          <span>
            Apples-to-apples — all comparison dimensions match across traces.
          </span>
        </div>
      ) : (
        <>
          {critical.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-red-300">
                <AlertOctagon className="size-4" />
                {critical.length} critical mismatch
                {critical.length === 1 ? "" : "es"} — comparison may not be
                meaningful
              </div>
              <ul className="space-y-1.5">
                {critical.map((i) => (
                  <IssueRow key={i.dimension} issue={i} />
                ))}
              </ul>
            </div>
          )}
          {advisory.length > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-300">
                <AlertTriangle className="size-4" />
                {advisory.length} advisory mismatch
                {advisory.length === 1 ? "" : "es"} — may affect interpretation
              </div>
              <ul className="space-y-1.5">
                {advisory.map((i) => (
                  <IssueRow key={i.dimension} issue={i} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function IssueRow({ issue }: { issue: ComparabilityIssue }) {
  return (
    <li className="flex flex-wrap items-baseline gap-2 text-sm">
      <span className="text-muted-foreground min-w-24">{issue.label}:</span>
      <div className="flex flex-wrap gap-1.5">
        {issue.values.map((v, i) => (
          <Badge
            key={`${v.traceId}-${i}`}
            variant="outline"
            className="font-mono text-xs"
          >
            {v.value}
          </Badge>
        ))}
      </div>
    </li>
  );
}
