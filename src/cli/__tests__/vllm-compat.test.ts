import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { buildMarkdownSummary } from "../output/markdown";
import { computeComparisonValidity } from "../output/comparison-validity";
import { generateRandomTokenPrompts } from "../runner/prompts-random-tokens";
import type { LevelAggregate, SweepResult } from "../runner/aggregate";
import type { BenchServeOptions } from "../runner/sweep";
import { metricFamilyView } from "@/lib/metric-family";
import { tpotGuardrail } from "../../../scripts/compare-vllm-benchtrace";

// ─── Test fixtures ──────────────────────────────────────────────────────

/** A share-doc-shaped object the guardrail can read. */
function btDoc(metricMode: string | null, source: string | null) {
  return {
    benchmark: { metric_mode: metricMode },
    comparison_validity: { output_token_count_source: source },
  };
}

function level(overrides: Partial<LevelAggregate>): LevelAggregate {
  return {
    streamLevel: 1,
    requestCount: 10,
    successfulRequests: 10,
    failedRequests: 0,
    failureRate: 0,
    outputTokensPerSecond: 100,
    totalTokensPerSecond: 200,
    prefillTokensPerSecond: null,
    requestsPerSecond: 1,
    p50TtftMs: 40,
    p95TtftMs: 50,
    p99TtftMs: 60,
    p50TpotMs: 10,
    p95TpotMs: 12,
    p99TpotMs: 14,
    p50TpotVllmCompatMs: 10,
    p95TpotVllmCompatMs: 12,
    p99TpotVllmCompatMs: 14,
    p50ChunkGapMs: 30,
    p95ChunkGapMs: 36,
    p99ChunkGapMs: 40,
    meanChunksPerRequest: 33,
    meanTokensPerChunk: 3,
    outputTokenCountSource: "server_usage",
    p50ItlMs: 10,
    p95ItlMs: 12,
    p99ItlMs: 14,
    p50E2eLatencyMs: 500,
    p95E2eLatencyMs: 600,
    p99E2eLatencyMs: 700,
    peakVramGb: null,
    averageVramGb: null,
    gpuUtilizationAvg: null,
    gpuUtilizationPeak: null,
    powerDrawWattsAvg: null,
    powerDrawWattsPeak: null,
    gpuTemperatureAvg: null,
    gpuTemperaturePeak: null,
    tokensPerWatt: null,
    durationSeconds: 10,
    isValid: true,
    meetsTtftSla: true,
    meetsTpotSla: true,
    meetsFailureSla: true,
    invalidReasons: [],
    ...overrides,
  };
}

function markdownInput(metricMode: BenchServeOptions["metricMode"]) {
  const sweep: SweepResult = {
    perLevel: [level({})],
    bestOutputTokensPerSecond: 100,
    bestTotalTokensPerSecond: 200,
    bestPrefillTokensPerSecond: null,
    maxValidConcurrency: 1,
    outputTpsAtMaxValid: 100,
    p95TtftAtMaxValid: 50,
    p95TpotAtMaxValid: 12,
    invalidLevels: [],
    warnings: [],
    totalDurationSeconds: 10,
  };
  const options = {
    model: "test-model",
    engineName: "vllm",
    engineVersion: "unknown",
    baseUrl: "http://localhost:8000",
    endpoint: "/v1/completions",
    streams: [1],
    inputLen: 256,
    outputLen: 32,
    numPrompts: 10,
    streaming: true,
    ttftSlaMs: 1000,
    tpotSlaMs: 100,
    failureThreshold: 0.05,
    notes: null,
    metricMode,
  } as unknown as BenchServeOptions;
  return {
    options,
    startedAt: new Date(0),
    completedAt: new Date(10_000),
    sweep,
    hardware: null,
    launchCommandPresent: false,
    verificationLevel: "weak",
    redactedBenchmarkCommand: "benchtrace bench serve",
    redactedLaunchCommand: null,
  };
}

/** Minimal /detokenize server that records every token id it receives. */
function startDetokServer(): Promise<{
  url: string;
  ids: number[];
  close: () => Promise<void>;
}> {
  const ids: number[] = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body) as { tokens?: number[] };
          for (const t of parsed.tokens ?? []) ids.push(t);
        } catch {
          /* ignore */
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ prompt: "decoded" }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        ids,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

export const tests = [
  // ─── Category 2: native chunk-gap never compared as plain TPOT ─────────
  {
    name: "guardrail: native mode refuses TPOT comparison (no --allow-native)",
    run() {
      const g = tpotGuardrail(btDoc("native", "server_usage"), false);
      assert.equal(g.compare, false);
      assert.equal(g.verdict, "invalid");
      assert.match(g.reason, /native/i);
    },
  },
  {
    name: "guardrail: native + --allow-native shows but still verdict invalid",
    run() {
      const g = tpotGuardrail(btDoc("native", "server_usage"), true);
      assert.equal(g.compare, true);
      assert.equal(g.verdict, "invalid");
      assert.match(g.reason, /different metrics|meaningless/i);
    },
  },
  {
    name: "guardrail: vllm-compatible + server_usage → valid, comparable",
    run() {
      const g = tpotGuardrail(btDoc("vllm-compatible", "server_usage"), false);
      assert.equal(g.compare, true);
      assert.equal(g.verdict, "valid");
    },
  },
  {
    name: "guardrail: vllm-compatible + estimated → weak but comparable",
    run() {
      const g = tpotGuardrail(btDoc("vllm-compatible", "estimated"), false);
      assert.equal(g.compare, true);
      assert.equal(g.verdict, "weak");
    },
  },
  {
    name: "guardrail: vllm-compatible + unknown source → invalid, hidden",
    run() {
      const g = tpotGuardrail(btDoc("vllm-compatible", "unknown"), false);
      assert.equal(g.verdict, "invalid");
      assert.equal(g.compare, false);
    },
  },

  // ─── Category 4: random-tokens uses the REAL vocab_size ────────────────
  {
    name: "random-tokens: vllm-compatible samples across the real vocab",
    async run() {
      const srv = await startDetokServer();
      try {
        const realVocab = 151_936; // qwen-style, well above the 100k fallback
        const { metadata } = await generateRandomTokenPrompts({
          baseUrl: srv.url,
          model: "m",
          apiKey: null,
          seed: 7,
          count: 5,
          inputLen: 300,
          vocabMode: "vllm-compatible",
          vocabSize: realVocab,
          tokenizerSource: "config",
        });
        // Metadata records the real vocab, not the conservative cap.
        assert.equal(metadata.vocab_size, realVocab);
        assert.equal(metadata.token_id_max, realVocab - 1);
        assert.equal(metadata.tokenizer_source, "config");
        assert.equal(metadata.mode, "vllm-compatible");
        // With ~1500 uniform samples over [0, 151936) it's astronomically
        // unlikely every id stayed under the 100k fallback ceiling.
        const maxId = Math.max(...srv.ids);
        assert.ok(
          maxId >= 100_000,
          `expected an id ≥ 100000 from real-vocab sampling, max was ${maxId}`,
        );
      } finally {
        await srv.close();
      }
    },
  },
  {
    name: "random-tokens: benchtrace mode caps at the conservative fallback",
    async run() {
      const srv = await startDetokServer();
      try {
        const { metadata } = await generateRandomTokenPrompts({
          baseUrl: srv.url,
          model: "m",
          apiKey: null,
          seed: 7,
          count: 5,
          inputLen: 300,
          vocabMode: "benchtrace",
          vocabSize: 151_936, // ignored in benchtrace mode
        });
        assert.equal(metadata.vocab_size, 100_000);
        assert.equal(metadata.tokenizer_source, "fallback");
        const maxId = Math.max(...srv.ids);
        assert.ok(maxId < 100_000, `ids must stay under fallback cap, got ${maxId}`);
      } finally {
        await srv.close();
      }
    },
  },
  {
    name: "random-tokens: vllm-compatible without real vocab degrades to fallback",
    async run() {
      const srv = await startDetokServer();
      try {
        const { metadata } = await generateRandomTokenPrompts({
          baseUrl: srv.url,
          model: "m",
          apiKey: null,
          seed: 1,
          count: 2,
          inputLen: 50,
          vocabMode: "vllm-compatible",
          // no vocabSize supplied
        });
        assert.equal(metadata.vocab_size, 100_000);
        assert.equal(metadata.tokenizer_source, "fallback");
      } finally {
        await srv.close();
      }
    },
  },

  // ─── Category 5: comparison_validity verdicts ──────────────────────────
  {
    name: "validity: clean vLLM-style run with server usage → strongly_comparable",
    run() {
      const cv = computeComparisonValidity({
        endpoint: "/v1/completions",
        apiFormat: "completions",
        dataset: "random-tokens",
        ignoreEos: true,
        temperature: 0,
        seed: 0,
        metricMode: "vllm-compatible",
        outputTokenCountSource: "server_usage",
        randomTokenMode: "vllm-compatible",
        reference: {
          endpointRef: "/v1/completions",
          btFieldKeys: ["model", "prompt", "max_tokens", "temperature", "seed", "stream", "ignore_eos"],
          refFieldKeys: ["model", "prompt", "max_tokens", "temperature", "seed", "stream", "ignore_eos"],
          promptHashesBt: ["h"],
          promptHashesRef: ["h"],
          requestedOutputBt: [32],
          requestedOutputRef: [32],
          actualOutputTokensBt: 32,
          actualOutputTokensRef: 32,
          acceptedTokensPerChunkBt: 1.75,
          acceptedTokensPerChunkRef: 1.75,
        },
      });
      assert.equal(cv.verdict, "strongly_comparable");
      assert.equal(cv.same_metric_formula, true);
      assert.equal(cv.has_reference, true);
    },
  },
  {
    name: "validity: vLLM-style config but NO reference → weakly_comparable (not strong)",
    run() {
      const v = computeComparisonValidity({
        endpoint: "/v1/completions",
        apiFormat: "completions",
        dataset: "random-tokens",
        ignoreEos: true,
        temperature: 0,
        seed: 0,
        metricMode: "vllm-compatible",
        outputTokenCountSource: "server_usage",
        randomTokenMode: "vllm-compatible",
      });
      assert.equal(v.verdict, "weakly_comparable");
      assert.equal(v.has_reference, false);
    },
  },
  {
    name: "validity: native metric mode → not_comparable",
    run() {
      const cv = computeComparisonValidity({
        endpoint: "/v1/completions",
        apiFormat: "completions",
        dataset: "random-tokens",
        ignoreEos: true,
        temperature: 0,
        seed: 0,
        metricMode: "native",
        outputTokenCountSource: "server_usage",
        randomTokenMode: "vllm-compatible",
      });
      assert.equal(cv.verdict, "not_comparable");
      assert.equal(cv.same_metric_formula, false);
    },
  },
  {
    name: "validity: chat endpoint → not_comparable (wire mismatch)",
    run() {
      const cv = computeComparisonValidity({
        endpoint: "/v1/chat/completions",
        apiFormat: "chat",
        dataset: "random-tokens",
        ignoreEos: true,
        temperature: 0,
        seed: 0,
        metricMode: "vllm-compatible",
        outputTokenCountSource: "server_usage",
        randomTokenMode: "vllm-compatible",
      });
      assert.equal(cv.verdict, "not_comparable");
    },
  },
  {
    name: "validity: estimated tokens / non-vllm vocab → weakly_comparable",
    run() {
      const cv = computeComparisonValidity({
        endpoint: "/v1/completions",
        apiFormat: "completions",
        dataset: "random-tokens",
        ignoreEos: true,
        temperature: 0,
        seed: 0,
        metricMode: "vllm-compatible",
        outputTokenCountSource: "estimated",
        randomTokenMode: "benchtrace",
      });
      assert.equal(cv.verdict, "weakly_comparable");
      assert.ok(cv.notes.some((n) => /estimated/i.test(n)));
    },
  },

  // ─── Category 6: rendering labels the chunk-gap family honestly ────────
  {
    name: "label: metricFamilyView(native) → 'Mean chunk-gap latency' + warning",
    run() {
      const fam = metricFamilyView("native");
      assert.equal(fam.primary, "chunkGap");
      assert.equal(fam.primaryIsChunkGap, true);
      assert.equal(fam.chunkGapLabel, "Mean chunk-gap latency");
      assert.ok(fam.note && /not token-normalized|NOT token-normalized/i.test(fam.note));
    },
  },
  {
    name: "label: metricFamilyView(vllm-compatible) → token-norm TPOT, no caveat",
    run() {
      const fam = metricFamilyView("vllm-compatible");
      assert.equal(fam.primary, "tpot");
      assert.equal(fam.primaryIsChunkGap, false);
      assert.equal(fam.note, null);
    },
  },
  {
    name: "report: native markdown shows Chunk-gap p95 column + warning, never bare TPOT",
    run() {
      const md = buildMarkdownSummary(markdownInput("native"));
      assert.ok(md.includes("Chunk-gap p95 (ms)"), "native table must label the chunk-gap column");
      assert.ok(!md.includes("TPOT p95 (ms)"), "native table must not show a bare TPOT column");
      assert.ok(/chunk-gap latency/i.test(md), "native report must carry the chunk-gap caveat");
      // The native chunk-gap value (36), not the token-normalized TPOT (12).
      assert.ok(md.includes("36.0"), "native table should render the chunk-gap p95 value");
    },
  },
  {
    name: "report: vllm-compatible markdown shows TPOT p95, no chunk-gap caveat",
    run() {
      const md = buildMarkdownSummary(markdownInput("vllm-compatible"));
      assert.ok(md.includes("TPOT p95 (ms)"), "compat table must label the TPOT column");
      assert.ok(md.includes("12.0"), "compat table should render the token-normalized TPOT value");
    },
  },
  {
    name: "compare: emits 5 equivalence verdicts + final verdict from a reference bundle",
    async run() {
      const { compareRun } = await import("../../../scripts/compare-vllm-benchtrace");
      const out = compareRun({
        reference: {
          endpoint: "/v1/completions",
          requests: [{ promptTokenIds: [1, 2], maxTokens: 32, ignoreEos: true, temperature: 0, completionTokens: 32, promptText: null }],
          metrics: { outputThroughput: 78, totalOutputTokens: 32, totalInputTokens: 2, benchmarkDurationS: 1 },
          tool: "vllm", vllmVersion: "0.20.2",
        },
        benchtrace: {
          endpoint: "/v1/completions",
          fieldKeys: ["model", "prompt", "max_tokens", "temperature", "seed", "stream", "ignore_eos"],
          promptHashes: ["h"], requestedOutput: [32], actualOutputTokens: 32,
          acceptedTokensPerChunk: 1.75, metricFormulaOk: true,
        },
        referencePromptHashes: ["h"],
        referenceAcceptedTokensPerChunk: 1.75,
        // Explicit wire-capture field keys so the payload check sees true parity
        // (BenchTrace sends seed/stream too); proves the happy-path verdict.
        referenceFieldKeys: ["model", "prompt", "max_tokens", "temperature", "seed", "stream", "ignore_eos"],
      });
      assert.equal(out.finalVerdict, "strongly_comparable");
      assert.equal(out.verdicts.payload, true);
      assert.equal(out.verdicts.prompt, true);
      assert.equal(out.verdicts.outputLength, true);
      assert.equal(out.verdicts.outputTokens, true);
      assert.equal(out.verdicts.scheduling, true);
      assert.ok(typeof out.diffTable === "string");
    },
  },
];
