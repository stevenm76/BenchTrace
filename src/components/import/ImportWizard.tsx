"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  FileCheck2,
  Loader2,
  Terminal,
  Upload,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AdapterGuidanceCard } from "@/components/import/AdapterGuidanceCard";
import { BundleUploader } from "@/components/import/BundleUploader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  roleLabel,
  type BundleFile,
  type BundleFileRole,
} from "@/lib/import/bundle";

interface AdapterOption {
  id: string;
  displayName: string;
  description: string;
  unavailable: string[];
  /** Bundle is a UI-only mode, not a real BenchmarkAdapter. */
  isBundle?: boolean;
}

interface ImportWizardProps {
  adapters: AdapterOption[];
}

interface SinglePreview {
  kind: "single";
  ok: boolean;
  error?: string;
  adapterId?: string;
  adapterName?: string;
  parserStatus?: "parsed" | "partially_parsed" | "failed" | "manual";
  parserConfidence?: number;
  warnings?: string[];
  unavailableFields?: string[];
  preview?: {
    traceName: string;
    modelName: string | null | undefined;
    modelQuantization: string | null | undefined;
    engineName: string | null | undefined;
    engineVersion: string | null | undefined;
    contextLength: number | null | undefined;
    metricPointCount: number;
    outputTokensPerSecond: number | null | undefined;
    p95TtftMs: number | null | undefined;
  };
}

interface BundlePreview {
  kind: "bundle";
  ok: boolean;
  error?: string;
  adapterId?: string | null;
  parserStatus?: "parsed" | "partially_parsed" | "failed" | "manual" | null;
  parserConfidence?: number | null;
  classified?: {
    filename: string;
    role: BundleFileRole;
    sha256: string;
    size: number;
  }[];
  launchCommandPresent?: boolean;
  benchmarkCommandPresent?: boolean;
  hardwareDetected?: {
    driverVersion: string | null;
    cudaVersion: string | null;
    gpuCount: number;
    firstGpuName: string | null;
  } | null;
  metricPointCount?: number;
  outputTokensPerSecond?: number | null;
  p95TtftMs?: number | null;
  notesPresent?: boolean;
  missingExpected?: { role: BundleFileRole; reason: string }[];
  warnings?: string[];
}

type Preview = SinglePreview | BundlePreview;

export function ImportWizard({ adapters }: ImportWizardProps) {
  const router = useRouter();
  const [adapterId, setAdapterId] = useState<string>("auto");
  const [rawText, setRawText] = useState<string>("");
  const [bundleFiles, setBundleFiles] = useState<BundleFile[]>([]);
  const [traceName, setTraceName] = useState("");
  const [notes, setNotes] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");

  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  const isBundle = adapterId === "bundle";
  const canPreview = isBundle ? bundleFiles.length > 0 : !!rawText;

  async function onFile(file: File) {
    const text = await file.text();
    setRawText(text);
    setPreview(null);
  }

  async function runPreview() {
    setPreviewing(true);
    setPreview(null);
    try {
      const body = isBundle
        ? { action: "bundle_preview", files: bundleFiles }
        : {
            action: "preview",
            rawText,
            adapterId: adapterId === "auto" ? undefined : adapterId,
          };
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      const next: Preview = isBundle
        ? { kind: "bundle", ...json }
        : { kind: "single", ...json };
      setPreview(next);
      if (!traceName) {
        const proposed =
          next.kind === "single"
            ? next.preview?.traceName
            : proposeBundleName(next);
        if (proposed) setTraceName(proposed);
      }
    } catch (err) {
      toast.error("Preview failed");
      console.error(err);
    } finally {
      setPreviewing(false);
    }
  }

  async function commit() {
    if (!preview?.ok) return;
    setCommitting(true);
    try {
      const overrides = {
        traceName: traceName || undefined,
        notes: notes || undefined,
        tags: tagsRaw
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };
      const body =
        preview.kind === "bundle"
          ? { action: "bundle_commit", files: bundleFiles, overrides }
          : {
              action: "commit",
              adapterId: (preview as SinglePreview).adapterId,
              rawText,
              overrides,
            };
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "Import failed");
        return;
      }
      toast.success(`Imported as "${json.traceName}"`);
      router.push(`/traces/${json.traceId}`);
    } catch (err) {
      toast.error("Import failed");
      console.error(err);
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Step 1: Adapter */}
      <Step number={1} title="Choose source format">
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            <AdapterOptionCard
              id="auto"
              displayName="Auto-detect"
              description="Try every parser until one matches."
              unavailable={[]}
              selected={adapterId === "auto"}
              onSelect={() => {
                setAdapterId("auto");
                setPreview(null);
              }}
            />
            {adapters.map((a) => (
              <AdapterOptionCard
                key={a.id}
                {...a}
                selected={adapterId === a.id}
                onSelect={() => {
                  setAdapterId(a.id);
                  setPreview(null);
                }}
              />
            ))}
          </div>

          <AdapterGuidanceCard
            adapterId={adapterId}
            onLoadExample={(text) => {
              setRawText(text);
              setPreview(null);
              toast.success(
                "Example loaded — scroll to step 3 and click Parse.",
              );
            }}
            onSwitchToManual={() => {
              setAdapterId("manual");
              setPreview(null);
            }}
          />
        </div>
      </Step>

      {/* Step 2: Input */}
      <Step
        number={2}
        title={isBundle ? "Upload bundle files" : "Paste or upload raw output"}
      >
        {isBundle ? (
          <BundleUploader
            files={bundleFiles}
            onFilesChange={(files) => {
              setBundleFiles(files);
              setPreview(null);
            }}
          />
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="upload" className="cursor-pointer">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent">
                  <Upload className="size-3.5" />
                  Upload file
                </span>
                <input
                  id="upload"
                  type="file"
                  accept=".json,.txt,.log"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onFile(f);
                  }}
                  className="hidden"
                />
              </Label>
              <span className="text-xs text-muted-foreground">
                {rawText
                  ? `${rawText.length.toLocaleString()} chars loaded`
                  : "or paste below"}
              </span>
              {rawText ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 ml-auto text-xs"
                  onClick={() => {
                    setRawText("");
                    setPreview(null);
                  }}
                >
                  Clear
                </Button>
              ) : null}
            </div>
            <textarea
              value={rawText}
              onChange={(e) => {
                setRawText(e.target.value);
                setPreview(null);
              }}
              placeholder='Paste vLLM bench JSON, llama-bench JSON, or a previously exported benchtrace.share.v1 document…'
              className="w-full h-48 rounded-md border border-border bg-card/40 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}
      </Step>

      {/* Step 3: Preview */}
      <Step number={3} title="Parse preview">
        <div className="space-y-3">
          <Button
            onClick={runPreview}
            disabled={!canPreview || previewing}
            variant="outline"
          >
            {previewing ? (
              <>
                <Loader2 className="size-4 mr-1.5 animate-spin" />
                Parsing
              </>
            ) : (
              "Parse"
            )}
          </Button>
          {preview?.kind === "single" ? (
            <SinglePreviewPanel preview={preview} />
          ) : null}
          {preview?.kind === "bundle" ? (
            <BundlePreviewPanel preview={preview} />
          ) : null}
        </div>
      </Step>

      {preview?.ok ? (
        <Step number={4} title="Trace details (override)">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="name">Trace name</Label>
              <Input
                id="name"
                value={traceName}
                onChange={(e) => setTraceName(e.target.value)}
                placeholder={
                  preview.kind === "single"
                    ? (preview.preview?.traceName ?? "")
                    : proposeBundleName(preview)
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tags">Tags (comma-separated)</Label>
              <Input
                id="tags"
                value={tagsRaw}
                onChange={(e) => setTagsRaw(e.target.value)}
                placeholder={
                  preview.kind === "bundle"
                    ? "bundle, manual-capture"
                    : "vllm, nvfp4, comparison"
                }
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Why this run was interesting…"
                className="w-full h-20 rounded-md border border-border bg-card/40 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
        </Step>
      ) : null}

      {preview?.ok ? (
        <Step number={5} title="Commit">
          <Button onClick={commit} disabled={committing}>
            {committing ? (
              <>
                <Loader2 className="size-4 mr-1.5 animate-spin" />
                Importing
              </>
            ) : (
              "Import trace"
            )}
          </Button>
        </Step>
      ) : null}
    </div>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card/40 p-4">
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <span className="inline-flex items-center justify-center size-5 rounded-full bg-primary/20 text-primary text-xs font-mono">
          {number}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function AdapterOptionCard({
  id,
  displayName,
  description,
  selected,
  onSelect,
}: AdapterOption & { selected: boolean; onSelect: () => void }) {
  const isStub =
    id !== "auto" &&
    id !== "vllm" &&
    id !== "llamacpp" &&
    id !== "manual" &&
    id !== "bundle";
  const isBundle = id === "bundle";
  return (
    <button
      onClick={onSelect}
      className={
        "text-left rounded-md border px-3 py-2 transition-colors " +
        (selected
          ? "border-primary bg-primary/10"
          : "border-border bg-card/30 hover:bg-accent/40")
      }
    >
      <div className="text-sm font-medium">{displayName}</div>
      <div className="text-xs text-muted-foreground mt-0.5">
        {description}
      </div>
      {isStub ? (
        <Badge
          variant="outline"
          className="mt-1.5 text-[10px] border-amber-500/30 text-amber-300"
        >
          stub
        </Badge>
      ) : null}
      {isBundle ? (
        <Badge
          variant="outline"
          className="mt-1.5 text-[10px] border-emerald-500/40 text-emerald-300"
        >
          multi-file
        </Badge>
      ) : null}
    </button>
  );
}

function SinglePreviewPanel({ preview }: { preview: SinglePreview }) {
  if (!preview.ok || !preview.preview) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm flex items-start gap-2">
        <AlertTriangle className="size-4 text-red-300 shrink-0 mt-0.5" />
        <div>
          <div className="font-medium text-red-300">
            {preview.error ?? "Parse failed"}
          </div>
          {preview.warnings?.length ? (
            <ul className="mt-1 text-xs text-muted-foreground list-disc pl-4">
              {preview.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    );
  }
  const p = preview.preview;
  return (
    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm space-y-2">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-4 text-emerald-400" />
        <span className="font-medium">
          Parsed by <span className="font-mono">{preview.adapterName}</span> ·{" "}
          {preview.parserStatus} · confidence{" "}
          {((preview.parserConfidence ?? 0) * 100).toFixed(0)}%
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
        <KV label="Model" value={p.modelName} />
        <KV label="Quant" value={p.modelQuantization} />
        <KV
          label="Engine"
          value={[p.engineName, p.engineVersion].filter(Boolean).join(" ")}
        />
        <KV
          label="Context"
          value={p.contextLength?.toLocaleString() ?? null}
        />
        <KV
          label="Output tok/s"
          value={
            p.outputTokensPerSecond != null
              ? p.outputTokensPerSecond.toFixed(1)
              : null
          }
        />
        <KV
          label="TTFT p95"
          value={p.p95TtftMs != null ? `${p.p95TtftMs.toFixed(0)} ms` : null}
        />
        <KV label="Metric points" value={String(p.metricPointCount)} />
      </div>
      {preview.warnings?.length ? (
        <ul className="text-xs text-amber-300 list-disc pl-4">
          {preview.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
      {preview.unavailableFields?.length ? (
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">Not provided by this source:</span>{" "}
          <span className="font-mono">
            {preview.unavailableFields.join(", ")}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function BundlePreviewPanel({ preview }: { preview: BundlePreview }) {
  if (!preview.ok) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm flex items-start gap-2">
        <AlertTriangle className="size-4 text-red-300 shrink-0 mt-0.5" />
        <div className="font-medium text-red-300">
          {preview.error ?? "Bundle parse failed"}
        </div>
      </div>
    );
  }
  const status =
    preview.parserStatus ??
    (preview.benchmarkCommandPresent || preview.launchCommandPresent
      ? "manual"
      : "failed");
  return (
    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm space-y-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-4 text-emerald-400" />
        <span className="font-medium">
          Bundle classified · {preview.classified?.length ?? 0} files ·{" "}
          {status} · confidence{" "}
          {((preview.parserConfidence ?? 0) * 100).toFixed(0)}%
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <BundleSignal
          ok={preview.benchmarkCommandPresent ?? false}
          okText="Benchmark command captured"
          missText="No benchmark_command.txt"
          icon={Terminal}
        />
        <BundleSignal
          ok={preview.launchCommandPresent ?? false}
          okText="Launch command captured"
          missText="No launch_command.txt"
          icon={Terminal}
        />
        <BundleSignal
          ok={(preview.metricPointCount ?? 0) > 0}
          okText={`${preview.metricPointCount} metric point${(preview.metricPointCount ?? 0) === 1 ? "" : "s"} parsed`}
          missText="benchmark_result not parseable"
          icon={FileCheck2}
        />
        <BundleSignal
          ok={preview.hardwareDetected != null}
          okText={
            preview.hardwareDetected
              ? `Hardware: ${preview.hardwareDetected.firstGpuName ?? "—"} · driver ${preview.hardwareDetected.driverVersion ?? "—"} · CUDA ${preview.hardwareDetected.cudaVersion ?? "—"}`
              : "Hardware detected"
          }
          missText="No nvidia-smi / hardware_snapshot"
          icon={Cpu}
        />
      </div>

      {preview.classified && preview.classified.length > 0 ? (
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Files
          </div>
          <div className="text-xs font-mono space-y-0.5">
            {preview.classified.map((c) => (
              <div
                key={c.filename}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate">{c.filename}</span>
                <span className="text-muted-foreground shrink-0">
                  → {roleLabel(c.role)} · {c.sha256.slice(0, 8)}…
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {preview.missingExpected && preview.missingExpected.length > 0 ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 space-y-1">
          <div className="text-xs uppercase tracking-wider text-amber-300/80">
            Missing
          </div>
          <ul className="text-xs space-y-0.5">
            {preview.missingExpected.map((m) => (
              <li
                key={m.role}
                className="flex items-baseline gap-2 text-muted-foreground"
              >
                <XCircle className="size-3 text-amber-400/70 shrink-0" />
                <span>
                  <span className="font-mono text-amber-300/80">
                    {roleLabel(m.role)}
                  </span>{" "}
                  · {m.reason}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview.warnings && preview.warnings.length > 0 ? (
        <ul className="text-xs text-amber-300 list-disc pl-4">
          {preview.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function BundleSignal({
  ok,
  okText,
  missText,
  icon: Icon,
}: {
  ok: boolean;
  okText: string;
  missText: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />
      ) : (
        <XCircle className="size-3.5 text-amber-400/70 shrink-0" />
      )}
      <Icon className="size-3 text-muted-foreground shrink-0" />
      <span className={ok ? "" : "text-muted-foreground"}>
        {ok ? okText : missText}
      </span>
    </div>
  );
}

function KV({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border/30 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value ?? "—"}</span>
    </div>
  );
}

function proposeBundleName(p: BundlePreview): string {
  if (!p.classified) return "";
  const result = p.classified.find((c) => c.role === "benchmark_result");
  const gpu = p.hardwareDetected?.firstGpuName ?? "";
  if (!result) return gpu ? `Bundle on ${gpu}` : "Trace bundle";
  return `Bundle · ${result.filename.replace(/\.json$/i, "")}${gpu ? " · " + gpu : ""}`;
}
