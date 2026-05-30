import { FileText, Hash } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import type { Artifact, ParserStatus } from "@/lib/db/schema";

const PARSER_STATUS: Record<
  ParserStatus,
  { label: string; className: string }
> = {
  parsed: {
    label: "Parsed",
    className: "border-emerald-500/40 text-emerald-300 bg-emerald-500/15",
  },
  partially_parsed: {
    label: "Partial",
    className: "border-amber-500/40 text-amber-300 bg-amber-500/15",
  },
  failed: {
    label: "Failed",
    className: "border-destructive/50 text-red-300 bg-destructive/15",
  },
  manual: {
    label: "Manual",
    className: "border-muted-foreground/30 text-muted-foreground bg-muted/40",
  },
};

export function ArtifactViewer({ artifacts }: { artifacts: Artifact[] }) {
  if (artifacts.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card/30 px-4 py-6 text-center text-sm text-muted-foreground">
        No raw artifacts captured for this trace.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-card/40 divide-y divide-border/60">
      {artifacts.map((a) => {
        const status = a.parserStatus ? PARSER_STATUS[a.parserStatus] : null;
        const shortHash = a.sha256
          ? `${a.sha256.slice(0, 12)}…${a.sha256.slice(-6)}`
          : null;
        return (
          <div key={a.id} className="px-3 py-2.5 flex items-center gap-3">
            <FileText className="size-4 text-muted-foreground shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-mono truncate">{a.filename}</div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                <span className="uppercase tracking-wider">{a.type}</span>
                {shortHash ? (
                  <span className="inline-flex items-center gap-1 font-mono">
                    <Hash className="size-3" />
                    {shortHash}
                  </span>
                ) : (
                  <span className="text-amber-400/70">no hash</span>
                )}
                {a.parser ? (
                  <span className="font-mono">parser={a.parser}</span>
                ) : null}
              </div>
            </div>
            {status ? (
              <Badge variant="outline" className={status.className}>
                {status.label}
                {a.parserConfidence != null
                  ? ` · ${(a.parserConfidence * 100).toFixed(0)}%`
                  : ""}
              </Badge>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
