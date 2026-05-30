import type { TraceDetail } from "@/lib/db/queries/traces";
import type { VerificationLevel } from "@/lib/db/schema";

export interface ShareCardData {
  title: string;
  subtitle: string;
  modelLine: string;
  hardwareLine: string;
  workloadLine: string;
  results: { label: string; value: string }[];
  verification: VerificationLevel;
  fingerprint: string | null;
  warnings: string[];
}

export function buildShareCardData(trace: TraceDetail): ShareCardData {
  const points = trace.metricPoints;
  const pickMax = (f: (p: (typeof points)[number]) => number | null | undefined) => {
    const v = points.map(f).filter((x): x is number => typeof x === "number");
    return v.length ? Math.max(...v) : null;
  };
  const pickMin = (f: (p: (typeof points)[number]) => number | null | undefined) => {
    const v = points.map(f).filter((x): x is number => typeof x === "number");
    return v.length ? Math.min(...v) : null;
  };

  const gpus = trace.hardwareProfile.gpuModels ?? [];
  const gpuSummary =
    gpus.length > 0
      ? `${gpus.length}× ${gpus[0]?.name.replace(/^NVIDIA GeForce /, "") ?? ""}`
      : "—";

  const tps = pickMax((p) => p.outputTokensPerSecond);
  const ttft = pickMin((p) => p.p95TtftMs);
  const tpot = pickMin((p) => p.p95TpotMs);
  const concurrency = pickMax((p) => p.concurrency);
  const vram = pickMax((p) => p.peakVramGb);
  const tpw = pickMax((p) => p.tokensPerWatt);

  const results: { label: string; value: string }[] = [];
  if (tps != null) results.push({ label: "Output tok/s", value: tps.toFixed(1) });
  if (ttft != null)
    results.push({ label: "TTFT p95", value: `${ttft.toFixed(0)} ms` });
  if (tpot != null)
    results.push({ label: "TPOT p95", value: `${tpot.toFixed(1)} ms` });
  if (concurrency != null)
    results.push({ label: "Max conc.", value: String(concurrency) });
  if (vram != null)
    results.push({ label: "Peak VRAM", value: `${vram.toFixed(1)} GB` });
  if (tpw != null)
    results.push({ label: "Tok/Watt", value: tpw.toFixed(2) });

  const warnings: string[] = [];
  if (
    !trace.loaderConfig?.launchCommand ||
    !trace.benchmarkProfile?.command
  ) {
    warnings.push("launch or benchmark command missing");
  }
  if (!trace.artifacts.some((a) => a.parserStatus === "parsed")) {
    warnings.push("no parsed raw artifact");
  }

  return {
    title: `${trace.model.name}${trace.model.quantization ? ` · ${trace.model.quantization}` : ""}`,
    subtitle: [
      trace.engine.name + (trace.engine.version ? ` ${trace.engine.version}` : ""),
      trace.loaderConfig?.tensorParallelSize &&
      trace.loaderConfig.tensorParallelSize > 1
        ? `TP=${trace.loaderConfig.tensorParallelSize}`
        : null,
      trace.loaderConfig?.kvCacheDtype
        ? `KV=${trace.loaderConfig.kvCacheDtype}`
        : null,
      trace.contextLength
        ? `${(trace.contextLength / 1024).toFixed(0)}k ctx`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
    modelLine: `${trace.model.architecture ?? "—"} · ${trace.model.format ?? "—"}`,
    hardwareLine: `${gpuSummary} · ${trace.hardwareProfile.cpu ?? "—"}`,
    workloadLine: trace.benchmarkProfile
      ? `${trace.benchmarkProfile.workloadType ?? "—"} · in ${trace.benchmarkProfile.inputLength ?? "—"} / out ${trace.benchmarkProfile.outputLength ?? "—"} · conc ${concurrency ?? "—"}`
      : "—",
    results,
    verification: trace.verificationLevel,
    fingerprint: trace.fingerprint,
    warnings,
  };
}
