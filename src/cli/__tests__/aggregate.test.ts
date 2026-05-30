import assert from "node:assert/strict";

import { aggregateLevel, percentile, rollupSweep } from "../runner/aggregate";
import type { RequestResult } from "../runner/request";

function mkResult(input: {
  ttftMs: number;
  tpotMs: number | null;
  success?: boolean;
  inputTokens?: number | null;
  outputTokens?: number;
}): RequestResult {
  return {
    requestId: "r",
    streamLevel: 1,
    startMs: 0,
    firstTokenMs: input.ttftMs,
    endMs: input.ttftMs + 100,
    success: input.success ?? true,
    errorKind: null,
    errorMessage: null,
    inputTokens: input.inputTokens === undefined ? 64 : input.inputTokens,
    outputTokens: input.outputTokens ?? 16,
    outputTokenCountSource: "server_usage",
    ttftMs: input.ttftMs,
    e2eLatencyMs: input.ttftMs + 100,
    interTokenLatenciesMs: input.tpotMs == null ? [] : Array(15).fill(input.tpotMs),
    tpotMs: input.tpotMs,
    meanChunkGapMs: input.tpotMs,
    tpotMsVllmCompat: input.tpotMs,
    chunkCount: input.tpotMs == null ? 0 : 16,
    tokensPerChunk: input.tpotMs == null ? null : 1,
    outputTokensPerSecond: 100,
  };
}

export const tests = [
  {
    name: "percentile interpolates",
    run() {
      assert.equal(percentile([], 0.5), null);
      assert.equal(percentile([5], 0.5), 5);
      assert.equal(percentile([10, 20, 30, 40, 50], 0.5), 30);
      const p95 = percentile([10, 20, 30, 40, 50], 0.95);
      assert.ok(p95 != null && p95 > 45 && p95 <= 50);
    },
  },
  {
    name: "aggregateLevel marks SLA-passing run as valid",
    run() {
      const results = [
        mkResult({ ttftMs: 100, tpotMs: 5 }),
        mkResult({ ttftMs: 120, tpotMs: 6 }),
        mkResult({ ttftMs: 150, tpotMs: 8 }),
      ];
      const agg = aggregateLevel(
        4,
        results,
        { ttftSlaMs: 5000, tpotSlaMs: 100, failureThreshold: 0.05 },
        0,
        1000,
      );
      assert.equal(agg.requestCount, 3);
      assert.equal(agg.successfulRequests, 3);
      assert.equal(agg.failedRequests, 0);
      assert.equal(agg.isValid, true);
      assert.equal(agg.invalidReasons.length, 0);
    },
  },
  {
    name: "aggregateLevel flags TTFT SLA breach",
    run() {
      const results = [
        mkResult({ ttftMs: 6000, tpotMs: 5 }),
        mkResult({ ttftMs: 7000, tpotMs: 5 }),
      ];
      const agg = aggregateLevel(
        16,
        results,
        { ttftSlaMs: 5000, tpotSlaMs: 100, failureThreshold: 0.05 },
        0,
        2000,
      );
      assert.equal(agg.isValid, false);
      assert.ok(agg.invalidReasons.some((r) => r.startsWith("p95_ttft_ms")));
    },
  },
  {
    name: "rollupSweep picks max valid concurrency",
    run() {
      const goodResults = (count: number) =>
        Array.from({ length: count }, () => mkResult({ ttftMs: 100, tpotMs: 5 }));
      const lvl1 = aggregateLevel(1, goodResults(5), { ttftSlaMs: 5000, tpotSlaMs: 100, failureThreshold: 0.05 }, 0, 1000);
      const lvl8 = aggregateLevel(8, goodResults(5), { ttftSlaMs: 5000, tpotSlaMs: 100, failureThreshold: 0.05 }, 0, 1000);
      const lvl32 = aggregateLevel(32, [
        mkResult({ ttftMs: 6000, tpotMs: 5 }),
        mkResult({ ttftMs: 7000, tpotMs: 5 }),
      ], { ttftSlaMs: 5000, tpotSlaMs: 100, failureThreshold: 0.05 }, 0, 1000);
      const sweep = rollupSweep([lvl1, lvl8, lvl32]);
      assert.equal(sweep.maxValidConcurrency, 8);
      assert.deepEqual(sweep.invalidLevels.map((l) => l.streamLevel), [32]);
    },
  },
  {
    name: "prefillTokensPerSecond sum form: 1024 tokens / 0.8s = 1280 tok/s",
    run() {
      const ttftSlaMs = 5000;
      const tpotSlaMs = 100;
      const failureThreshold = 0.05;
      const results = [
        mkResult({ ttftMs: 200, tpotMs: 10, inputTokens: 256 }),
        mkResult({ ttftMs: 200, tpotMs: 10, inputTokens: 256 }),
        mkResult({ ttftMs: 400, tpotMs: 10, inputTokens: 512 }),
      ];
      const agg = aggregateLevel(
        1,
        results,
        { ttftSlaMs, tpotSlaMs, failureThreshold },
        0,
        10_000,
      );
      assert.ok(
        agg.prefillTokensPerSecond != null,
        "expected prefill rate to be computed, got null",
      );
      assert.ok(
        Math.abs(agg.prefillTokensPerSecond - 1280) < 0.1,
        "expected ~1280, got " + agg.prefillTokensPerSecond,
      );
    },
  },
  {
    name: "prefillTokensPerSecond is null when there are no successful requests",
    run() {
      const results = [
        mkResult({ ttftMs: 200, tpotMs: 10, success: false }),
      ];
      const agg = aggregateLevel(
        1,
        results,
        { ttftSlaMs: 5000, tpotSlaMs: 100, failureThreshold: 1 },
        0,
        1000,
      );
      assert.equal(agg.prefillTokensPerSecond, null);
    },
  },
  {
    name: "prefillTokensPerSecond is null when all input_tokens are null",
    run() {
      const results = [
        mkResult({ ttftMs: 200, tpotMs: 10, inputTokens: null }),
        mkResult({ ttftMs: 200, tpotMs: 10, inputTokens: null }),
      ];
      const agg = aggregateLevel(
        1,
        results,
        { ttftSlaMs: 5000, tpotSlaMs: 100, failureThreshold: 0.05 },
        0,
        1000,
      );
      assert.equal(agg.prefillTokensPerSecond, null);
    },
  },
  {
    name: "prefillTokensPerSecond filters out null-input requests from BOTH numerator and denominator",
    run() {
      // Two requests have known input_tokens, one has null. The null
      // request's TTFT must NOT be in the denominator.
      const results = [
        mkResult({ ttftMs: 200, tpotMs: 10, inputTokens: 256 }),
        mkResult({ ttftMs: 200, tpotMs: 10, inputTokens: 256 }),
        mkResult({ ttftMs: 400, tpotMs: 10, inputTokens: null }),
      ];
      const agg = aggregateLevel(
        1,
        results,
        { ttftSlaMs: 5000, tpotSlaMs: 100, failureThreshold: 0.05 },
        0,
        10_000,
      );
      // Correct: 512 tokens / 0.4s = 1280 tok/s.
      // Buggy:   512 tokens / 0.8s = 640 tok/s (would include null
      // request's TTFT in denominator).
      assert.ok(
        agg.prefillTokensPerSecond != null,
        "expected rate to be computed, got null",
      );
      assert.ok(
        Math.abs(agg.prefillTokensPerSecond - 1280) < 0.1,
        "expected 1280 (filtering null-input out of denominator), got " +
          agg.prefillTokensPerSecond,
      );
    },
  },
];
