import fs from "node:fs/promises";
import path from "node:path";

import { getBenchmarkProfile } from "@/lib/benchmark-profiles";
import { autoImport } from "../output/auto-import";
import { writeRun } from "../output/write";
import {
  probeContainer,
  readFileViaContainer,
} from "../snapshot/container";
import { captureHardware } from "../snapshot/hardware";
import { probeModelConfig, type ModelConfigProbe } from "../snapshot/model-config";
import { captureNvidiaSmi } from "../snapshot/nvidia-smi";
import {
  TelemetrySampler,
  tokensPerWatt,
} from "../snapshot/telemetry";
import { inferFromModelName } from "./model-name";
import { probeServer } from "./probe";
import { nowMs } from "../util/time";

import {
  aggregateLevel,
  rollupSweep,
  type LevelAggregate,
  type SweepResult,
} from "./aggregate";
import { formatProfileHeadline } from "./headline";
import {
  generatePromptPool,
  type Dataset,
  type PromptPool,
} from "./prompts";
import {
  buildAlignedPrompts,
  hashTokenIds,
  hashText,
  resolveEffectiveVocab,
} from "./prompt-source";
import {
  normalizeTrace,
  writeRequestTrace,
  type RawTrace,
} from "./request-trace";
import {
  buildAlignedRequestBody,
  runRequest,
  type ApiFormat,
  type RequestConfig,
  type RequestResult,
} from "./request";

export interface BenchServeOptions {
  baseUrl: string;
  endpoint: string;
  model: string;
  profile: string;
  inputLen: number;
  outputLen: number;
  numPrompts: number;
  streams: number[];
  streaming: boolean;
  /**
   * Which OpenAI-compatible API surface to hit. `chat` for the chat-template
   * endpoint, `completions` for raw text in/out (matches vllm bench_serve.py).
   */
  apiFormat: ApiFormat;
  /** Sampling temperature. Default 0 (greedy) for deterministic timing. */
  temperature: number;
  /**
   * Prompt corpus. `synthetic` (default) generates deterministic word-bank
   * prompts; `sharegpt` lazy-downloads the ShareGPT corpus and samples
   * from it. ShareGPT requires consent on first use — see prompt in
   * sharegpt.ts or set BENCHTRACE_ACCEPT_SHAREGPT=1.
   */
  dataset: Dataset;
  requestRate: number | "inf";
  ttftSlaMs: number;
  tpotSlaMs: number;
  failureThreshold: number;
  warmup: number;
  seed: number;
  apiKey: string | null;
  launchCommandFile: string | null;
  engineName: string;
  engineVersion: string;
  tags: string[];
  notes: string | null;
  out: string | null;
  /**
   * Allow reasoning/thinking tokens. Default false — a serving benchmark
   * wants deterministic-length completions, not the unbounded thinking
   * traces that Qwen3 / DeepSeek-R1 / o1-class models emit by default.
   * Only meaningful in `chat` api-format (completions bypasses the chat
   * template entirely, so the model has no <think> tag scaffolding).
   */
  thinking: boolean;
  redact: boolean;
  jsonOnly: boolean;
  verbose: boolean;
  /**
   * Dashboard base URL for auto-import. `null` skips the import attempt
   * entirely. When set, the runner attempts a POST after writing the folder
   * — failures (server unreachable / 4xx) print the manual `bench import`
   * command instead of failing the benchmark.
   */
  importTo: string | null;
  /** Raw argv slice — recorded as the benchmark command. */
  argv: string[];
  /**
   * Benchmark mode. `native` (default) is BenchTrace's full-featured mode.
   * `vllm-compatible` flips behaviors to mirror `vllm bench serve` so results
   * are directly comparable; see docs/parity/vllm-parity-report.md.
   */
  benchmarkMode: "native" | "vllm-compatible";
  /**
   * Send `ignore_eos: true` in the request body. Forces fixed-length
   * decode regardless of model end-of-sequence tokens. Default true in
   * compat mode, false in native mode.
   */
  ignoreEos: boolean;
  /**
   * Arbitrary extra fields merged into the request body. Mirror of
   * vLLM's `--extra-body` for engine-specific knobs the CLI doesn't
   * surface directly. Null to omit.
   */
  extraBody: Record<string, unknown> | null;
  /**
   * Per-prompt length variation as a fraction of inputLen, used only by
   * the `random-tokens` dataset. Mirrors vLLM `--random-range-ratio`.
   */
  rangeRatio: number;
  /**
   * Shared random-token prefix length (sampled once, prepended to every
   * prompt). Used only by `random-tokens`. Mirrors vLLM `--random-prefix-len`.
   */
  prefixLen: number;
  /**
   * Explicit tokenizer vocab size for random-token sampling, from
   * `--vocab-size`. Overrides the probed model-config value (useful when
   * config.json is unreadable). Null = use the probed value or fall back.
   */
  vocabSizeOverride: number | null;
  /**
   * Which metric family is the headline. The run always computes BOTH the
   * native chunk-gap latency and the vLLM-compatible token-normalized TPOT;
   * this only selects which is reported as primary and gates comparison
   * guardrails. Defaults to mirror `benchmarkMode`.
   */
  metricMode: "native" | "vllm-compatible" | "both";
  /**
   * Random-token sampling mode. `vllm-compatible` samples over the real
   * tokenizer vocab (from config.json) to match vLLM's RandomDataset;
   * `benchtrace` uses a conservative cap. Only affects `random-tokens`.
   */
  randomTokenMode: "benchtrace" | "vllm-compatible";
  /**
   * When true, the run exits non-zero if the computed `comparison_validity`
   * verdict is not `strongly_comparable` — i.e. some comparison-critical
   * metadata (endpoint, api format, metric formula, token source) diverges
   * from what a faithful `vllm bench serve` comparison requires. Default
   * false: the verdict is still recorded in the share doc either way.
   */
  strictComparison: boolean;
  /** Strict clean-room vLLM-aligned mode: token-id prompts, minimal body. */
  aligned: boolean;
  /**
   * Temperature to put on the aligned wire, mirroring `vllm bench serve
   * --temperature`. null = omit (server samples at default); a value is sent
   * verbatim. Only consulted in aligned mode.
   */
  alignedWireTemperature: number | null;
  /** Path to a JSONL of {tokenIds,outputLen} to replay (aligned mode). Null = independent generation. */
  referencePrompts: string | null;
  /** Path to a paired vLLM reference bundle for the comparison verdict (consumed in a later task). */
  referenceMetrics: string | null;
  /** Directory to write per-request normalized traces (aligned mode). Null = no tracing. */
  traceRequests: string | null;
}

export async function runBenchServe(opts: BenchServeOptions): Promise<number> {
  if (opts.streams.length === 0) {
    console.error("--streams must specify at least one level");
    return 1;
  }

  const startedAt = new Date();
  const startMs = nowMs();
  const profile = getBenchmarkProfile(opts.profile);
  // `info` always prints — per-level summaries, banners, errors. The user
  // should never run a benchmark and see no output.
  // `log` is gated on --verbose — extra detail like hardware-snapshot timing.
  const info = (m: string) => console.error(m);
  const log = opts.verbose ? info : () => {};

  info(`BenchTrace · BT-SERVE-001 · ${opts.engineName} ${opts.engineVersion}`);
  // In aligned mode the wire mirrors vLLM: temperature is omitted unless the
  // user passed --temperature, so report what actually lands on the wire rather
  // than the internal (unused) opts.temperature, which would falsely read 0.
  const tempLabel = opts.aligned
    ? opts.alignedWireTemperature != null
      ? String(opts.alignedWireTemperature)
      : "omitted(server-default)"
    : String(opts.temperature);
  info(
    `target: ${opts.baseUrl}${opts.endpoint}  model=${opts.model}  api=${opts.apiFormat}  temp=${tempLabel}  streams=${opts.streams.join(",")}  prompts/level=${opts.numPrompts}`,
  );

  // Preflight probe — fail fast on a misconfigured base URL / dead server.
  // We hit the chat endpoint with a 1-token request; any HTTP response means
  // the server is alive, even 4xx (model not found, auth, etc.). Only network
  // errors abort.
  // Probe /v1/models + /version for fields we'd otherwise have to leave null.
  info("Probing server for model + version metadata…");
  const probed = await probeServer(opts.baseUrl, opts.model, opts.apiKey);
  if (probed.engineVersion) {
    info(`  detected engine version: ${probed.engineVersion}`);
  }
  if (probed.claimedContextLength) {
    info(`  detected max_model_len: ${probed.claimedContextLength}`);
  }
  const nameInfo = inferFromModelName(opts.model);
  if (nameInfo.quantization) {
    info(`  inferred quantization: ${nameInfo.quantization}`);
  }
  if (nameInfo.parameterCount) {
    info(
      `  inferred params: ${(nameInfo.parameterCount / 1e9).toFixed(1)}B${nameInfo.activeParameterCount ? ` (active ${(nameInfo.activeParameterCount / 1e9).toFixed(1)}B)` : ""}`,
    );
  }

  // Try to identify the docker container serving on this port and pull its
  // launch command + image. Fills loader_configs fields the user otherwise
  // has to remember to write into --launch-command-file by hand.
  info("Probing container for launch config…");
  const container = await probeContainer(opts.baseUrl);
  if (container) {
    info(`  detected image: ${container.image}`);
    if (container.loader.tensorParallelSize != null) {
      info(`  tensor-parallel-size: ${container.loader.tensorParallelSize}`);
    }
    if (container.loader.mtpEnabled) info("  MTP enabled");
    if (container.loader.kvCacheDtype) info(`  kv-cache-dtype: ${container.loader.kvCacheDtype}`);
  } else {
    info("  no docker container matched — loader fields will stay sparse");
  }

  // Try to read the model's config.json + tokenizer_config.json from the
  // path the server reported. Override the regex-inferred values when we
  // get exact data. If the path isn't on the host filesystem AND we found
  // a docker container, fall back to reading via `docker exec cat …` so
  // host-CLI + container-vLLM setups still populate model fields.
  let modelConfig: ModelConfigProbe | null = null;
  if (probed.modelRepoOrPath) {
    info(`Probing model config at ${probed.modelRepoOrPath}…`);
    const containerReader = container
      ? (p: string) => readFileViaContainer(container.containerId, p)
      : undefined;
    modelConfig = await probeModelConfig(probed.modelRepoOrPath, containerReader);
    if (modelConfig) {
      if (modelConfig.architecture) info(`  architecture: ${modelConfig.architecture}`);
      if (modelConfig.quantization) info(`  quantization (config): ${modelConfig.quantization}`);
      if (modelConfig.precision) info(`  precision: ${modelConfig.precision}`);
      if (modelConfig.tokenizer) info(`  tokenizer: ${modelConfig.tokenizer}`);
    } else if (containerReader) {
      info("  model dir not readable from host or container — skipping");
    } else {
      info("  model dir not readable from host (no container fallback) — skipping");
    }
  }

  info("Preflight: checking server reachability…");
  const preflight = await runRequest(
    {
      baseUrl: opts.baseUrl,
      endpoint: opts.endpoint,
      model: opts.model,
      prompt: "preflight",
      maxTokens: 1,
      streaming: false,
      apiKey: opts.apiKey,
      seed: opts.seed,
      apiFormat: opts.apiFormat,
      temperature: opts.temperature,
      thinking: opts.thinking,
      benchmarkMode: opts.benchmarkMode,
      ignoreEos: opts.ignoreEos,
      aligned: false,
      alignedWireTemperature: null,
      extraBody: opts.extraBody,
      timeoutMs: 10_000,
    },
    1,
  );
  if (preflight.errorKind === "network" || preflight.errorKind === "timeout") {
    info(
      `\n❌ Preflight failed: ${preflight.errorMessage}\n` +
        `   The server at ${opts.baseUrl} is not reachable.\n` +
        `   Start your engine (vLLM / SGLang / Ollama / LM Studio …) and try again.`,
    );
    return 1;
  }
  if (preflight.errorKind === "http_4xx" || preflight.errorKind === "http_5xx") {
    info(
      `\n⚠ Preflight got ${preflight.errorKind} from ${opts.baseUrl}${opts.endpoint}:\n` +
        `   ${preflight.errorMessage}\n` +
        `   This usually means the model name is wrong, the endpoint path is off, or the\n` +
        `   server requires auth. The sweep will still run, but expect every request to fail.`,
    );
  }

  // Hardware snapshot before
  log("Capturing hardware snapshot (before)…");
  const hwBefore = await captureHardware();
  const smiBefore = await captureNvidiaSmi();

  // Summary so the user can see at a glance which probes contributed. Done
  // after captureHardware so we have GPU vendor / count available.
  info("Probe summary:");
  info(
    `  hardware:  ${
      hwBefore.gpuVendor
        ? `${hwBefore.gpuVendor}, ${hwBefore.gpuModels.length} GPU(s)${
            hwBefore.motherboard ? `, ${hwBefore.motherboard}` : ""
          }`
        : "no GPU detected (CPU-only or unknown vendor)"
    }`,
  );
  info(
    `  container: ${
      container
        ? container.image
        : "none (server isn't in a docker container we can see)"
    }`,
  );
  info(
    `  model:     ${
      modelConfig
        ? "config.json read" +
          (modelConfig.tokenizer ? ` (tokenizer=${modelConfig.tokenizer})` : "")
        : "config.json unreadable — model fields will fall back to name-regex"
    }`,
  );

  // Start the GPU telemetry sampler — runs `nvidia-smi --query-gpu` in a
  // streaming subprocess for the duration of the sweep. Best-effort: stays
  // null on systems without nvidia-smi.
  const telemetry = new TelemetrySampler();
  telemetry.start(1000);
  if (telemetry.isOk()) {
    log("Telemetry sampler running (nvidia-smi --query-gpu @ 1Hz)");
  }

  // Generate prompt pool (large enough that each level can take a fresh slice).
  // For ShareGPT the corpus may need download/consent on first use; the
  // helper handles that and throws with an actionable message on decline.
  const poolSize = opts.numPrompts * opts.streams.length;
  // A `--vocab-size` flag overrides the probed config; this lets random-token
  // sampling span vLLM's full vocab even when config.json is unreadable.
  const effectiveVocab = resolveEffectiveVocab(
    opts.vocabSizeOverride,
    modelConfig?.vocabSize,
  );
  let promptPool: PromptPool;
  try {
    promptPool = await generatePromptPool({
      dataset: opts.dataset,
      seed: opts.seed,
      count: poolSize,
      approxTokens: opts.inputLen,
      server:
        opts.dataset === "random-tokens"
          ? {
              baseUrl: opts.baseUrl,
              model: opts.model,
              apiKey: opts.apiKey,
              rangeRatio: opts.rangeRatio,
              prefixLen: opts.prefixLen,
              vocabMode: opts.randomTokenMode,
              vocabSize: effectiveVocab.vocabSize ?? undefined,
              tokenizerSource: effectiveVocab.tokenizerSource,
            }
          : undefined,
    });
    if (promptPool.dataset !== "synthetic") {
      info(`  prompt corpus: ${promptPool.dataset} (${promptPool.prompts.length} prompts)`);
    }
    if (
      promptPool.randomTokenMetadata?.mode === "vllm-compatible" &&
      promptPool.randomTokenMetadata.tokenizer_source === "fallback"
    ) {
      info(
        "  ⚠ random-token-mode=vllm-compatible but the tokenizer vocab_size is unknown " +
          "(model config not readable). Falling back to a conservative vocab cap — " +
          "the input-token distribution will NOT byte-match vLLM and the run will be " +
          "marked weakly_comparable.",
      );
    }
  } catch (err) {
    info(
      `  prompt corpus error: ${err instanceof Error ? err.message : String(err)}`,
    );
    info("  falling back to synthetic prompts");
    promptPool = await generatePromptPool({
      dataset: "synthetic",
      seed: opts.seed,
      count: poolSize,
      approxTokens: opts.inputLen,
    });
  }
  const pool = promptPool.prompts;

  // Aligned mode overrides the WIRE prompts with raw token-id arrays (no
  // /detokenize round-trip). The detokenized `pool` above is still generated so
  // the share doc keeps its dataset metadata; only what we send changes.
  let alignedPool: (string | number[])[] | null = null;
  if (opts.aligned) {
    let alignedSet;
    if (opts.referencePrompts) {
      const refRaw = await fs.readFile(opts.referencePrompts, "utf8");
      const reference = refRaw
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line, idx) => {
          try {
            // A replay entry carries either `text` (vLLM's decoded-string
            // datasets) or `tokenIds` (raw token-id prompts).
            const o = JSON.parse(line) as {
              tokenIds?: number[];
              text?: string;
              outputLen: number;
            };
            return { tokenIds: o.tokenIds, text: o.text, outputLen: o.outputLen };
          } catch {
            throw new Error(
              `--reference-prompts ${opts.referencePrompts}: malformed JSON on line ${idx + 1}: ${line.slice(0, 120)}`,
            );
          }
        });
      alignedSet = buildAlignedPrompts({ mode: "replay", reference });
    } else {
      const vocabSize = effectiveVocab.vocabSize;
      if (vocabSize == null) {
        info(
          "  ⚠ --vllm-aligned independent prompts need the tokenizer vocab_size " +
            "(model config unreadable, and no --vocab-size given); input-token " +
            "distribution will not match vLLM.",
        );
      }
      alignedSet = buildAlignedPrompts({
        mode: "independent",
        seed: opts.seed,
        count: poolSize,
        inputLen: opts.inputLen,
        vocabSize: vocabSize ?? 100000,
        outputLen: opts.outputLen,
      });
    }
    alignedPool = alignedSet.prompts.map((p) => p.text ?? p.tokenIds);
  }

  const allRequests: RequestResult[] = [];
  const perLevel: LevelAggregate[] = [];

  for (let levelIdx = 0; levelIdx < opts.streams.length; levelIdx++) {
    const streamLevel = opts.streams[levelIdx]!;
    const levelSource: (string | number[])[] = alignedPool ?? pool;
    const prompts = levelSource.slice(
      levelIdx * opts.numPrompts,
      (levelIdx + 1) * opts.numPrompts,
    );

    info(`\nLevel ${streamLevel}:`);
    // Warmup
    if (opts.warmup > 0) {
      log(`  warmup ${opts.warmup} req…`);
      const warmupPrompts = prompts.slice(0, Math.min(opts.warmup, prompts.length));
      await runConcurrent(opts, streamLevel, warmupPrompts);
    }

    telemetry.reset();
    const levelStart = nowMs();
    const results = await runConcurrent(opts, streamLevel, prompts);
    const levelEnd = nowMs();
    const tel = telemetry.snapshot();

    const agg = aggregateLevel(
      streamLevel,
      results,
      {
        ttftSlaMs: opts.ttftSlaMs,
        tpotSlaMs: opts.tpotSlaMs,
        failureThreshold: opts.failureThreshold,
      },
      levelStart,
      levelEnd,
    );
    // Layer in telemetry — populates fields the request loop can't measure
    // (power, temp, VRAM, GPU util) and derives tokens_per_watt.
    agg.peakVramGb = tel.peakVramGb;
    agg.averageVramGb = tel.averageVramGb;
    agg.gpuUtilizationAvg = tel.gpuUtilizationAvg;
    agg.gpuUtilizationPeak = tel.gpuUtilizationPeak;
    agg.powerDrawWattsAvg = tel.powerDrawWattsAvg;
    agg.powerDrawWattsPeak = tel.powerDrawWattsPeak;
    agg.gpuTemperatureAvg = tel.gpuTemperatureAvg;
    agg.gpuTemperaturePeak = tel.gpuTemperaturePeak;
    agg.tokensPerWatt = tokensPerWatt(
      agg.outputTokensPerSecond,
      tel.powerDrawWattsAvg,
    );
    perLevel.push(agg);
    allRequests.push(...results);

    info(
      `  ${agg.successfulRequests}/${agg.requestCount} ok · ${
        agg.outputTokensPerSecond?.toFixed(1) ?? "—"
      } tok/s · TTFT p95 ${
        agg.p95TtftMs?.toFixed(0) ?? "—"
      } ms · TPOT p95 ${agg.p95TpotMs?.toFixed(1) ?? "—"} ms · ${
        agg.isValid ? "valid" : `INVALID: ${agg.invalidReasons.join(", ")}`
      }`,
    );

    // If literally nothing succeeded this level AND the first level fails
    // identically, abort early — running 5 more levels of pure failures wastes
    // the user's time and produces a worthless trace.
    if (
      agg.successfulRequests === 0 &&
      levelIdx === 0 &&
      results.length > 0
    ) {
      info(
        `\n❌ Every request at the first level failed. Aborting the sweep early.\n` +
          `   Common causes:\n` +
          `   - model name "${opts.model}" not loaded on the server\n` +
          `   - endpoint path "${opts.endpoint}" is wrong for this server\n` +
          `   - server requires --api-key but none was provided\n` +
          `   First error: ${results[0]?.errorMessage ?? "unknown"}`,
      );
      return 1;
    }

    // brief settling pause between levels
    await sleep(500);
  }

  telemetry.stop();
  const sweep = rollupSweep(perLevel);
  const endMs = nowMs();
  const completedAt = new Date();

  log("\nCapturing hardware snapshot (after)…");
  const hwAfter = await captureHardware();
  const smiAfter = await captureNvidiaSmi();

  const totalOk = perLevel.reduce((a, l) => a + l.successfulRequests, 0);
  const totalReq = perLevel.reduce((a, l) => a + l.requestCount, 0);
  const headline = profile
    ? formatProfileHeadline(profile, sweep)
    : `${totalOk}/${totalReq} ok · max valid = ${sweep.maxValidConcurrency ?? "(none)"}`;
  info(
    `\nSweep done in ${((endMs - startMs) / 1000).toFixed(1)}s · ${headline}`,
  );

  // If every level was a total failure, don't import an empty trace. Write
  // the folder so the user can inspect raw artifacts but bail before push.
  if (totalOk === 0) {
    info(
      `\n❌ Zero successful requests across the entire sweep. Skipping auto-import.\n` +
        `   The run folder is written so you can inspect raw/per-request-results.jsonl\n` +
        `   for the per-request error messages.`,
    );
  }

  // Read launch command if provided. Falls back to the container-probed
  // command if the user didn't pass --launch-command-file; that way the
  // trace records the actual `docker run vllm/vllm-openai …` line.
  let launchCommand: string | null = null;
  if (opts.launchCommandFile) {
    try {
      launchCommand = (await fs.readFile(opts.launchCommandFile, "utf8")).trim();
    } catch (err) {
      console.error(
        `Could not read --launch-command-file ${opts.launchCommandFile}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  if (!launchCommand && container?.launchCommand) {
    launchCommand = container.launchCommand;
  }

  // Resolve output directory
  const outDir = opts.out
    ? path.resolve(opts.out)
    : path.resolve(
        process.cwd(),
        "benchtrace-runs",
        autoTraceName(opts, startedAt),
      );

  const writeResult = await writeRun({
    outDir,
    options: opts,
    startedAt,
    completedAt,
    sweep,
    perRequest: allRequests,
    hardwareBefore: hwBefore,
    hardwareAfter: hwAfter,
    nvidiaSmiBefore: smiBefore,
    nvidiaSmiAfter: smiAfter,
    launchCommand,
    probed,
    nameInfo,
    container,
    modelConfig,
    promptPool,
  });

  info(`\nOutput: ${outDir}`);

  // Auto-import — best-effort. Never fails the benchmark. Skipped entirely
  // if zero requests succeeded; the run is preserved on disk for diagnosis
  // but importing a 100%-failure trace into the dashboard is noise.
  if (opts.importTo && totalOk > 0) {
    info(`\nAuto-importing into ${opts.importTo}…`);
    const result = await autoImport({
      inputPath: outDir,
      baseUrl: opts.importTo,
      overrides: opts.notes || opts.tags.length ? { notes: opts.notes ?? undefined, tags: opts.tags } : undefined,
    });
    if (result.ok) {
      console.log(`Imported: ${result.traceName}`);
      console.log(`URL:      ${result.url}`);
      if (result.warnings?.length) {
        console.log("Import warnings:");
        for (const w of result.warnings) console.log(`  - ${w}`);
      }
    } else if (result.skipReason === "unreachable") {
      console.log(
        `Dashboard not reachable at ${opts.importTo} — skipping auto-import.`,
      );
      console.log(`To push manually once it's running:`);
      console.log(`  npm run bench -- import ${outDir}`);
    } else {
      console.log(`Auto-import failed: ${result.error ?? "unknown"}`);
      console.log(`Try again manually:`);
      console.log(`  npm run bench -- import ${outDir}`);
    }
  } else if (!opts.importTo) {
    info(`\nAuto-import disabled. To push manually:`);
    info(`  npm run bench -- import ${outDir}`);
  } else if (totalOk === 0) {
    // Already explained above why we skipped. Just remind the user how to
    // push manually if they really want to keep the failed run on the
    // dashboard for forensics.
    info(`To push the failed run anyway (forensic only):`);
    info(`  npm run bench -- import ${outDir}`);
  }

  if (totalOk === 0) return 1;

  // --strict-comparison: refuse to claim a clean run when the comparison is
  // not faithful. The verdict is always recorded in the share doc; strict mode
  // just turns a weak/invalid comparison into a non-zero exit so CI and
  // head-to-head harnesses don't silently treat the numbers as comparable.
  if (opts.strictComparison) {
    const verdict = writeResult.comparisonVerdict;
    if (verdict !== "strongly_comparable") {
      info(
        `\n❌ --strict-comparison: comparison_validity verdict is "${verdict ?? "unknown"}", ` +
          `not "strongly_comparable".\n` +
          `   See comparison_validity.notes in the share doc for which metadata diverged.`,
      );
      return 3;
    }
    info(`\n✓ --strict-comparison: verdict is strongly_comparable.`);
  }

  return sweep.maxValidConcurrency != null ? 0 : 2;
}

/**
 * Issue `prompts.length` requests with at most `streamLevel` in flight at any
 * time. Returns one RequestResult per prompt, in completion order.
 */
async function runConcurrent(
  opts: BenchServeOptions,
  streamLevel: number,
  prompts: (string | number[])[],
): Promise<RequestResult[]> {
  const results: RequestResult[] = [];
  let nextIdx = 0;
  const inFlight = new Set<Promise<void>>();
  const requestIntervalMs =
    opts.requestRate === "inf" ? 0 : 1000 / opts.requestRate;
  let scheduleAt = nowMs();

  while (nextIdx < prompts.length || inFlight.size > 0) {
    while (inFlight.size < streamLevel && nextIdx < prompts.length) {
      const promptIdx = nextIdx++;
      const promptVal = prompts[promptIdx]!;
      const cfg: RequestConfig = {
        baseUrl: opts.baseUrl,
        endpoint: opts.endpoint,
        model: opts.model,
        prompt: promptVal,
        maxTokens: opts.outputLen,
        streaming: opts.streaming,
        apiKey: opts.apiKey,
        seed: opts.seed + promptIdx,
        apiFormat: opts.apiFormat,
        temperature: opts.temperature,
        thinking: opts.thinking,
        benchmarkMode: opts.benchmarkMode,
        ignoreEos: opts.ignoreEos,
        aligned: opts.aligned,
        alignedWireTemperature: opts.alignedWireTemperature,
        extraBody: opts.extraBody,
      };
      const p = runRequest(cfg, streamLevel).then(async (r) => {
        results.push(r);
        if (opts.aligned && opts.traceRequests) {
          const promptHash =
            typeof promptVal === "string"
              ? hashText(promptVal)
              : hashTokenIds(promptVal);
          const raw: RawTrace = {
            requestId: r.requestId,
            endpoint: opts.endpoint,
            body: buildAlignedRequestBody({
              model: opts.model,
              prompt: promptVal,
              maxTokens: opts.outputLen,
              streaming: opts.streaming,
              ignoreEos: opts.ignoreEos,
              temperature: opts.alignedWireTemperature,
            }),
            promptHash,
            requestedOutputLen: opts.outputLen,
            scheduledMs: r.startMs,
            sentMs: r.startMs,
            firstTokenMs: r.firstTokenMs,
            completeMs: r.endMs,
            actualOutputTokens: r.outputTokens,
            actualChunks: r.chunkCount,
            usage: {
              prompt_tokens: r.inputTokens ?? undefined,
              completion_tokens: r.outputTokens ?? undefined,
            },
          };
          try {
            await writeRequestTrace(opts.traceRequests, normalizeTrace(raw));
          } catch (err) {
            // Best-effort: a trace-write failure (full disk, permissions) must
            // not reject this tracked promise, or it would stick in inFlight and
            // Promise.race would re-throw and abort the whole sweep.
            console.error(
              `  ⚠ request-trace write failed for ${r.requestId}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        inFlight.delete(p);
      });
      inFlight.add(p);

      if (requestIntervalMs > 0) {
        scheduleAt += requestIntervalMs;
        const wait = scheduleAt - nowMs();
        if (wait > 0) await sleep(wait);
      }
    }
    if (inFlight.size > 0) {
      await Promise.race(inFlight);
    }
  }
  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

function autoTraceName(opts: BenchServeOptions, ts: Date): string {
  const modelShort = opts.model
    .split("/")
    .pop()!
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const streamsLabel = `${opts.streams[0]}-${opts.streams[opts.streams.length - 1]}`;
  const stamp = ts
    .toISOString()
    .replace(/[:T]/g, "")
    .replace(/\..+$/, "")
    .replace(/-/g, "")
    .slice(0, 12);
  return `${modelShort}-${opts.engineName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-streams-${streamsLabel}-${stamp}`;
}

export type { SweepResult };
