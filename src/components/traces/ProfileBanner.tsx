import { Activity, Code2, Database, FileText, Layers, Network, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  BENCHMARK_PROFILES,
  type BenchmarkProfileId,
} from "@/lib/benchmark-profiles";

import type { TraceDetail } from "@/lib/db/queries/traces";

/**
 * Surfaces the BT-* profile a trace was run under, with a short description
 * of what that profile measures. Visible on every native trace regardless of
 * profile id — gives users the "this is a coding workload" signal that was
 * previously buried in the model section.
 */
export function ProfileBanner({ trace }: { trace: TraceDetail }) {
  const profileId = trace.benchmarkProfile?.profileId;
  if (!profileId || !(profileId in BENCHMARK_PROFILES)) return null;
  const def = BENCHMARK_PROFILES[profileId as BenchmarkProfileId];
  const Icon =
    profileId === "BT-CHAT-001"
      ? Activity
      : profileId === "BT-CODE-001"
        ? Code2
        : profileId === "BT-BATCH-001"
          ? Database
          : profileId === "BT-LONGCTX-001"
            ? FileText
            : profileId === "BT-SERVE-001"
              ? Network
              : Layers;

  const bp = trace.benchmarkProfile!;
  const summary = [
    bp.workloadType ? bp.workloadType.replace(/_/g, " ") : null,
    bp.inputLength ? `in ${bp.inputLength}` : null,
    bp.outputLength ? `out ${bp.outputLength}` : null,
    bp.concurrency ? `c=${bp.concurrency}` : null,
    bp.streamingEnabled === false ? "non-streaming" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const slas = [
    bp.ttftSlaMs != null ? `TTFT ≤ ${bp.ttftSlaMs} ms` : null,
    bp.tpotSlaMs != null ? `TPOT ≤ ${bp.tpotSlaMs} ms` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-md border border-sky-500/30 bg-sky-500/5 px-4 py-3 flex items-start gap-3">
      <Icon className="size-5 text-sky-300 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <Badge
            variant="outline"
            className="font-mono text-xs border-sky-400/40 text-sky-300 bg-sky-500/10"
          >
            {def.profileId}
          </Badge>
          <span className="text-sm font-semibold text-sky-100">{def.name}</span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Sparkles className="size-3" />
            Native BenchTrace run
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{def.purpose}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-mono text-muted-foreground">
          {summary ? <span>{summary}</span> : null}
          {slas ? <span>SLAs · {slas}</span> : null}
        </div>
      </div>
    </div>
  );
}
