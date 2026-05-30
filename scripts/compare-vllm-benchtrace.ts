#!/usr/bin/env -S npx tsx
/**
 * Compare a vLLM `result.json` (from `vllm bench serve --save-result`) to a
 * BenchTrace `benchtrace.share.v1.json`. Prints a metric-by-metric delta
 * table.
 *
 * Usage:
 *   tsx scripts/compare-vllm-benchtrace.ts <vllm.json> <bt.json> [--out report.md] [--allow-native]
 *
 * TPOT guardrail: vLLM reports a token-normalized TPOT. BenchTrace's *native*
 * metric family is a per-chunk-gap latency that is NOT token-normalized (with
 * speculative decoding / MTP it runs ~Nx higher because each SSE chunk carries
 * several tokens). Comparing the two is apples-to-oranges, so this tool
 * refuses to put a native chunk-gap number in the TPOT row unless you pass
 * `--allow-native` to acknowledge the mismatch. It always uses the
 * vLLM-compatible token-normalized TPOT when the share doc carries it.
 *
 * Exit code 0 always — this tool reports, it doesn't gate. Use the table
 * and the "TPOT comparison" verdict to decide whether to investigate further.
 */
import fs from "node:fs";
import path from "node:path";

import { computeEquivalence, type Verdict } from "@/lib/align/equivalence";

interface Row {
  metric: string;
  vllm: number | string | null;
  bt: number | string | null;
  unit?: string;
  /** Lower-is-better metrics (latency) flip the sign of the % delta. */
  lowerIsBetter?: boolean;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fmt(v: number | string | null, decimals = 2): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(decimals);
}

function pct(vllm: number | null, bt: number | null): string {
  if (vllm == null || bt == null || vllm === 0) return "—";
  const d = ((bt - vllm) / vllm) * 100;
  const sign = d > 0 ? "+" : "";
  return `${sign}${d.toFixed(1)}%`;
}

function loadJson(p: string): Record<string, unknown> {
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

interface BtResults {
  best_output_tokens_per_second?: number | null;
  best_total_tokens_per_second?: number | null;
  requests_per_second?: number | null;
  successful_requests?: number | null;
  p50_ttft_ms?: number | null;
  p95_ttft_ms?: number | null;
  p99_ttft_ms?: number | null;
  p50_tpot_ms?: number | null;
  p95_tpot_ms?: number | null;
  p99_tpot_ms?: number | null;
  p50_itl_ms?: number | null;
  p95_itl_ms?: number | null;
  p99_itl_ms?: number | null;
  p50_e2e_latency_ms?: number | null;
  p95_e2e_latency_ms?: number | null;
  p99_e2e_latency_ms?: number | null;
}

export type TpotVerdict = "valid" | "weak" | "invalid";

export interface TpotGuardrail {
  verdict: TpotVerdict;
  /** Whether to populate the TPOT rows with BenchTrace numbers at all. */
  compare: boolean;
  reason: string;
}

/**
 * Decide whether the BenchTrace TPOT column can be honestly compared to vLLM's
 * token-normalized TPOT. Keys off the share doc's metric_mode + comparison
 * validity rather than guessing from the numbers.
 */
export function tpotGuardrail(
  bt: Record<string, unknown>,
  allowNative: boolean,
): TpotGuardrail {
  const bench = (bt.benchmark ?? {}) as { metric_mode?: string | null };
  const cv = (bt.comparison_validity ?? {}) as {
    output_token_count_source?: string | null;
    same_metric_formula?: boolean | null;
  };
  const mode = bench.metric_mode ?? null;
  const source = cv.output_token_count_source ?? null;

  // Native-only headline: p*_tpot_ms may not carry a token-normalized value,
  // and the native metric family is chunk-gap, not TPOT. Refuse unless the
  // caller explicitly opts in.
  if (mode === "native") {
    if (!allowNative) {
      return {
        verdict: "invalid",
        compare: false,
        reason:
          "BenchTrace ran in native metric mode (chunk-gap latency, not token-normalized TPOT). " +
          "Pass --allow-native to compare anyway (apples-to-oranges).",
      };
    }
    return {
      verdict: "invalid",
      compare: true,
      reason:
        "--allow-native: comparing native chunk-gap latency against vLLM token-normalized TPOT. " +
        "These are different metrics; treat any delta as meaningless.",
    };
  }

  // vllm-compatible / both: the p*_tpot_ms fields carry the token-normalized
  // value. Strength depends on where the output token count came from.
  if (source === "server_usage") {
    return {
      verdict: "valid",
      compare: true,
      reason:
        "Token-normalized TPOT from server-reported output token counts — directly comparable to vLLM.",
    };
  }
  if (source === "estimated") {
    return {
      verdict: "weak",
      compare: true,
      reason:
        "Token-normalized TPOT, but output token counts were estimated (server usage missing). " +
        "Comparable in formula; treat magnitude as approximate.",
    };
  }
  return {
    verdict: "invalid",
    compare: allowNative,
    reason:
      "Output token count source is unknown — cannot verify the TPOT denominator. " +
      (allowNative ? "--allow-native: showing anyway." : "Pass --allow-native to show anyway."),
  };
}

function buildRows(
  vllm: Record<string, unknown>,
  bt: Record<string, unknown>,
  tpot: TpotGuardrail,
): Row[] {
  const r = (bt.results ?? {}) as BtResults;
  const bench = (bt.benchmark ?? {}) as { measurement_duration_seconds?: number | null };
  const btTpot = (p: number | null): number | string | null =>
    tpot.compare ? p : "n/a";

  // BenchTrace records p50 (median); vLLM records median + mean. Compare medians.
  return [
    { metric: "successful_requests", vllm: num(vllm.completed), bt: num(r.successful_requests) },
    { metric: "duration_s", vllm: num(vllm.duration), bt: num(bench.measurement_duration_seconds) },
    { metric: "total_input_tokens", vllm: num(vllm.total_input_tokens), bt: null },
    { metric: "total_output_tokens", vllm: num(vllm.total_output_tokens), bt: null },
    { metric: "request_throughput", vllm: num(vllm.request_throughput), bt: num(r.requests_per_second), unit: "req/s" },
    { metric: "output_throughput", vllm: num(vllm.output_throughput), bt: num(r.best_output_tokens_per_second), unit: "tok/s" },
    { metric: "median_ttft", vllm: num(vllm.median_ttft_ms), bt: num(r.p50_ttft_ms), unit: "ms", lowerIsBetter: true },
    { metric: "p99_ttft", vllm: num(vllm.p99_ttft_ms), bt: num(r.p99_ttft_ms), unit: "ms", lowerIsBetter: true },
    { metric: "median_tpot", vllm: num(vllm.median_tpot_ms), bt: btTpot(num(r.p50_tpot_ms)), unit: "ms", lowerIsBetter: true },
    { metric: "p99_tpot", vllm: num(vllm.p99_tpot_ms), bt: btTpot(num(r.p99_tpot_ms)), unit: "ms", lowerIsBetter: true },
    { metric: "median_itl", vllm: num(vllm.median_itl_ms), bt: num(r.p50_itl_ms), unit: "ms", lowerIsBetter: true },
    { metric: "p99_itl", vllm: num(vllm.p99_itl_ms), bt: num(r.p99_itl_ms), unit: "ms", lowerIsBetter: true },
    { metric: "median_e2e", vllm: num(vllm.median_e2el_ms), bt: num(r.p50_e2e_latency_ms), unit: "ms", lowerIsBetter: true },
    { metric: "p99_e2e", vllm: num(vllm.p99_e2el_ms), bt: num(r.p99_e2e_latency_ms), unit: "ms", lowerIsBetter: true },
  ];
}

function renderMarkdown(
  rows: Row[],
  vllmPath: string,
  btPath: string,
  vllm: Record<string, unknown>,
  bt: Record<string, unknown>,
  tpot: TpotGuardrail,
): string {
  const benchmark = (bt.benchmark ?? {}) as {
    benchmark_mode?: string;
    metric_mode?: string;
    api_format?: string;
    dataset?: string;
    input_length?: number;
    output_length?: number;
    num_prompts?: number;
    ignore_eos?: boolean;
  };
  const cv = (bt.comparison_validity ?? {}) as {
    verdict?: string | null;
    output_token_count_source?: string | null;
  };

  const head = [
    "| Metric | vLLM | BenchTrace | Δ |",
    "|---|---:|---:|---:|",
  ];
  const body = rows.map((r) => {
    const v = typeof r.vllm === "number" ? fmt(r.vllm) : (r.vllm ?? "—");
    const b = typeof r.bt === "number" ? fmt(r.bt) : (r.bt ?? "—");
    const delta = pct(num(r.vllm), num(r.bt));
    return `| ${r.metric}${r.unit ? ` (${r.unit})` : ""} | ${v} | ${b} | ${delta} |`;
  });
  return [
    `# vLLM vs BenchTrace — parity comparison`,
    ``,
    `- vLLM result:  \`${path.relative(process.cwd(), vllmPath)}\``,
    `- BenchTrace:   \`${path.relative(process.cwd(), btPath)}\``,
    `- vLLM model:   \`${String(vllm.model_id ?? "")}\` (tokenizer \`${String(vllm.tokenizer_id ?? "")}\`)`,
    `- vLLM backend: \`${String(vllm.backend ?? "")}\` · endpoint \`${String(vllm.endpoint_type ?? "")}\` · request_rate=\`${String(vllm.request_rate ?? "")}\` · max_concurrency=\`${String(vllm.max_concurrency ?? "")}\` · num_prompts=\`${String(vllm.num_prompts ?? "")}\``,
    `- BenchTrace:   mode=\`${benchmark.benchmark_mode ?? "?"}\` · metric_mode=\`${benchmark.metric_mode ?? "?"}\` · api=\`${benchmark.api_format ?? "?"}\` · dataset=\`${benchmark.dataset ?? "?"}\` · input=\`${benchmark.input_length ?? "?"}\` · output=\`${benchmark.output_length ?? "?"}\` · n=\`${benchmark.num_prompts ?? "?"}\` · ignore_eos=\`${String(benchmark.ignore_eos)}\``,
    `- Comparison:   verdict=\`${cv.verdict ?? "unknown"}\` · output_token_count_source=\`${cv.output_token_count_source ?? "unknown"}\``,
    `- **TPOT comparison: ${tpot.verdict.toUpperCase()}** — ${tpot.reason}`,
    ``,
    ...head,
    ...body,
    ``,
    `> Δ shows BenchTrace relative to vLLM. Positive on throughput = BenchTrace measured faster; positive on latency = BenchTrace measured slower.`,
    tpot.compare
      ? ``
      : `> TPOT rows show \`n/a\` because the comparison was refused — see "TPOT comparison" above.`,
  ].join("\n");
}

export interface CompareRunInput {
  reference: {
    endpoint: string;
    requests: {
      promptTokenIds: number[] | null;
      maxTokens: number;
      ignoreEos: boolean;
      temperature: number;
      completionTokens: number | null;
      promptText: string | null;
    }[];
    metrics: {
      outputThroughput: number | null;
      totalOutputTokens: number | null;
      totalInputTokens: number | null;
      benchmarkDurationS: number | null;
    };
    tool: string;
    vllmVersion: string | null;
  };
  benchtrace: {
    endpoint: string;
    fieldKeys: string[];
    promptHashes: string[];
    requestedOutput: number[];
    actualOutputTokens: number;
    acceptedTokensPerChunk: number | null;
    metricFormulaOk: boolean;
  };
  referencePromptHashes: string[];
  referenceAcceptedTokensPerChunk: number | null;
  /** Optional explicit vLLM request-body field keys (from a wire-capture bundle). When omitted, derived from the normalized reference request. */
  referenceFieldKeys?: string[];
  tolerance?: { outputTokensPct: number; acceptedTokensPct: number };
}

export interface CompareRunResult {
  finalVerdict: Verdict;
  verdicts: {
    payload: boolean | null;
    prompt: boolean | null;
    outputLength: boolean | null;
    outputTokens: boolean | null;
    scheduling: boolean | null;
  };
  diffTable: string;
  notes: string[];
}

/** Derive the canonical vLLM request-body field keys from a normalized reference request. */
function deriveRefFieldKeys(req: CompareRunInput["reference"]["requests"][number]): string[] {
  const keys = ["model"];
  if (req.promptTokenIds != null || req.promptText != null) keys.push("prompt");
  if (req.maxTokens != null) keys.push("max_tokens");
  if (req.temperature != null) keys.push("temperature");
  // Field-presence check: vLLM puts ignore_eos on the wire regardless of its
  // boolean value, so a `false` must NOT drop the key (that would manufacture
  // a phantom payload-field mismatch against BenchTrace, which always sends it).
  keys.push("ignore_eos");
  return keys;
}

export function compareRun(input: CompareRunInput): CompareRunResult {
  const { reference: ref, benchtrace: bt } = input;
  const refFieldKeys =
    input.referenceFieldKeys ??
    (ref.requests.length > 0 ? deriveRefFieldKeys(ref.requests[0]!) : []);
  const requestedOutputRef = ref.requests.map((r) => r.maxTokens);
  // When neither the bundle metric nor any per-request completionTokens is
  // present, output-token equivalence is UNMEASURED — pass null so the engine
  // treats it as "cannot prove" rather than summing nulls to a literal 0 (which
  // pctDiff(bt, 0) would turn into Infinity → a false not_comparable verdict).
  const summedCompletionTokens = ref.requests.some(
    (r) => r.completionTokens != null,
  )
    ? ref.requests.reduce((s, r) => s + (r.completionTokens ?? 0), 0)
    : null;
  const actualOutputTokensRef =
    ref.metrics.totalOutputTokens ?? summedCompletionTokens;

  const eq = computeEquivalence({
    endpointBt: bt.endpoint,
    endpointRef: ref.endpoint,
    btFieldKeys: bt.fieldKeys,
    refFieldKeys,
    promptHashesBt: bt.promptHashes,
    promptHashesRef: input.referencePromptHashes,
    requestedOutputBt: bt.requestedOutput,
    requestedOutputRef,
    actualOutputTokensBt: bt.actualOutputTokens,
    actualOutputTokensRef,
    acceptedTokensPerChunkBt: bt.acceptedTokensPerChunk,
    acceptedTokensPerChunkRef: input.referenceAcceptedTokensPerChunk,
    metricFormulaOk: bt.metricFormulaOk,
    tolerance: input.tolerance ?? { outputTokensPct: 2, acceptedTokensPct: 5 },
  });

  const verdicts: CompareRunResult["verdicts"] = {
    payload: eq.samePayloadFields,
    prompt: eq.samePromptBytes,
    outputLength: eq.sameOutputLengthPolicy,
    outputTokens: eq.sameOutputTokens,
    scheduling: eq.sameAcceptedTokensPerChunk,
  };

  const tri = (v: boolean | null): string => (v == null ? "—" : v ? "✅" : "❌");
  const diffTable = [
    `| Equivalence check | Verdict |`,
    `|---|:--:|`,
    `| endpoint | ${tri(eq.sameEndpoint)} |`,
    `| payload fields | ${tri(verdicts.payload)} |`,
    `| prompt bytes | ${tri(verdicts.prompt)} |`,
    `| output length policy | ${tri(verdicts.outputLength)} |`,
    `| output tokens | ${tri(verdicts.outputTokens)} |`,
    `| spec-decode accepted-tokens/chunk | ${tri(verdicts.scheduling)} |`,
    `| metric formula | ${tri(eq.sameMetricFormula)} |`,
    ``,
    `**Final verdict: ${eq.verdict}**`,
    `- reference tool: ${ref.tool}${ref.vllmVersion ? ` ${ref.vllmVersion}` : ""}`,
    `- reference output throughput: ${ref.metrics.outputThroughput ?? "—"} tok/s`,
    ...eq.notes.map((n) => `- note: ${n}`),
  ].join("\n");

  return { finalVerdict: eq.verdict, verdicts, diffTable, notes: eq.notes };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 2) {
    console.error(
      `Usage: compare-vllm-benchtrace.ts <vllm.json> <benchtrace.share.v1.json> [--out file.md]`,
    );
    process.exit(2);
  }
  const vllmPath = argv[0]!;
  const btPath = argv[1]!;
  const outIdx = argv.indexOf("--out");
  const outPath = outIdx >= 0 ? argv[outIdx + 1] : null;
  const allowNative = argv.includes("--allow-native");

  const vllm = loadJson(vllmPath);
  const bt = loadJson(btPath);
  const tpot = tpotGuardrail(bt, allowNative);
  const rows = buildRows(vllm, bt, tpot);
  const md = renderMarkdown(rows, vllmPath, btPath, vllm, bt, tpot);

  process.stdout.write(md + "\n");
  if (outPath) {
    fs.writeFileSync(outPath, md + "\n");
    console.error(`wrote ${outPath}`);
  }
  // Always report the TPOT verdict to stderr so callers/CI can grep it
  // without parsing the markdown table.
  console.error(`TPOT comparison: ${tpot.verdict}`);
}

// Only run as a script, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
