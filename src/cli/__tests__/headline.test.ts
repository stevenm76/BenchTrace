import assert from "node:assert/strict";

import { BENCHMARK_PROFILES } from "../../lib/benchmark-profiles";
import type { LevelAggregate, SweepResult } from "../runner/aggregate";
import {
  formatConcurrencyLabel,
  formatProfileHeadline,
  pickHeadlineLevel,
} from "../runner/headline";

/**
 * Build a minimal LevelAggregate with the fields the formatter reads.
 * Anything not specified defaults to a benign zero / null.
 */
function mkLevel(overrides: Partial<LevelAggregate>): LevelAggregate {
  return {
    streamLevel: 1,
    requestCount: 0,
    successfulRequests: 0,
    failedRequests: 0,
    failureRate: 0,
    outputTokensPerSecond: null,
    totalTokensPerSecond: null,
    prefillTokensPerSecond: null,
    requestsPerSecond: 0,
    p50TtftMs: null,
    p95TtftMs: null,
    p99TtftMs: null,
    p50TpotMs: null,
    p95TpotMs: null,
    p99TpotMs: null,
    p50TpotVllmCompatMs: null,
    p95TpotVllmCompatMs: null,
    p99TpotVllmCompatMs: null,
    p50ChunkGapMs: null,
    p95ChunkGapMs: null,
    p99ChunkGapMs: null,
    meanChunksPerRequest: null,
    meanTokensPerChunk: null,
    outputTokenCountSource: "unknown",
    p50ItlMs: null,
    p95ItlMs: null,
    p99ItlMs: null,
    p50E2eLatencyMs: null,
    p95E2eLatencyMs: null,
    p99E2eLatencyMs: null,
    peakVramGb: null,
    averageVramGb: null,
    gpuUtilizationAvg: null,
    gpuUtilizationPeak: null,
    powerDrawWattsAvg: null,
    powerDrawWattsPeak: null,
    gpuTemperatureAvg: null,
    gpuTemperaturePeak: null,
    tokensPerWatt: null,
    durationSeconds: 0,
    isValid: true,
    meetsTtftSla: true,
    meetsTpotSla: true,
    meetsFailureSla: true,
    invalidReasons: [],
    ...overrides,
  };
}

function mkSweep(levels: LevelAggregate[], maxValid: number | null): SweepResult {
  return {
    perLevel: levels,
    bestOutputTokensPerSecond: null,
    bestTotalTokensPerSecond: null,
    bestPrefillTokensPerSecond: null,
    maxValidConcurrency: maxValid,
    outputTpsAtMaxValid: null,
    p95TtftAtMaxValid: null,
    p95TpotAtMaxValid: null,
    invalidLevels: [],
    warnings: [],
    totalDurationSeconds: 0,
  };
}

export const tests = [
  {
    name: "single_user headline shows TTFT p95 + output tok/s",
    run() {
      const lvl = mkLevel({
        streamLevel: 1,
        successfulRequests: 50,
        requestCount: 50,
        p95TtftMs: 412,
        outputTokensPerSecond: 137,
      });
      const out = formatProfileHeadline(
        BENCHMARK_PROFILES["BT-CHAT-001"],
        mkSweep([lvl], 1),
      );
      assert.match(out, /412 ms TTFT p95/);
      assert.match(out, /137\.0 tok\/s @ c=1/);
      assert.match(out, /50\/50 ok/);
    },
  },
  {
    name: "coding_agent headline shows prefill + decode",
    run() {
      const lvl = mkLevel({
        streamLevel: 1,
        successfulRequests: 25,
        requestCount: 25,
        prefillTokensPerSecond: 980,
        outputTokensPerSecond: 137,
      });
      const out = formatProfileHeadline(
        BENCHMARK_PROFILES["BT-CODE-001"],
        mkSweep([lvl], 1),
      );
      assert.match(out, /prefill 980 tok\/s/);
      assert.match(out, /decode 137\.0 tok\/s @ c=1/);
      assert.match(out, /25\/25 ok/);
    },
  },
  {
    name: "batch headline shows total tok/s + failure_rate",
    run() {
      const lvl = mkLevel({
        streamLevel: 32,
        successfulRequests: 200,
        requestCount: 200,
        totalTokensPerSecond: 423.5,
        failureRate: 0,
      });
      const out = formatProfileHeadline(
        BENCHMARK_PROFILES["BT-BATCH-001"],
        mkSweep([lvl], 32),
      );
      assert.match(out, /total 423\.5 tok\/s @ c=32/);
      assert.match(out, /200\/200 ok/);
      assert.match(out, /failure_rate 0\.0%/);
    },
  },
  {
    name: "long_context headline shows prefill + decode + peak VRAM",
    run() {
      const lvl = mkLevel({
        streamLevel: 1,
        successfulRequests: 10,
        requestCount: 10,
        prefillTokensPerSecond: 23,
        outputTokensPerSecond: 5,
        peakVramGb: 30.5,
      });
      const out = formatProfileHeadline(
        BENCHMARK_PROFILES["BT-LONGCTX-001"],
        mkSweep([lvl], 1),
      );
      assert.match(out, /prefill 23 tok\/s/);
      assert.match(out, /decode 5\.0 tok\/s/);
      assert.match(out, /peak VRAM 30\.5 GB/);
      assert.match(out, /10\/10 ok/);
    },
  },
  {
    name: "serving headline shows max valid + tok/s at that level",
    run() {
      const l1 = mkLevel({ streamLevel: 1, successfulRequests: 100, requestCount: 100, outputTokensPerSecond: 137 });
      const l8 = mkLevel({ streamLevel: 8, successfulRequests: 300, requestCount: 300, outputTokensPerSecond: 423.5 });
      const out = formatProfileHeadline(
        BENCHMARK_PROFILES["BT-SERVE-001"],
        mkSweep([l1, l8], 8),
      );
      assert.match(out, /max valid = 8/);
      assert.match(out, /423\.5 tok\/s @ c=8/);
      assert.match(out, /400\/400 ok/);
    },
  },
  {
    name: "prefill_decode_split headline shows prefill + decode",
    run() {
      const lvl = mkLevel({
        streamLevel: 1,
        successfulRequests: 25,
        requestCount: 25,
        prefillTokensPerSecond: 980,
        outputTokensPerSecond: 137,
      });
      const out = formatProfileHeadline(
        BENCHMARK_PROFILES["BT-PREFILL-DECODE-001"],
        mkSweep([lvl], 1),
      );
      assert.match(out, /prefill 980 tok\/s/);
      assert.match(out, /decode 137\.0 tok\/s @ c=1/);
      assert.match(out, /25\/25 ok/);
    },
  },
  {
    name: "headline with no levels says 'no levels completed'",
    run() {
      const out = formatProfileHeadline(
        BENCHMARK_PROFILES["BT-CHAT-001"],
        mkSweep([], null),
      );
      assert.equal(out, "no levels completed");
    },
  },
  {
    name: "formatConcurrencyLabel single level",
    run() {
      assert.equal(formatConcurrencyLabel([1]), "c=1");
      assert.equal(formatConcurrencyLabel([32]), "c=32");
    },
  },
  {
    name: "formatConcurrencyLabel sweep range",
    run() {
      assert.equal(formatConcurrencyLabel([1, 2, 4, 8]), "c=1-8");
    },
  },
  {
    name: "formatConcurrencyLabel sorts unordered input",
    run() {
      assert.equal(formatConcurrencyLabel([8, 1, 4, 2]), "c=1-8");
    },
  },
  {
    name: "formatConcurrencyLabel empty input",
    run() {
      assert.equal(formatConcurrencyLabel([]), "c=?");
    },
  },
  {
    name: "pickHeadlineLevel serving: returns level matching maxValidConcurrency",
    run() {
      const l1 = mkLevel({ streamLevel: 1 });
      const l4 = mkLevel({ streamLevel: 4 });
      const l8 = mkLevel({ streamLevel: 8 });
      const picked = pickHeadlineLevel(
        BENCHMARK_PROFILES["BT-SERVE-001"],
        mkSweep([l1, l4, l8], 4),
      );
      assert.equal(picked?.streamLevel, 4);
    },
  },
  {
    name: "pickHeadlineLevel serving with no maxValid falls back to first level",
    run() {
      const l1 = mkLevel({ streamLevel: 1 });
      const picked = pickHeadlineLevel(
        BENCHMARK_PROFILES["BT-SERVE-001"],
        mkSweep([l1], null),
      );
      assert.equal(picked?.streamLevel, 1);
    },
  },
  {
    name: "pickHeadlineLevel non-serving: returns first level",
    run() {
      const l1 = mkLevel({ streamLevel: 1 });
      const picked = pickHeadlineLevel(
        BENCHMARK_PROFILES["BT-CHAT-001"],
        mkSweep([l1], 1),
      );
      assert.equal(picked?.streamLevel, 1);
    },
  },
  {
    name: "pickHeadlineLevel with no levels returns null",
    run() {
      const picked = pickHeadlineLevel(
        BENCHMARK_PROFILES["BT-CHAT-001"],
        mkSweep([], null),
      );
      assert.equal(picked, null);
    },
  },
  {
    name: "single_user headline reflects --streams override (c=2)",
    run() {
      const lvl = mkLevel({
        streamLevel: 2,
        successfulRequests: 50,
        requestCount: 50,
        p95TtftMs: 412,
        outputTokensPerSecond: 137,
      });
      const out = formatProfileHeadline(
        BENCHMARK_PROFILES["BT-CHAT-001"],
        mkSweep([lvl], 2),
      );
      assert.match(out, /@ c=2/);
      assert.equal(out.includes("@ c=1"), false, "should not say c=1 when actual is c=2");
    },
  },
];
