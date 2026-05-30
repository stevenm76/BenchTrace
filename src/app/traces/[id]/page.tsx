import { notFound } from "next/navigation";

import { MetricValue } from "@/components/common/MetricValue";
import { ArtifactViewer } from "@/components/traces/ArtifactViewer";
import { CommandBlock } from "@/components/traces/CommandBlock";
import {
  DataRow,
  MetricSection,
  StatCard,
} from "@/components/traces/MetricSection";
import {
  MissingFieldsPanel,
  type MissingField,
} from "@/components/traces/MissingFieldsPanel";
import { ProfileBanner } from "@/components/traces/ProfileBanner";
import { ServeSweepPanel } from "@/components/traces/ServeSweepPanel";
import { TraceDetailHero } from "@/components/traces/TraceDetailHero";
import { ShareModal } from "@/components/share/ShareModal";
import { buildShareCardData } from "@/lib/share/card-data";
import { buildReproJson } from "@/lib/export/repro-json";
import { buildMarkdown } from "@/lib/export/markdown";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getTraceById, type TraceDetail } from "@/lib/db/queries/traces";
import { metricFamilyView, type MetricMode } from "@/lib/metric-family";
import { cn } from "@/lib/utils";
import { readTier, tierAtLeast } from "@/lib/tier/cookie";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TraceDetailPage({ params }: PageProps) {
  const { id } = await params;
  const trace = await getTraceById(id);
  if (!trace) notFound();

  const tier = await readTier();
  const showIntermediate = tierAtLeast(tier, "intermediate");
  const showExpert = tierAtLeast(tier, "expert");

  const best = bestPoint(trace);
  const highConcurrency = highestConcurrencyPoint(trace);
  const missing = computeMissingFields(trace);
  const shareCard = buildShareCardData(trace);
  const repro = buildReproJson(trace, { redact: true });
  const md = buildMarkdown(trace, { redact: true });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <TraceDetailHero
        trace={trace}
        shareAction={
          <ShareModal
            traceId={trace.id}
            traceName={trace.name}
            card={shareCard}
            rawJson={repro.json}
            rawJsonRedactions={repro.redactionTotals}
            rawMarkdown={md.markdown}
            rawMarkdownRedactions={md.redactionTotals}
          />
        }
      />

      <ProfileBanner trace={trace} />

      {showExpert ? <MissingFieldsPanel fields={missing} /> : null}

      {/* ─── Summary ─── */}
      {showIntermediate ? (
      <MetricSection title="Summary">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            label="Single-stream tok/s"
            hint={singleStreamPoint(trace) ? "c=1" : "no c=1 measurement"}
          >
            <MetricValue
              value={singleStreamPoint(trace)?.outputTokensPerSecond ?? null}
              precision={1}
            />
          </StatCard>
          <StatCard
            label="Best overall tok/s"
            hint={best?.concurrency ? `@ c=${best.concurrency}` : undefined}
          >
            <MetricValue
              value={best?.outputTokensPerSecond ?? null}
              precision={1}
            />
          </StatCard>
          <StatCard label="TTFT p95">
            <MetricValue
              value={best?.p95TtftMs ?? null}
              unit=" ms"
              precision={0}
            />
          </StatCard>
          <StatCard
            label={
              metricFamilyView(trace.metricMode as MetricMode).primary ===
              "chunkGap"
                ? "Chunk-gap p95"
                : "TPOT p95"
            }
            hint={
              metricFamilyView(trace.metricMode as MetricMode)
                .primaryIsChunkGap
                ? "not token-normalized"
                : undefined
            }
          >
            <MetricValue
              value={
                metricFamilyView(trace.metricMode as MetricMode).primary ===
                "chunkGap"
                  ? best?.p95ChunkGapMs ?? null
                  : best?.p95TpotMs ?? null
              }
              unit=" ms"
              precision={1}
            />
          </StatCard>
          <StatCard label="Max concurrency">
            <MetricValue
              value={
                highConcurrency?.concurrency ?? best?.concurrency ?? null
              }
              precision={0}
            />
          </StatCard>
          <StatCard label="Peak VRAM">
            <MetricValue value={peak(trace, (p) => p.peakVramGb)} unit=" GB" />
          </StatCard>
        </div>
      </MetricSection>
      ) : null}

      {/* ─── BT-SERVE-001 native sweep panel (Basic+, kept intact) ─── */}
      {trace.benchmarkProfile?.profileId === "BT-SERVE-001" ? (
        <MetricSection
          title="Serve sweep"
          description="Per-stream-level validity against the workload SLAs. Native to BT-SERVE-001."
        >
          <ServeSweepPanel trace={trace} />
        </MetricSection>
      ) : null}

      {showIntermediate ? (
        <>
      {/* ─── Performance ─── */}
      <MetricSection
        title="Performance"
        description="One row per measured concurrency / request-rate point."
      >
        <PerformanceTable trace={trace} />
      </MetricSection>

      {/* ─── Latency ─── */}
      <MetricSection
        title="Latency"
        description={
          highConcurrency
            ? `Percentile breakdown at concurrency=${highConcurrency.concurrency}.`
            : "Percentile breakdown."
        }
      >
        <LatencyTable
          point={highConcurrency ?? best}
          mode={trace.metricMode as MetricMode}
        />
      </MetricSection>

      {/* ─── Throughput ─── */}
      <MetricSection title="Throughput">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Output tok/s">
            <MetricValue value={best?.outputTokensPerSecond ?? null} />
          </StatCard>
          <StatCard label="Total tok/s">
            <MetricValue value={best?.totalTokensPerSecond ?? null} />
          </StatCard>
          <StatCard label="Prefill tok/s">
            <MetricValue value={best?.prefillTokensPerSecond ?? null} />
          </StatCard>
          <StatCard label="Requests/sec">
            <MetricValue
              value={best?.requestsPerSecond ?? null}
              precision={2}
            />
          </StatCard>
        </div>
      </MetricSection>

      {/* ─── Memory / VRAM ─── */}
      <MetricSection title="Memory / VRAM">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Peak VRAM">
            <MetricValue value={peak(trace, (p) => p.peakVramGb)} unit=" GB" />
          </StatCard>
          <StatCard label="Average VRAM">
            <MetricValue value={avg(trace, (p) => p.averageVramGb)} unit=" GB" />
          </StatCard>
          <StatCard label="GPU util (avg)">
            <MetricValue value={avg(trace, (p) => p.gpuUtilizationAvg)} unit="%" />
          </StatCard>
          <StatCard label="GPU util (peak)">
            <MetricValue value={peak(trace, (p) => p.gpuUtilizationPeak)} unit="%" />
          </StatCard>
          <StatCard label="Peak RAM">
            <MetricValue value={peak(trace, (p) => p.peakRamGb)} unit=" GB" />
          </StatCard>
          <StatCard label="CPU util (avg)">
            <MetricValue value={avg(trace, (p) => p.cpuUtilizationAvg)} unit="%" />
          </StatCard>
        </div>
      </MetricSection>

      {/* ─── Power / Thermals ─── */}
      <MetricSection title="Power / Thermals">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Power (avg)">
            <MetricValue value={avg(trace, (p) => p.powerDrawWattsAvg)} unit=" W" />
          </StatCard>
          <StatCard label="Power (peak)">
            <MetricValue value={peak(trace, (p) => p.powerDrawWattsPeak)} unit=" W" />
          </StatCard>
          <StatCard label="GPU temp (avg)">
            <MetricValue
              value={avg(trace, (p) => p.gpuTemperatureAvg)}
              unit="°C"
              precision={0}
            />
          </StatCard>
          <StatCard label="GPU temp (peak)">
            <MetricValue
              value={peak(trace, (p) => p.gpuTemperaturePeak)}
              unit="°C"
              precision={0}
            />
          </StatCard>
          <StatCard label="Tokens/Watt">
            <MetricValue value={peak(trace, (p) => p.tokensPerWatt)} precision={2} />
          </StatCard>
          <StatCard label="Cost / 1M gen">
            <MetricValue
              value={best?.costPer1mGeneratedTokens ?? null}
              unit=" USD"
              precision={2}
            />
          </StatCard>
        </div>
      </MetricSection>

      {/* ─── Hardware ─── */}
      <MetricSection title="Hardware">
        <HardwarePanel trace={trace} />
      </MetricSection>

      {/* ─── Model ─── */}
      <MetricSection title="Model">
        <ModelPanel trace={trace} />
      </MetricSection>

      {/* ─── Loader / Runtime ─── */}
      <MetricSection title="Loader / Runtime">
        <LoaderPanel trace={trace} />
      </MetricSection>

      {/* ─── Benchmark Workload ─── */}
      <MetricSection title="Benchmark Workload">
        <BenchmarkPanel trace={trace} />
      </MetricSection>

        </>
      ) : null}

      {showExpert ? (
        <>
      {/* ─── Commands ─── */}
      <MetricSection title="Commands">
        <div className="space-y-2">
          <CommandBlock
            title="Launch command"
            command={trace.loaderConfig?.launchCommand}
          />
          <CommandBlock
            title="Benchmark command"
            command={trace.benchmarkProfile?.command}
          />
        </div>
      </MetricSection>

      {/* ─── Artifacts ─── */}
      <MetricSection title="Artifacts">
        <ArtifactViewer artifacts={trace.artifacts} />
      </MetricSection>
        </>
      ) : null}

      {showIntermediate ? (
        <>
      {/* ─── Verification ─── */}
      <MetricSection title="Verification">
        <VerificationPanel trace={trace} missing={missing} />
      </MetricSection>

      {/* ─── Comparability ─── */}
      <MetricSection
        title="Comparability"
        description="Fingerprint covers model + engine + quantization + context length + GPU layout + benchmark profile."
      >
        <ComparabilityPanel trace={trace} />
      </MetricSection>

      {/* ─── Share / Export ─── */}
      <MetricSection title="Share / Export">
        <div className="rounded-md border border-border bg-card/40 px-4 py-4 text-sm flex items-center justify-between">
          <span className="text-muted-foreground">
            Card · Markdown · Repro JSON (benchtrace.share.v1) · Evidence
            bundle — all available from the Share button in the header.
          </span>
          <ShareModal
            traceId={trace.id}
            traceName={trace.name}
            card={shareCard}
            rawJson={repro.json}
            rawJsonRedactions={repro.redactionTotals}
            rawMarkdown={md.markdown}
            rawMarkdownRedactions={md.redactionTotals}
          />
        </div>
      </MetricSection>
        </>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function singleStreamPoint(trace: TraceDetail) {
  return trace.metricPoints.find((m) => m.concurrency === 1) ?? null;
}

function bestPoint(trace: TraceDetail) {
  if (trace.metricPoints.length === 0) return null;
  return trace.metricPoints.reduce((b, m) =>
    (m.outputTokensPerSecond ?? -Infinity) >
    (b.outputTokensPerSecond ?? -Infinity)
      ? m
      : b,
  );
}

function highestConcurrencyPoint(trace: TraceDetail) {
  if (trace.metricPoints.length === 0) return null;
  return trace.metricPoints.reduce((b, m) =>
    (m.concurrency ?? -Infinity) > (b.concurrency ?? -Infinity) ? m : b,
  );
}

type MetricPoint = TraceDetail["metricPoints"][number];

function peak(
  trace: TraceDetail,
  getter: (p: MetricPoint) => number | null | undefined,
): number | null {
  const values = trace.metricPoints
    .map(getter)
    .filter((v): v is number => typeof v === "number");
  if (values.length === 0) return null;
  return Math.max(...values);
}

function avg(
  trace: TraceDetail,
  getter: (p: MetricPoint) => number | null | undefined,
): number | null {
  const values = trace.metricPoints
    .map(getter)
    .filter((v): v is number => typeof v === "number");
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function computeMissingFields(trace: TraceDetail): MissingField[] {
  const out: MissingField[] = [];

  if (!trace.loaderConfig?.launchCommand) {
    out.push({
      label: "launch_command",
      reason: "Without the exact engine launch command, the run cannot be reproduced.",
      severity: "critical",
    });
  }
  if (!trace.benchmarkProfile?.command) {
    out.push({
      label: "benchmark_command",
      reason: "Workload command needed to repeat the measurement.",
      severity: "critical",
    });
  }
  if (!trace.engine.version) {
    out.push({
      label: "engine_version",
      reason: "Engine version critically affects performance comparison.",
      severity: "critical",
    });
  }
  if (!trace.hardwareProfile.cudaVersion && !trace.hardwareProfile.rocmVersion) {
    out.push({
      label: "cuda_or_rocm_version",
      reason: "Driver/runtime stack identification.",
      severity: "critical",
    });
  }
  if (!trace.hardwareProfile.gpuModels?.length) {
    out.push({
      label: "gpu_models",
      reason: "GPU identity is the most important hardware variable.",
      severity: "critical",
    });
  }
  if (!trace.artifacts.some((a) => a.parserStatus === "parsed")) {
    out.push({
      label: "raw_artifact",
      reason:
        "No parsed raw benchmark artifact attached — verification stays weak.",
      severity: "critical",
    });
  }

  // Advisory
  if (trace.metricPoints.every((m) => m.powerDrawWattsAvg == null)) {
    out.push({
      label: "power_draw",
      reason: "Not captured by the source tool.",
      severity: "advisory",
    });
  }
  if (trace.metricPoints.every((m) => m.gpuTemperatureAvg == null)) {
    out.push({
      label: "gpu_temperature",
      reason: "Not captured by the source tool.",
      severity: "advisory",
    });
  }
  if (trace.metricPoints.every((m) => m.tokensPerWatt == null)) {
    out.push({
      label: "tokens_per_watt",
      reason: "Requires power draw to derive.",
      severity: "advisory",
    });
  }
  if (!trace.costProfile) {
    out.push({
      label: "cost_profile",
      reason: "Cost estimates not configured.",
      severity: "advisory",
    });
  }
  if (!trace.hardwareProfile.gpuPcieGeneration) {
    out.push({
      label: "pcie_layout",
      reason: "PCIe generation/width can affect multi-GPU throughput.",
      severity: "advisory",
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────
// Panels
// ─────────────────────────────────────────────────────────────

function PerformanceTable({ trace }: { trace: TraceDetail }) {
  if (trace.metricPoints.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No metric points recorded.
      </div>
    );
  }
  const sorted = trace.metricPoints
    .slice()
    .sort((a, b) => (a.concurrency ?? 0) - (b.concurrency ?? 0));
  const fam = metricFamilyView(trace.metricMode as MetricMode);
  const latColLabel = fam.primary === "chunkGap" ? "Chunk-gap p95" : "TPOT p95";
  const latColValue = (m: (typeof sorted)[number]) =>
    fam.primary === "chunkGap" ? m.p95ChunkGapMs : m.p95TpotMs;
  return (
    <div className="rounded-md border border-border overflow-hidden bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-xs uppercase text-muted-foreground">
              Concurrency
            </TableHead>
            <TableHead className="text-right text-xs uppercase text-muted-foreground">
              Output tok/s
            </TableHead>
            <TableHead className="text-right text-xs uppercase text-muted-foreground">
              Total tok/s
            </TableHead>
            <TableHead className="text-right text-xs uppercase text-muted-foreground">
              TTFT p95
            </TableHead>
            <TableHead
              className="text-right text-xs uppercase text-muted-foreground"
              title={fam.note ?? undefined}
            >
              {latColLabel}
            </TableHead>
            <TableHead className="text-right text-xs uppercase text-muted-foreground">
              Peak VRAM
            </TableHead>
            <TableHead className="text-right text-xs uppercase text-muted-foreground">
              Failures
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="font-mono text-xs">
                <MetricValue value={m.concurrency} precision={0} />
              </TableCell>
              <TableCell className="text-right">
                <MetricValue value={m.outputTokensPerSecond} />
              </TableCell>
              <TableCell className="text-right">
                <MetricValue value={m.totalTokensPerSecond} />
              </TableCell>
              <TableCell className="text-right">
                <MetricValue value={m.p95TtftMs} unit=" ms" precision={0} />
              </TableCell>
              <TableCell className="text-right">
                <MetricValue value={latColValue(m)} unit=" ms" />
              </TableCell>
              <TableCell className="text-right">
                <MetricValue value={m.peakVramGb} unit=" GB" />
              </TableCell>
              <TableCell className="text-right">
                <MetricValue
                  value={
                    m.failureRate != null
                      ? `${(m.failureRate * 100).toFixed(2)}%`
                      : null
                  }
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function LatencyTable({
  point,
  mode,
}: {
  point: TraceDetail["metricPoints"][number] | null;
  mode: MetricMode;
}) {
  if (!point) {
    return (
      <div className="text-sm text-muted-foreground">
        No latency measurements.
      </div>
    );
  }
  const fam = metricFamilyView(mode);
  const hasChunkGap = point.p50ChunkGapMs != null || point.p95ChunkGapMs != null;
  const showTpot = fam.primary === "tpot" || fam.showBoth;
  const showChunkGap = (fam.primary === "chunkGap" || fam.showBoth) && hasChunkGap;
  // Build the latency rows. TTFT always first; then the per-token family/families,
  // labeled so chunk-gap is never silently presented as token-normalized TPOT.
  const latencyRows: ReadonlyArray<
    readonly [
      string,
      "p50TtftMs" | "p50TpotMs" | "p50ChunkGapMs" | "p50ItlMs" | "p50E2eLatencyMs",
      "p95TtftMs" | "p95TpotMs" | "p95ChunkGapMs" | "p95ItlMs" | "p95E2eLatencyMs",
      "p99TtftMs" | "p99TpotMs" | "p99ChunkGapMs" | "p99ItlMs" | "p99E2eLatencyMs",
    ]
  > = [
    ["TTFT", "p50TtftMs", "p95TtftMs", "p99TtftMs"],
    ...(showTpot
      ? ([[fam.tpotLabel, "p50TpotMs", "p95TpotMs", "p99TpotMs"]] as const)
      : []),
    ...(showChunkGap
      ? ([
          [fam.chunkGapLabel, "p50ChunkGapMs", "p95ChunkGapMs", "p99ChunkGapMs"],
        ] as const)
      : []),
    ["ITL", "p50ItlMs", "p95ItlMs", "p99ItlMs"],
    ["End-to-end", "p50E2eLatencyMs", "p95E2eLatencyMs", "p99E2eLatencyMs"],
  ];
  return (
    <div className="space-y-2">
      {fam.note ? (
        <p
          className={cn(
            "text-xs",
            fam.primaryIsChunkGap || fam.showBoth
              ? "text-amber-200/90"
              : "text-muted-foreground",
          )}
        >
          {fam.note}
        </p>
      ) : null}
    <div className="rounded-md border border-border overflow-hidden bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-xs uppercase text-muted-foreground">
              Metric
            </TableHead>
            <TableHead className="text-right text-xs uppercase text-muted-foreground">
              p50
            </TableHead>
            <TableHead className="text-right text-xs uppercase text-muted-foreground">
              p95
            </TableHead>
            <TableHead className="text-right text-xs uppercase text-muted-foreground">
              p99
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {latencyRows.map(([label, p50Key, p95Key, p99Key]) => (
            <TableRow key={label}>
              <TableCell className="text-sm">{label}</TableCell>
              <TableCell className="text-right">
                <MetricValue value={point[p50Key]} unit=" ms" />
              </TableCell>
              <TableCell className="text-right">
                <MetricValue value={point[p95Key]} unit=" ms" />
              </TableCell>
              <TableCell className="text-right">
                <MetricValue value={point[p99Key]} unit=" ms" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
    </div>
  );
}

function HardwarePanel({ trace }: { trace: TraceDetail }) {
  const hp = trace.hardwareProfile;
  return (
    <div className="rounded-md border border-border bg-card/40 px-4 py-3">
      <DataRow label="Profile">
        <MetricValue value={hp.name} mono={false} />
      </DataRow>
      <DataRow label="CPU">
        <MetricValue value={hp.cpu} mono={false} />
      </DataRow>
      <DataRow label="RAM">
        <MetricValue value={hp.ramGb} unit=" GB" precision={0} />
      </DataRow>
      <DataRow label="OS">
        <MetricValue value={hp.os} mono={false} />
      </DataRow>
      <DataRow label="Kernel">
        <MetricValue value={hp.kernel} />
      </DataRow>
      <DataRow label="Driver">
        <MetricValue value={hp.driverVersion} />
      </DataRow>
      <DataRow label="CUDA / ROCm">
        <MetricValue
          value={hp.cudaVersion ?? hp.rocmVersion}
        />
      </DataRow>
      <DataRow label="GPU count">
        <MetricValue value={hp.gpuCount} precision={0} />
      </DataRow>
      <DataRow label="Total VRAM">
        <MetricValue value={hp.gpuVramGb} unit=" GB" precision={0} />
      </DataRow>
      <DataRow label="PCIe">
        <MetricValue
          value={
            hp.gpuPcieGeneration
              ? `${hp.gpuPcieGeneration} · ${hp.gpuPcieWidth ?? "—"}`
              : null
          }
        />
      </DataRow>
      <DataRow label="Container">
        <MetricValue value={hp.containerImage ?? hp.containerRuntime} />
      </DataRow>

      {hp.gpuModels?.length ? (
        <div className="mt-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            GPUs
          </div>
          <div className="space-y-1">
            {hp.gpuModels.map((g, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-xs font-mono py-1 border-b border-border/40 last:border-0"
              >
                <span>{g.name}</span>
                <span className="text-muted-foreground">
                  {g.vramGb != null ? `${g.vramGb} GB · ` : ""}
                  {g.pcieGeneration ?? "—"} {g.pcieWidth ?? ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ModelPanel({ trace }: { trace: TraceDetail }) {
  const m = trace.model;
  return (
    <div className="rounded-md border border-border bg-card/40 px-4 py-3">
      <DataRow label="Name">
        <MetricValue value={m.name} mono={false} />
      </DataRow>
      <DataRow label="Provider">
        <MetricValue value={m.provider} />
      </DataRow>
      <DataRow label="Repo / Path">
        <MetricValue value={m.repoOrPath} />
      </DataRow>
      <DataRow label="Architecture">
        <MetricValue value={m.architecture} />
      </DataRow>
      <DataRow label="Dense / MoE">
        <MetricValue value={m.denseOrMoe} />
      </DataRow>
      <DataRow label="Parameters">
        <MetricValue
          value={
            m.parameterCount
              ? `${(m.parameterCount / 1e9).toFixed(1)}B`
              : null
          }
        />
      </DataRow>
      {m.denseOrMoe === "moe" ? (
        <DataRow label="Active params">
          <MetricValue
            value={
              m.activeParameterCount
                ? `${(m.activeParameterCount / 1e9).toFixed(1)}B`
                : null
            }
          />
        </DataRow>
      ) : null}
      <DataRow label="Quantization">
        <MetricValue value={m.quantization} />
      </DataRow>
      <DataRow label="Precision">
        <MetricValue value={m.precision} />
      </DataRow>
      <DataRow label="Format">
        <MetricValue value={m.format} />
      </DataRow>
      <DataRow label="Tokenizer">
        <MetricValue value={m.tokenizer} />
      </DataRow>
      <DataRow label="Claimed context">
        <MetricValue
          value={m.claimedContextLength}
          unit=" tokens"
          precision={0}
        />
      </DataRow>
      <DataRow label="License">
        <MetricValue value={m.license} />
      </DataRow>
      <DataRow label="Hash">
        <MetricValue value={m.modelHash} />
      </DataRow>
    </div>
  );
}

function LoaderPanel({ trace }: { trace: TraceDetail }) {
  const lc = trace.loaderConfig;
  if (!lc) {
    return (
      <div className="text-sm text-muted-foreground">
        No loader configuration captured.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-card/40 px-4 py-3">
      <DataRow label="Engine">
        <MetricValue
          value={`${trace.engine.name} ${trace.engine.version ?? ""}`.trim()}
        />
      </DataRow>
      <DataRow label="OpenAI-compatible">
        <MetricValue value={trace.engine.openAICompatible ? "yes" : "no"} />
      </DataRow>
      <DataRow label="TP / PP / DP">
        <MetricValue
          value={`${lc.tensorParallelSize ?? "—"} / ${lc.pipelineParallelSize ?? "—"} / ${lc.dataParallelSize ?? "—"}`}
        />
      </DataRow>
      <DataRow label="KV cache dtype">
        <MetricValue value={lc.kvCacheDtype} />
      </DataRow>
      <DataRow label="max_model_len">
        <MetricValue value={lc.maxModelLen} precision={0} />
      </DataRow>
      <DataRow label="gpu_memory_utilization">
        <MetricValue value={lc.gpuMemoryUtilization} precision={2} />
      </DataRow>
      <DataRow label="Flash attention">
        <MetricValue
          value={lc.flashAttention == null ? null : lc.flashAttention ? "on" : "off"}
        />
      </DataRow>
      <DataRow label="Chunked prefill">
        <MetricValue
          value={
            lc.chunkedPrefill == null ? null : lc.chunkedPrefill ? "on" : "off"
          }
        />
      </DataRow>
      <DataRow label="Prefix caching">
        <MetricValue
          value={
            lc.prefixCaching == null ? null : lc.prefixCaching ? "on" : "off"
          }
        />
      </DataRow>
      <DataRow label="Speculative decoding">
        <MetricValue
          value={
            lc.speculativeDecoding == null
              ? null
              : lc.speculativeDecoding
                ? "on"
                : "off"
          }
        />
      </DataRow>
      <DataRow label="Draft model">
        <MetricValue value={lc.draftModel} />
      </DataRow>
      <DataRow label="MTP">
        <MetricValue
          value={lc.mtpEnabled == null ? null : lc.mtpEnabled ? "on" : "off"}
        />
      </DataRow>
      <DataRow label="CPU offload">
        <MetricValue
          value={lc.cpuOffload == null ? null : lc.cpuOffload ? "on" : "off"}
        />
      </DataRow>
      <DataRow label="GPU residency">
        <MetricValue value={lc.gpuResidency} />
      </DataRow>

      {lc.environmentVariables &&
      Object.keys(lc.environmentVariables).length > 0 ? (
        <div className="mt-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Environment
          </div>
          <div className="space-y-1">
            {Object.entries(lc.environmentVariables).map(([k, v]) => (
              <div
                key={k}
                className="flex items-baseline justify-between text-xs font-mono py-1 border-b border-border/40 last:border-0 gap-3"
              >
                <span className="text-muted-foreground">{k}</span>
                <span className="text-right truncate">{v}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BenchmarkPanel({ trace }: { trace: TraceDetail }) {
  const bp = trace.benchmarkProfile;
  if (!bp) {
    return (
      <div className="text-sm text-muted-foreground">
        No benchmark workload captured.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-card/40 px-4 py-3">
      <DataRow label="Profile">
        <MetricValue value={bp.profileId} />
      </DataRow>
      <DataRow label="Tool">
        <MetricValue value={`${bp.tool ?? "—"} ${bp.toolVersion ?? ""}`} />
      </DataRow>
      <DataRow label="Workload type">
        <MetricValue value={bp.workloadType} />
      </DataRow>
      <DataRow label="Dataset">
        <MetricValue value={bp.dataset} />
      </DataRow>
      <DataRow label="Input length">
        <MetricValue value={bp.inputLength} precision={0} />
      </DataRow>
      <DataRow label="Output length">
        <MetricValue value={bp.outputLength} precision={0} />
      </DataRow>
      <DataRow label="Num prompts">
        <MetricValue value={bp.numPrompts} precision={0} />
      </DataRow>
      <DataRow label="Concurrency / strategy">
        <MetricValue
          value={
            bp.concurrencyStrategy
              ? `${bp.concurrency ?? "—"} · ${bp.concurrencyStrategy}`
              : bp.concurrency
          }
        />
      </DataRow>
      <DataRow label="Request rate">
        <MetricValue
          value={bp.requestRate == null ? null : bp.requestRate}
          unit=" req/s"
        />
      </DataRow>
      <DataRow label="Streaming">
        <MetricValue
          value={
            bp.streamingEnabled == null
              ? null
              : bp.streamingEnabled
                ? "on"
                : "off"
          }
        />
      </DataRow>
      <DataRow label="Endpoint">
        <MetricValue value={bp.endpoint} />
      </DataRow>
      <DataRow label="Warmup runs">
        <MetricValue value={bp.warmupRuns} precision={0} />
      </DataRow>
      <DataRow label="Measurement duration">
        <MetricValue
          value={bp.measurementDurationSeconds}
          unit=" s"
          precision={1}
        />
      </DataRow>
      <DataRow label="Random seed">
        <MetricValue value={bp.randomSeed} precision={0} />
      </DataRow>
      <DataRow label="TTFT SLA / TPOT SLA">
        <MetricValue
          value={
            bp.ttftSlaMs != null || bp.tpotSlaMs != null
              ? `${bp.ttftSlaMs ?? "—"} / ${bp.tpotSlaMs ?? "—"} ms`
              : null
          }
        />
      </DataRow>
    </div>
  );
}

function VerificationPanel({
  trace,
  missing,
}: {
  trace: TraceDetail;
  missing: MissingField[];
}) {
  const checklist: { label: string; ok: boolean }[] = [
    {
      label: "Raw artifact attached",
      ok: trace.artifacts.length > 0,
    },
    {
      label: "Parsed benchmark artifact",
      ok: trace.artifacts.some((a) => a.parserStatus === "parsed"),
    },
    {
      label: "Artifact hashes present",
      ok: trace.artifacts.some((a) => !!a.sha256),
    },
    {
      label: "Launch command",
      ok: !!trace.loaderConfig?.launchCommand,
    },
    {
      label: "Benchmark command",
      ok: !!trace.benchmarkProfile?.command,
    },
    {
      label: "Engine version",
      ok: !!trace.engine.version,
    },
    {
      label: "GPU + driver identification",
      ok:
        (trace.hardwareProfile.gpuModels?.length ?? 0) > 0 &&
        !!(
          trace.hardwareProfile.cudaVersion ??
          trace.hardwareProfile.rocmVersion
        ),
    },
    {
      label: "At least one metric point",
      ok: trace.metricPoints.length > 0,
    },
  ];

  return (
    <div className="rounded-md border border-border bg-card/40 px-4 py-3 space-y-3">
      <div className="text-sm text-muted-foreground">
        Stored verification level:{" "}
        <span className="font-medium text-foreground">
          {trace.verificationLevel}
        </span>
        . Stage 5 computes this automatically from the checklist below and
        suspicious-value detection.
      </div>
      <ul className="space-y-1.5">
        {checklist.map((c) => (
          <li
            key={c.label}
            className="flex items-center gap-2.5 text-sm py-1 border-b border-border/40 last:border-0"
          >
            <span
              className={
                c.ok
                  ? "size-2 rounded-full bg-emerald-400"
                  : "size-2 rounded-full bg-amber-400"
              }
              aria-hidden
            />
            <span className={c.ok ? "" : "text-muted-foreground"}>
              {c.label}
            </span>
          </li>
        ))}
      </ul>
      {missing.filter((f) => f.severity === "critical").length > 0 ? (
        <div className="text-xs text-amber-400/80">
          {missing.filter((f) => f.severity === "critical").length} critical
          field(s) absent — see the missing-fields panel above.
        </div>
      ) : null}
    </div>
  );
}

function ComparabilityPanel({ trace }: { trace: TraceDetail }) {
  const parts: { label: string; value: string | null }[] = [
    { label: "engine", value: trace.engine.type },
    { label: "engine_version", value: trace.engine.version },
    { label: "model", value: trace.model.name },
    { label: "quantization", value: trace.model.quantization },
    {
      label: "context_length",
      value: trace.contextLength?.toString() ?? null,
    },
    {
      label: "tensor_parallel_size",
      value: trace.loaderConfig?.tensorParallelSize?.toString() ?? null,
    },
    {
      label: "kv_cache_dtype",
      value: trace.loaderConfig?.kvCacheDtype ?? null,
    },
    {
      label: "benchmark_profile",
      value: trace.benchmarkProfile?.profileId ?? null,
    },
  ];
  return (
    <div className="rounded-md border border-border bg-card/40 px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Fingerprint parts
        </div>
        <Badge variant="outline" className="font-mono text-xs">
          {trace.fingerprint ?? "—"}
        </Badge>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
        {parts.map((p) => (
          <DataRow key={p.label} label={p.label}>
            <MetricValue value={p.value} />
          </DataRow>
        ))}
      </div>
    </div>
  );
}
