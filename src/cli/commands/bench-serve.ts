import { Command } from "commander";

import {
  BENCHMARK_PROFILES,
  getBenchmarkProfile,
  type BenchmarkProfileDefinition,
} from "@/lib/benchmark-profiles";

import { runBenchServe } from "../runner/sweep";

export function registerBenchServe(parent: Command) {
  parent
    .command("serve")
    .description(
      "Run a BenchTrace native benchmark against an OpenAI-compatible server. Defaults to BT-SERVE-001 (concurrency sweep). Pass --profile to pick a different workload.",
    )
    .requiredOption("--base-url <url>", "server base URL, e.g. http://localhost:8000")
    .option(
      "--endpoint <path>",
      "API path; defaults to /v1/chat/completions for --api-format chat, /v1/completions for --api-format completions",
    )
    .option(
      "--api-format <fmt>",
      "OpenAI surface to hit: 'chat' (wraps prompt in the model's chat template) or 'completions' (raw text in/out; matches vllm bench_serve.py and bypasses reasoning-parser <think> buffering). Default: 'completions' in vllm-compatible mode, 'chat' otherwise.",
    )
    .option(
      "--temperature <n>",
      "sampling temperature. Default 0 (greedy) for deterministic timing. NOTE: --vllm-aligned ignores this and omits temperature on the wire, matching vllm bench serve's random dataset (server-default sampling).",
      parseFloatStrict,
    )
    .option(
      "--ignore-eos <bool>",
      "send `ignore_eos: true` in the request body so the server emits exactly --output-len tokens regardless of EOS. Default true in vllm-compatible mode, false otherwise.",
      parseBool,
    )
    .option(
      "--extra-body <json>",
      "JSON object merged into every request body (e.g. '{\"top_p\":0.95}'). Mirrors vLLM's --extra-body.",
    )
    .option(
      "--dataset <kind>",
      "prompt corpus: 'synthetic' (deterministic word-bank), 'sharegpt' (real chat prompts), or 'random-tokens' (random token IDs decoded via the server's /detokenize endpoint — mirrors `vllm bench serve --dataset-name random` and defeats speculative-decoding speedups for true throughput parity). Default: 'random-tokens' in vllm-compatible mode, 'synthetic' otherwise.",
    )
    .option(
      "--benchmark-mode <mode>",
      "benchmark mode: 'native' (default, BenchTrace full-featured) or 'vllm-compatible' (mirrors `vllm bench serve` semantics for direct comparison). --compare-target vllm defaults this to vllm-compatible.",
    )
    .option(
      "--metric-mode <mode>",
      "which metric family is the headline: 'native' (mean chunk-gap latency), 'vllm-compatible' (token-normalized TPOT), or 'both'. BenchTrace always computes both; this only selects the primary and gates comparison guardrails. Default: mirrors --benchmark-mode.",
    )
    .option(
      "--random-token-mode <mode>",
      "random-tokens sampling: 'benchtrace' (conservative vocab cap) or 'vllm-compatible' (sample over the real tokenizer vocab from config.json, matching `vllm bench serve --dataset-name random`). Default: 'vllm-compatible' in vllm-compatible mode, else 'benchtrace'.",
    )
    .option(
      "--compare-target <tool>",
      "the external tool this run will be compared against (currently only 'vllm'). Implies --metric-mode vllm-compatible and --random-token-mode vllm-compatible unless overridden.",
    )
    .option(
      "--strict-comparison",
      "fail the run (exit non-zero) if comparison_validity is not strongly_comparable. Use when a run MUST be apples-to-apples with vLLM.",
      false,
    )
    .option("--vllm-aligned", "strict clean-room vLLM alignment on /v1/completions: sends only the fields vllm bench serve's random dataset puts on the wire (model, prompt, max_tokens, ignore_eos, stream) — omits temperature and seed, so the server samples at its default (non-deterministic, as vLLM is). Alias: --compat vllm.")
    .option("--compat <target>", "compatibility target; 'vllm' is equivalent to --vllm-aligned")
    .option("--reference-prompts <file>", "replay exact prompts captured from a vLLM run (JSONL of {tokenIds,outputLen} or {text,outputLen})")
    .option("--reference-metrics <file>", "paired vLLM reference bundle for the comparison_validity verdict")
    .option("--trace-requests <dir>", "write a normalized per-request trace for equivalence diffing")
    .option(
      "--range-ratio <n>",
      "input-length variation for the random-tokens dataset, as a fraction of --input-len (e.g. 0.1 means each prompt is sampled uniformly in [0.9·N, 1.1·N] tokens). Mirrors vLLM --random-range-ratio. Default 0.",
      parseFloatStrict,
      0,
    )
    .option(
      "--prefix-len <n>",
      "shared random-token prefix length prepended to every random-tokens prompt. Mirrors vLLM --random-prefix-len. Default 0.",
      csvInt,
      0,
    )
    .option(
      "--vocab-size <n>",
      "tokenizer vocab size for random-token sampling. Overrides the value probed from the model's config.json — use it when the config is unreadable (e.g. model dir not mounted) so random IDs span the SAME range as `vllm bench serve` and the input-token distribution matches. Tagged 'cli-override' in metadata.",
      csvInt,
    )
    .requiredOption("--model <name>", "model name as the server expects it")
    .option(
      "--profile <id>",
      `BenchTrace profile id (${Object.keys(BENCHMARK_PROFILES).join(" | ")}). Sets the workload shape — input/output length, streams, streaming, SLA defaults. Override any individual field with its own flag.`,
      "BT-SERVE-001",
    )
    // No CLI defaults on these — resolve from the profile in the action so
    // --profile BT-CHAT-001 actually changes the workload, not just the label.
    .option("--input-len <n>", "approximate prompt length in tokens", csvInt)
    .option("--output-len <n>", "max_tokens per request", csvInt)
    .option("--num-prompts <n>", "prompts per stream level", csvInt)
    .option(
      "--streams <csv>",
      "comma-separated stream/concurrency levels (default depends on --profile; BT-SERVE-001 sweeps 1,2,4,8)",
    )
    .option("--streaming <bool>", "use SSE streaming", parseBool)
    .option(
      "--thinking <bool>",
      "allow reasoning/thinking output (Qwen3 / DeepSeek-R1 / o1). Default false because thinking traces make per-request timing meaningless for a serving benchmark.",
      parseBool,
      false,
    )
    .option(
      "--request-rate <n|inf>",
      "requests/sec cap; inf = as fast as possible while keeping N in-flight",
      "inf",
    )
    .option("--ttft-sla-ms <n>", "TTFT p95 SLA in ms (profile-dependent)", csvInt)
    .option("--tpot-sla-ms <n>", "TPOT p95 SLA in ms (profile-dependent)", csvInt)
    .option(
      "--failure-threshold <n>",
      "allowed per-level failure rate (0..1)",
      parseFloatStrict,
      0.05,
    )
    .option("--warmup <n>", "warmup requests per stream level (discarded)", csvInt)
    .option("--seed <n>", "RNG seed for prompt selection", csvInt, 42)
    .option("--api-key <key>", "Authorization: Bearer <key>; or env BENCHTRACE_API_KEY")
    .option(
      "--launch-command-file <path>",
      "file whose contents become loader.launch_command in the trace",
    )
    .option("--engine-name <s>", "engine label, e.g. vLLM / SGLang / Ollama", "OpenAI-compatible")
    .option("--engine-version <s>", "engine version string", "unknown")
    .option("--tags <csv>", "comma-separated tags to attach to the trace")
    .option("--notes <text>", "free-form notes attached to the trace")
    .option("--out <dir>", "output folder for the run")
    .option("--no-redact", "skip redaction on commands and summary")
    .option("--json-only", "skip share-summary.md", false)
    .option(
      "--import-to <url>",
      "dashboard URL to auto-import the run into; defaults to BENCHTRACE_BASE_URL or http://localhost:18000",
    )
    .option(
      "--no-import",
      "skip auto-import even if a dashboard is reachable",
    )
    .option("--verbose", "verbose progress logging", false)
    .action(async (opts) => {
      const profileId = opts.profile;
      const profile = getBenchmarkProfile(profileId);
      if (!profile) {
        console.error(
          `Unknown --profile ${profileId}. Valid: ${Object.keys(BENCHMARK_PROFILES).join(", ")}`,
        );
        process.exit(1);
      }

      // Validate --compare-target. Currently only vLLM is supported; setting
      // it pulls the metric + workload knobs into vLLM-comparable territory.
      const compareTarget =
        opts.compareTarget != null ? String(opts.compareTarget).toLowerCase() : null;
      if (compareTarget != null && compareTarget !== "vllm") {
        console.error(
          `Unknown --compare-target "${opts.compareTarget}". Valid: vllm`,
        );
        process.exit(1);
      }

      // --vllm-aligned (alias --compat vllm) is the strict clean-room mode. It
      // implies the vLLM-compatible posture: completions endpoint, ignore_eos,
      // and only the request fields vllm bench serve sends — notably WITHOUT
      // temperature or seed, so the server samples at its default (as vLLM does).
      const aligned =
        opts.vllmAligned === true ||
        String(opts.compat ?? "").toLowerCase() === "vllm";

      // Resolve --benchmark-mode first — the api-format, dataset, and
      // ignore_eos defaults all key off it. Declaring `--compare-target vllm`
      // is a statement of intent to compare against `vllm bench serve`, so it
      // must also align the wire format (endpoint, dataset, ignore_eos) — not
      // just the metric family. Default to vllm-compatible in that case unless
      // the user set --benchmark-mode explicitly; otherwise default to native.
      const benchmarkMode = aligned
        ? "vllm-compatible"
        : opts.benchmarkMode != null
          ? String(opts.benchmarkMode).toLowerCase()
          : compareTarget === "vllm"
            ? "vllm-compatible"
            : "native";
      if (benchmarkMode !== "native" && benchmarkMode !== "vllm-compatible") {
        console.error(
          `Unknown --benchmark-mode "${opts.benchmarkMode}". Valid: native, vllm-compatible`,
        );
        process.exit(1);
      }

      // Validate + normalize --api-format. Default depends on --benchmark-mode:
      // compat mode uses /v1/completions (raw text, bypasses reasoning-parser
      // <think> buffering) to match vllm bench_serve.py; native mode keeps chat.
      const rawApiFormat =
        opts.apiFormat != null
          ? String(opts.apiFormat).toLowerCase()
          : (benchmarkMode === "vllm-compatible" ? "completions" : "chat");
      const apiFormat = rawApiFormat;
      if (apiFormat !== "chat" && apiFormat !== "completions") {
        console.error(
          `Unknown --api-format "${opts.apiFormat}". Valid: chat, completions`,
        );
        process.exit(1);
      }

      // Validate --dataset. In compat mode without an explicit flag, default
      // to random-tokens so prompts match vllm bench_serve.py and defeat
      // speculative-decoding asymmetry between English text and random IDs.
      const rawDataset =
        opts.dataset != null
          ? String(opts.dataset).toLowerCase()
          : (benchmarkMode === "vllm-compatible" ? "random-tokens" : "synthetic");
      const dataset = rawDataset;
      if (
        dataset !== "synthetic" &&
        dataset !== "sharegpt" &&
        dataset !== "random-tokens"
      ) {
        console.error(
          `Unknown --dataset "${opts.dataset}". Valid: synthetic, sharegpt, random-tokens`,
        );
        process.exit(1);
      }

      // Resolve --metric-mode. --compare-target vllm forces vllm-compatible
      // (you cannot compare a chunk-gap headline to vLLM TPOT). Otherwise the
      // metric mode mirrors the benchmark mode unless set explicitly.
      const rawMetricMode =
        opts.metricMode != null
          ? String(opts.metricMode).toLowerCase()
          : compareTarget === "vllm"
            ? "vllm-compatible"
            : benchmarkMode; // "native" | "vllm-compatible"
      const metricMode = rawMetricMode;
      if (
        metricMode !== "native" &&
        metricMode !== "vllm-compatible" &&
        metricMode !== "both"
      ) {
        console.error(
          `Unknown --metric-mode "${opts.metricMode}". Valid: native, vllm-compatible, both`,
        );
        process.exit(1);
      }

      // Resolve --random-token-mode. --compare-target vllm forces
      // vllm-compatible (full real vocab). Otherwise vllm-compatible benchmark
      // mode defaults to it too; native defaults to the conservative cap.
      const rawRandomTokenMode =
        opts.randomTokenMode != null
          ? String(opts.randomTokenMode).toLowerCase()
          : compareTarget === "vllm" || benchmarkMode === "vllm-compatible"
            ? "vllm-compatible"
            : "benchtrace";
      const randomTokenMode = rawRandomTokenMode;
      if (
        randomTokenMode !== "benchtrace" &&
        randomTokenMode !== "vllm-compatible"
      ) {
        console.error(
          `Unknown --random-token-mode "${opts.randomTokenMode}". Valid: benchtrace, vllm-compatible`,
        );
        process.exit(1);
      }

      // Endpoint default switches with api-format unless the user passed
      // one explicitly. Keeps the common case ergonomic — running
      // `--api-format completions` doesn't require also remembering to
      // change `--endpoint`.
      const endpoint =
        (opts.endpoint as string | undefined) ??
        (apiFormat === "completions" ? "/v1/completions" : "/v1/chat/completions");

      // Resolve options against the profile defaults. Explicit CLI flags win;
      // missing flags fall back to the profile; missing profile values fall
      // back to one final hard-coded floor.
      const resolved = resolveAgainstProfile(opts, profile);

      // Compat-mode behavior defaults — only applied when the user did NOT
      // pass the flag explicitly. Native mode keeps existing behavior.
      const isCompat = benchmarkMode === "vllm-compatible";
      const temperature = aligned ? 0 : ((opts.temperature as number | undefined) ?? 0);
      // Aligned wire temperature mirrors `vllm bench serve --temperature`: vLLM
      // omits it unless the flag is passed, so we only put it on the wire when
      // the user explicitly set --temperature in aligned mode.
      const alignedWireTemperature =
        aligned && opts.temperature !== undefined
          ? Number(opts.temperature)
          : null;
      const ignoreEos = aligned ? true : ((opts.ignoreEos as boolean | undefined) ?? isCompat);
      let extraBody: Record<string, unknown> | null = null;
      if (typeof opts.extraBody === "string" && opts.extraBody.trim()) {
        try {
          const parsed = JSON.parse(opts.extraBody);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            extraBody = parsed as Record<string, unknown>;
          } else {
            console.error(`--extra-body must be a JSON object`);
            process.exit(1);
          }
        } catch (err) {
          console.error(
            `--extra-body is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        }
      }

      const exitCode = await runBenchServe({
        baseUrl: opts.baseUrl,
        endpoint,
        model: opts.model,
        profile: profileId,
        apiFormat: apiFormat as "chat" | "completions",
        temperature,
        ignoreEos,
        extraBody,
        dataset: dataset as "synthetic" | "sharegpt" | "random-tokens",
        rangeRatio: opts.rangeRatio as number,
        prefixLen: opts.prefixLen as number,
        vocabSizeOverride: (opts.vocabSize as number | undefined) ?? null,
        inputLen: resolved.inputLen,
        outputLen: resolved.outputLen,
        numPrompts: resolved.numPrompts,
        streams: resolved.streams,
        streaming: resolved.streaming,
        thinking: opts.thinking,
        requestRate: parseRate(opts.requestRate),
        ttftSlaMs: resolved.ttftSlaMs,
        tpotSlaMs: resolved.tpotSlaMs,
        failureThreshold: opts.failureThreshold,
        warmup: resolved.warmup,
        seed: opts.seed,
        apiKey: opts.apiKey ?? process.env.BENCHTRACE_API_KEY ?? null,
        launchCommandFile: opts.launchCommandFile ?? null,
        engineName: opts.engineName,
        engineVersion: opts.engineVersion,
        tags: opts.tags ? String(opts.tags).split(",").map((t: string) => t.trim()).filter(Boolean) : [],
        notes: opts.notes ?? null,
        out: opts.out ?? null,
        redact: opts.redact !== false,
        jsonOnly: !!opts.jsonOnly,
        verbose: !!opts.verbose,
        importTo:
          opts.import === false
            ? null
            : (opts.importTo ??
              process.env.BENCHTRACE_BASE_URL ??
              "http://localhost:18000"),
        argv: process.argv.slice(2),
        benchmarkMode: benchmarkMode as "native" | "vllm-compatible",
        metricMode: metricMode as "native" | "vllm-compatible" | "both",
        randomTokenMode: randomTokenMode as "benchtrace" | "vllm-compatible",
        strictComparison: !!opts.strictComparison,
        aligned,
        alignedWireTemperature,
        referencePrompts: (opts.referencePrompts as string | undefined) ?? null,
        referenceMetrics: (opts.referenceMetrics as string | undefined) ?? null,
        traceRequests: (opts.traceRequests as string | undefined) ?? null,
      });
      process.exit(exitCode);
    });
}

/**
 * Per-profile defaults. Explicit CLI flags always win; falls back to the
 * profile's recommended values; then to a sensible global floor.
 */
function resolveAgainstProfile(
  opts: Record<string, unknown>,
  profile: BenchmarkProfileDefinition,
): {
  inputLen: number;
  outputLen: number;
  numPrompts: number;
  streams: number[];
  streaming: boolean;
  ttftSlaMs: number;
  tpotSlaMs: number;
  warmup: number;
} {
  // Generous SLA floors for profiles that explicitly opt out (e.g. batch,
  // long-context). The "validity" check still uses these; profiles that
  // care more set tighter values explicitly.
  const SLA_FLOOR_TTFT = 30_000;
  const SLA_FLOOR_TPOT = 1000;

  return {
    inputLen:
      (opts.inputLen as number | undefined) ??
      profile.recommendedInputLength ??
      512,
    outputLen:
      (opts.outputLen as number | undefined) ??
      profile.recommendedOutputLength ??
      256,
    numPrompts:
      (opts.numPrompts as number | undefined) ?? profile.defaultNumPrompts,
    streams:
      typeof opts.streams === "string"
        ? parseStreams(opts.streams)
        : [...profile.defaultStreams],
    streaming: (opts.streaming as boolean | undefined) ?? profile.streamingEnabled,
    ttftSlaMs:
      (opts.ttftSlaMs as number | undefined) ?? profile.ttftSlaMs ?? SLA_FLOOR_TTFT,
    tpotSlaMs:
      (opts.tpotSlaMs as number | undefined) ?? profile.tpotSlaMs ?? SLA_FLOOR_TPOT,
    warmup: (opts.warmup as number | undefined) ?? profile.warmupRuns,
  };
}

function csvInt(v: string): number {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`expected integer, got ${v}`);
  return n;
}

function parseFloatStrict(v: string): number {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) throw new Error(`expected number, got ${v}`);
  return n;
}

function parseBool(v: string | boolean): boolean {
  if (typeof v === "boolean") return v;
  const s = v.toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function parseStreams(v: string): number[] {
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const n = parseInt(s, 10);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error(`Invalid stream level: ${s}`);
      }
      return n;
    });
}

function parseRate(v: string): number | "inf" {
  if (v === "inf" || v === "Infinity") return "inf";
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid request rate: ${v}`);
  }
  return n;
}
