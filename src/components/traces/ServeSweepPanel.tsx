import { Check, Crown, X } from "lucide-react";

import { MetricValue } from "@/components/common/MetricValue";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { metricFamilyView, type MetricMode } from "@/lib/metric-family";

import type { TraceDetail } from "@/lib/db/queries/traces";

interface Props {
  trace: TraceDetail;
}

/**
 * Renders BT-SERVE-001-specific output: max valid concurrency callout +
 * per-level validity table + invalid-level reasons. Pulls everything it
 * needs from the existing metric_points + benchmark_profile.ttftSlaMs /
 * tpotSlaMs columns — no extra schema required.
 */
export function ServeSweepPanel({ trace }: Props) {
  const bp = trace.benchmarkProfile;
  if (!bp) return null;

  const ttftSla = bp.ttftSlaMs;
  const tpotSla = bp.tpotSlaMs;
  // Hard-coded 5% failure ceiling matches the CLI default; the workload
  // command/notes are the source of truth if it was overridden.
  const failureCeil = 0.05;

  const fam = metricFamilyView(trace.metricMode as MetricMode);
  // Gate the latency SLA on the trace's *primary* family: native traces are
  // judged on chunk-gap (what the SLA was historically tuned against), while
  // vLLM-compatible traces are judged on token-normalized TPOT.
  const slaValue = (m: (typeof trace.metricPoints)[number]): number | null =>
    fam.primary === "chunkGap" ? m.p95ChunkGapMs ?? null : m.p95TpotMs ?? null;
  const slaLabel = fam.primary === "chunkGap" ? "chunk-gap p95" : "TPOT p95";

  const rows = [...trace.metricPoints]
    .filter((m) => m.concurrency != null)
    .sort((a, b) => (a.concurrency ?? 0) - (b.concurrency ?? 0))
    .map((m) => {
      const meetsTtft =
        ttftSla == null
          ? true
          : m.p95TtftMs == null
            ? false
            : m.p95TtftMs <= ttftSla;
      const latVal = slaValue(m);
      const meetsTpot =
        tpotSla == null ? true : latVal == null ? false : latVal <= tpotSla;
      const meetsFailure =
        m.failureRate == null ? true : m.failureRate <= failureCeil;
      const valid = meetsTtft && meetsTpot && meetsFailure;
      const reasons: string[] = [];
      if (!meetsTtft && m.p95TtftMs != null) {
        reasons.push(`TTFT p95 ${m.p95TtftMs.toFixed(0)} > ${ttftSla}`);
      }
      if (!meetsTpot && latVal != null) {
        reasons.push(`${slaLabel} ${latVal.toFixed(1)} > ${tpotSla}`);
      }
      if (!meetsFailure && m.failureRate != null) {
        reasons.push(
          `failure ${(m.failureRate * 100).toFixed(1)}% > ${(failureCeil * 100).toFixed(0)}%`,
        );
      }
      return { metric: m, valid, meetsTtft, meetsTpot, meetsFailure, reasons };
    });

  const validRowsDesc = rows.filter((r) => r.valid).sort(
    (a, b) => (b.metric.concurrency ?? 0) - (a.metric.concurrency ?? 0),
  );
  const maxValid = validRowsDesc[0];
  const invalid = rows.filter((r) => !r.valid);

  const singleStream = rows.find((r) => r.metric.concurrency === 1);
  // "Best overall" only counts rows that satisfy the SLAs. Reporting the
  // peak throughput from a row whose TTFT busted the SLA isn't a meaningful
  // serving number — that's just queueing.
  const bestOverall = rows.reduce<typeof rows[number] | null>(
    (acc, r) =>
      r.valid &&
      r.metric.outputTokensPerSecond != null &&
      (acc == null ||
        (r.metric.outputTokensPerSecond ?? 0) >
          (acc.metric.outputTokensPerSecond ?? 0))
        ? r
        : acc,
    null,
  );
  // Highest raw throughput regardless of SLA — surfaced as the "peak but
  // queueing" footnote so users can see why "best overall" capped where it did.
  const peakObserved = rows.reduce<typeof rows[number] | null>(
    (acc, r) =>
      r.metric.outputTokensPerSecond != null &&
      (acc == null ||
        (r.metric.outputTokensPerSecond ?? 0) >
          (acc.metric.outputTokensPerSecond ?? 0))
        ? r
        : acc,
    null,
  );

  return (
    <div className="space-y-3">
      {/* Metric-family legend — makes the latency column's meaning explicit so
          a native chunk-gap number is never mistaken for vLLM TPOT. */}
      {fam.note ? (
        <div
          className={cn(
            "rounded-md border px-3 py-2 text-xs",
            fam.primaryIsChunkGap || fam.showBoth
              ? "border-amber-500/30 bg-amber-500/5 text-amber-200/90"
              : "border-border bg-card/40 text-muted-foreground",
          )}
        >
          <span className="font-medium uppercase tracking-wide">
            Latency metric: {fam.primary === "chunkGap" ? fam.chunkGapLabel : fam.tpotLabel}
          </span>
          {" — "}
          {fam.note}
        </div>
      ) : null}

      {/* Headline callouts: single-stream + best overall + max valid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-md border border-border bg-card/40 px-4 py-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Single-stream tok/s
          </div>
          {singleStream ? (
            <>
              <div className="mt-1 text-3xl font-mono tabular-nums">
                {singleStream.metric.outputTokensPerSecond?.toFixed(1) ?? "—"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground font-mono">
                c=1 · TTFT p95 {singleStream.metric.p95TtftMs?.toFixed(0) ?? "—"} ms
              </div>
            </>
          ) : (
            <div className="mt-1 text-lg text-muted-foreground">
              not measured
            </div>
          )}
        </div>

        <div className="rounded-md border border-border bg-card/40 px-4 py-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Best overall tok/s
          </div>
          {bestOverall ? (
            <>
              <div className="mt-1 text-3xl font-mono tabular-nums">
                {bestOverall.metric.outputTokensPerSecond?.toFixed(1) ?? "—"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground font-mono">
                @ c={bestOverall.metric.concurrency} · TTFT p95{" "}
                {bestOverall.metric.p95TtftMs?.toFixed(0) ?? "—"} ms · valid
              </div>
              {peakObserved &&
              peakObserved.metric.concurrency !==
                bestOverall.metric.concurrency ? (
                <div className="mt-0.5 text-xs text-amber-400/80 font-mono">
                  peak observed {peakObserved.metric.outputTokensPerSecond?.toFixed(1)} @ c=
                  {peakObserved.metric.concurrency} but SLA-invalid
                </div>
              ) : null}
            </>
          ) : (
            <div className="mt-1 text-lg text-amber-300">
              No valid level
            </div>
          )}
        </div>

        <div className="rounded-md border border-border bg-card/40 px-4 py-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Max valid concurrency
          </div>
          {maxValid ? (
          <>
            <div className="mt-1 text-3xl font-mono tabular-nums">
              {maxValid.metric.concurrency}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              <span className="font-mono">
                {maxValid.metric.outputTokensPerSecond?.toFixed(1) ?? "—"} tok/s
              </span>
              {" · "}
              <span className="font-mono">
                TTFT p95 {maxValid.metric.p95TtftMs?.toFixed(0) ?? "—"} ms
              </span>
              {" · "}
              <span className="font-mono">
                {slaLabel} {slaValue(maxValid.metric)?.toFixed(1) ?? "—"} ms
              </span>
              {" — under TTFT ≤ "}
              <span className="font-mono">{ttftSla ?? "∞"}</span>
              {" ms · TPOT ≤ "}
              <span className="font-mono">{tpotSla ?? "∞"}</span>
              {" ms · failure ≤ "}
              <span className="font-mono">{(failureCeil * 100).toFixed(0)}%</span>
            </div>
          </>
        ) : (
            <div className="mt-1 text-lg text-amber-300">
              No level satisfied all SLAs
            </div>
          )}
        </div>
      </div>

      {/* Per-level validity table */}
      <div className="rounded-md border border-border overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs uppercase text-muted-foreground">
                Streams
              </TableHead>
              <TableHead className="text-right text-xs uppercase text-muted-foreground">
                Output tok/s
              </TableHead>
              <TableHead className="text-right text-xs uppercase text-muted-foreground">
                TTFT p95
              </TableHead>
              <TableHead
                className="text-right text-xs uppercase text-muted-foreground"
                title={fam.note ?? undefined}
              >
                {fam.primary === "chunkGap" ? "Chunk-gap p95" : "TPOT p95"}
              </TableHead>
              {fam.showBoth ? (
                <TableHead
                  className="text-right text-xs uppercase text-muted-foreground"
                  title="Mean chunk-gap latency — NOT token-normalized; not comparable to vLLM TPOT."
                >
                  Chunk-gap p95
                </TableHead>
              ) : null}
              <TableHead className="text-right text-xs uppercase text-muted-foreground">
                Failure
              </TableHead>
              <TableHead className="text-right text-xs uppercase text-muted-foreground">
                Status
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.metric.id}
                className={cn(
                  r.metric.concurrency === maxValid?.metric.concurrency &&
                    "bg-emerald-500/5",
                )}
              >
                <TableCell className="font-mono text-sm">
                  {r.metric.concurrency === maxValid?.metric.concurrency ? (
                    <span className="inline-flex items-center gap-1">
                      <Crown className="size-3 text-emerald-400" />
                      {r.metric.concurrency}
                    </span>
                  ) : (
                    r.metric.concurrency
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <MetricValue value={r.metric.outputTokensPerSecond} />
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right",
                    !r.meetsTtft && "text-red-300",
                  )}
                >
                  <MetricValue
                    value={r.metric.p95TtftMs}
                    unit=" ms"
                    precision={0}
                  />
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right",
                    !r.meetsTpot && "text-red-300",
                  )}
                >
                  <MetricValue value={slaValue(r.metric)} unit=" ms" />
                </TableCell>
                {fam.showBoth ? (
                  <TableCell className="text-right text-muted-foreground">
                    <MetricValue value={r.metric.p95ChunkGapMs} unit=" ms" />
                  </TableCell>
                ) : null}
                <TableCell
                  className={cn(
                    "text-right",
                    !r.meetsFailure && "text-red-300",
                  )}
                >
                  <MetricValue
                    value={
                      r.metric.failureRate != null
                        ? `${(r.metric.failureRate * 100).toFixed(1)}%`
                        : null
                    }
                  />
                </TableCell>
                <TableCell className="text-right">
                  {r.valid ? (
                    <span className="inline-flex items-center gap-1 text-emerald-300 text-xs font-medium uppercase tracking-wide">
                      <Check className="size-3" />
                      valid
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-red-300 text-xs font-medium uppercase tracking-wide">
                      <X className="size-3" />
                      invalid
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {invalid.length > 0 ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-1.5">
          <div className="text-xs uppercase tracking-wider text-amber-300/80">
            Invalid stream levels
          </div>
          <ul className="space-y-0.5 text-sm">
            {invalid.map((r) => (
              <li
                key={r.metric.id}
                className="flex items-baseline gap-2"
              >
                <span className="font-mono text-amber-300/90">
                  {r.metric.concurrency}
                </span>
                <span className="text-muted-foreground">
                  {r.reasons.join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
