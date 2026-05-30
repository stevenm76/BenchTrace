import { Trophy } from "lucide-react";
import Link from "next/link";

import { EngineBadge } from "@/components/common/EngineBadge";
import { MetricValue } from "@/components/common/MetricValue";
import { QuantBadge } from "@/components/common/QuantBadge";
import { VerificationBadge } from "@/components/common/VerificationBadge";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BENCHMARK_PROFILES,
  type BenchmarkProfileId,
} from "@/lib/benchmark-profiles";
import { getTraces } from "@/lib/db/queries/traces";
import { rankForProfile } from "@/lib/profiles/ranking";
import { readTier, tierAtLeast } from "@/lib/tier/cookie";

export const dynamic = "force-dynamic";

const PROFILE_ORDER: BenchmarkProfileId[] = [
  "BT-CHAT-001",
  "BT-CODE-001",
  "BT-BATCH-001",
  "BT-LONGCTX-001",
  "BT-SERVE-001",
  "BT-PREFILL-DECODE-001",
];

export default async function ProfilesPage() {
  const tier = await readTier();
  const showEvaluated = tierAtLeast(tier, "intermediate");
  const showRequiredMetrics = tierAtLeast(tier, "expert");
  const showComparabilityNotes = tierAtLeast(tier, "intermediate");
  const sliceLimit = tier === "basic" ? 5 : tier === "intermediate" ? 10 : 25;

  const traces = await getTraces({ sortBy: "created_at", sortDir: "desc" });
  const rankings = PROFILE_ORDER.map((id) => ({
    id,
    ...rankForProfile(id, traces),
  }));

  return (
    <div className="p-8 space-y-6 max-w-screen-2xl mx-auto">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Performance profiles
        </h1>
        <p className="text-sm text-muted-foreground">
          Local ranking views per BenchTrace benchmark profile. Each profile
          prioritizes a different metric, so the ordering shifts.
        </p>
      </header>

      <Tabs defaultValue={PROFILE_ORDER[0]} className="space-y-4">
        <TabsList className="flex flex-wrap h-auto p-1">
          {PROFILE_ORDER.map((id) => (
            <TabsTrigger key={id} value={id} className="font-mono text-xs">
              {BENCHMARK_PROFILES[id].shortLabel}
            </TabsTrigger>
          ))}
        </TabsList>

        {rankings.map(({ id, profile, nativeRanked, evaluatedRanked }) => (
          <TabsContent key={id} value={id} className="space-y-4">
            <div className="rounded-lg border border-border bg-card/40 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-xs">
                  {profile.profileId}
                </Badge>
                <h2 className="text-lg font-semibold">{profile.name}</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                {profile.purpose}
              </p>
              {showRequiredMetrics ? (
                <div className="flex flex-wrap gap-1.5">
                  {profile.requiredMetrics.map((m) => (
                    <Badge
                      key={m}
                      variant="secondary"
                      className="font-mono text-xs"
                    >
                      {m}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {showComparabilityNotes ? (
                <p className="text-xs text-muted-foreground">
                  {profile.comparabilityNotes}
                </p>
              ) : null}
            </div>

            <RankSection
              title="Native runs"
              subtitle={`traces that ran ${profile.profileId} as their workload`}
              ranked={nativeRanked.slice(0, sliceLimit)}
              icon={<Trophy className="size-4 text-amber-400" />}
              emptyMessage={`No native ${profile.profileId} runs yet. Try \`npm run bench -- serve --profile ${profile.profileId} ...\` to produce one.`}
            />

            {showEvaluated && evaluatedRanked.length > 0 ? (
              <RankSection
                title="Evaluated against this profile"
                subtitle="traces from other workloads that happen to have the metrics this profile cares about"
                ranked={evaluatedRanked.slice(0, sliceLimit)}
                icon={null}
                emptyMessage=""
                muted
              />
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function RankSection({
  title,
  subtitle,
  ranked,
  icon,
  emptyMessage,
  muted,
}: {
  title: string;
  subtitle: string;
  ranked: ReturnType<typeof rankForProfile>["nativeRanked"];
  icon: React.ReactNode;
  emptyMessage: string;
  muted?: boolean;
}) {
  return (
    <div
      className={
        "rounded-lg border border-border overflow-hidden " +
        (muted ? "bg-card/20" : "bg-card/40")
      }
    >
      <div className="px-4 py-3 border-b border-border/60 text-sm font-semibold flex items-center gap-2">
        {icon}
        <span>{title}</span>
        <span className="text-xs font-normal text-muted-foreground">
          · {subtitle}
        </span>
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {ranked.length} trace{ranked.length === 1 ? "" : "s"}
        </span>
      </div>
      {ranked.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground font-mono">
          {emptyMessage}
        </div>
      ) : (
        <div className="divide-y divide-border/60">
          {ranked.map((r, idx) => (
            <Link
              key={r.trace.id}
              href={`/traces/${r.trace.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors"
            >
              <span className="font-mono text-xs text-muted-foreground w-6">
                #{idx + 1}
              </span>
              <EngineBadge engine={r.trace.engine.type} />
              <QuantBadge quantization={r.trace.model.quantization} />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{r.trace.name}</div>
                <div className="text-xs text-muted-foreground font-mono mt-0.5">
                  {r.reason}
                </div>
              </div>
              <div className="text-right shrink-0 font-mono text-xs space-y-0.5">
                <div>
                  <MetricValue
                    value={r.metrics.outputTokensPerSecond}
                    unit=" tok/s"
                  />
                </div>
                <div className="text-muted-foreground">
                  <MetricValue
                    value={r.metrics.p95TtftMs}
                    unit=" ms"
                    precision={0}
                  />
                </div>
              </div>
              <VerificationBadge level={r.trace.verificationLevel} compact />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
