import { EngineBadge } from "@/components/common/EngineBadge";

interface EngineDistributionProps {
  distribution: { engine: string; count: number }[];
  totalTraces: number;
}

export function EngineDistribution({
  distribution,
  totalTraces,
}: EngineDistributionProps) {
  if (distribution.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-card/40 px-4 py-3 flex items-center gap-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground shrink-0">
        Engines
      </div>
      <div className="flex-1 flex flex-wrap items-center gap-3">
        {distribution.map(({ engine, count }) => (
          <div key={engine} className="flex items-center gap-1.5">
            <EngineBadge engine={engine} />
            <span className="font-mono text-xs text-muted-foreground">
              ×{count}
            </span>
          </div>
        ))}
      </div>
      <div className="text-xs font-mono text-muted-foreground shrink-0">
        {totalTraces} total
      </div>
    </div>
  );
}
