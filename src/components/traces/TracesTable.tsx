"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { EngineBadge } from "@/components/common/EngineBadge";
import { MetricValue } from "@/components/common/MetricValue";
import { NativeBadge, isNativeBenchTrace } from "@/components/common/NativeBadge";
import { QuantBadge } from "@/components/common/QuantBadge";
import { VerificationBadge } from "@/components/common/VerificationBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatAbsolute, formatRelativeShort } from "@/lib/format/time";
import { tierAtLeast } from "@/lib/tier/types";
import { useTier } from "@/lib/tier/useTier";
import {
  buildTraceQuery,
  parseTraceFilters,
} from "@/lib/traces/url-filters";
import { cn } from "@/lib/utils";

import type {
  TraceListRow,
  TraceSortKey,
} from "@/lib/db/queries/traces";

interface TracesTableProps {
  traces: (TraceListRow & {
    bestMetric: {
      outputTokensPerSecond: number | null;
      p95TtftMs: number | null;
      p95TpotMs: number | null;
      peakVramGb: number | null;
      concurrency: number | null;
    } | null;
  })[];
}

type ColumnKey = TraceSortKey | "engine" | "model" | "context_length";

type ColumnDef = {
  key: ColumnKey;
  label: string;
  sortable: boolean;
  className?: string;
  align?: "left" | "right";
  /** Minimum tier required to render this column. */
  minTier: "basic" | "intermediate" | "expert";
};

const COLUMNS: ColumnDef[] = [
  { key: "name", label: "Trace", sortable: true, minTier: "basic" },
  { key: "engine", label: "Engine", sortable: false, minTier: "basic" },
  { key: "model", label: "Model", sortable: false, minTier: "intermediate" },
  {
    key: "context_length",
    label: "Ctx",
    sortable: true,
    align: "right",
    minTier: "expert",
  },
  {
    key: "output_tokens_per_second",
    label: "tok/s",
    sortable: true,
    align: "right",
    minTier: "basic",
  },
  {
    key: "p95_ttft_ms",
    label: "TTFT p95",
    sortable: true,
    align: "right",
    minTier: "intermediate",
  },
  {
    key: "peak_vram_gb",
    label: "VRAM",
    sortable: true,
    align: "right",
    minTier: "expert",
  },
  {
    key: "created_at",
    label: "When",
    sortable: true,
    align: "right",
    minTier: "basic",
  },
  {
    key: "verification",
    label: "Verify",
    sortable: true,
    align: "right",
    minTier: "basic",
  },
];

function hardwareSummary(row: TraceListRow): string {
  const hp = row.hardwareProfile;
  const gpuCount = hp.gpuCount ?? hp.gpuModels?.length ?? 0;
  const gpuName =
    hp.gpuModels?.[0]?.name?.replace(/^NVIDIA GeForce /i, "") ?? "—";
  if (!gpuCount) return gpuName;
  return `${gpuCount}× ${gpuName}`;
}

export function TracesTable({ traces }: TracesTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { tier } = useTier();
  const filters = parseTraceFilters(
    Object.fromEntries(searchParams.entries()),
  );

  const visibleColumns = COLUMNS.filter((col) => tierAtLeast(tier, col.minTier));
  const showModel = tierAtLeast(tier, "intermediate");
  const showContext = tierAtLeast(tier, "expert");
  const showTtft = tierAtLeast(tier, "intermediate");
  const showVram = tierAtLeast(tier, "expert");
  const verificationCompact = !tierAtLeast(tier, "expert");

  function toggleSort(key: TraceSortKey) {
    const sameKey = filters.sortBy === key;
    const dir: "asc" | "desc" =
      sameKey && filters.sortDir === "desc" ? "asc" : "desc";
    const q = buildTraceQuery({ ...filters, sortBy: key, sortDir: dir });
    router.replace(q ? `${pathname}?${q}` : pathname);
  }

  return (
    <div className="rounded-md border border-border overflow-hidden bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {visibleColumns.map((col) => {
              const sortable = col.sortable;
              const active = filters.sortBy === col.key;
              const Icon = !sortable
                ? null
                : !active
                  ? ArrowUpDown
                  : filters.sortDir === "asc"
                    ? ArrowUp
                    : ArrowDown;
              return (
                <TableHead
                  key={col.key}
                  className={cn(
                    "text-xs font-medium text-muted-foreground uppercase tracking-wider",
                    col.align === "right" && "text-right",
                  )}
                >
                  {sortable ? (
                    <button
                      onClick={() => toggleSort(col.key as TraceSortKey)}
                      className={cn(
                        "inline-flex items-center gap-1 hover:text-foreground transition-colors",
                        active && "text-foreground",
                      )}
                    >
                      {col.label}
                      {Icon ? <Icon className="size-3" /> : null}
                    </button>
                  ) : (
                    col.label
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {traces.map((t) => {
            const m = t.bestMetric;
            return (
              <TableRow
                key={t.id}
                className="group cursor-pointer"
                onClick={() => router.push(`/traces/${t.id}`)}
              >
                <TableCell className="font-medium max-w-md">
                  <Link
                    href={`/traces/${t.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="block truncate hover:text-primary transition-colors"
                  >
                    {t.name}
                  </Link>
                  <div className="text-xs text-muted-foreground mt-0.5 font-mono">
                    {hardwareSummary(t)}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <EngineBadge engine={t.engine.type} version={t.engine.version} />
                    {isNativeBenchTrace({
                      nativeBenchmarkTool: t.nativeBenchmarkTool,
                      benchmarkProfile: null,
                    }) ? (
                      <NativeBadge showIcon={false} />
                    ) : null}
                  </div>
                </TableCell>
                {showModel ? (
                  <TableCell className="text-sm">
                    <div className="flex items-center gap-1.5">
                      <QuantBadge quantization={t.model.quantization} />
                      {t.loaderConfig?.kvCacheDtype ? (
                        <span className="font-mono text-xs text-muted-foreground">
                          KV={t.loaderConfig.kvCacheDtype}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[18rem]">
                      {t.model.name}
                    </div>
                  </TableCell>
                ) : null}
                {showContext ? (
                  <TableCell className="text-right">
                    <MetricValue
                      value={t.contextLength}
                      precision={0}
                      unit=""
                    />
                  </TableCell>
                ) : null}
                <TableCell className="text-right">
                  <MetricValue
                    value={m?.outputTokensPerSecond ?? null}
                    unit=" tok/s"
                  />
                  {m?.concurrency != null ? (
                    <div className="text-xs text-muted-foreground mt-0.5 font-mono">
                      @c={m.concurrency}
                    </div>
                  ) : null}
                </TableCell>
                {showTtft ? (
                  <TableCell className="text-right">
                    <MetricValue
                      value={m?.p95TtftMs ?? null}
                      unit=" ms"
                      precision={0}
                    />
                  </TableCell>
                ) : null}
                {showVram ? (
                  <TableCell className="text-right">
                    <MetricValue
                      value={m?.peakVramGb ?? null}
                      unit=" GB"
                    />
                  </TableCell>
                ) : null}
                <TableCell className="text-right">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span className="font-mono text-xs text-muted-foreground cursor-help">
                          {formatRelativeShort(
                            t.completedAt ?? t.startedAt ?? t.createdAt,
                          )}
                        </span>
                      }
                    />
                    <TooltipContent>
                      {formatAbsolute(
                        t.completedAt ?? t.startedAt ?? t.createdAt,
                      )}
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell className="text-right">
                  <VerificationBadge
                    level={t.verificationLevel}
                    compact={verificationCompact}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
