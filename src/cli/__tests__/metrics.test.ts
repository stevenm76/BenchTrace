import assert from "node:assert/strict";

import {
  computeMeanChunkGapMs,
  computeTpotMs,
  computeVllmCompatTpotMs,
  resolveOutputTokens,
} from "../runner/metrics";

export const tests = [
  // ─── resolveOutputTokens precedence ──────────────────────────────────
  {
    name: "resolveOutputTokens: usage wins regardless of mode (native)",
    run() {
      const n = resolveOutputTokens({
        mode: "native",
        fromUsage: 42,
        expected: 100,
      });
      assert.equal(n, 42);
    },
  },
  {
    name: "resolveOutputTokens: usage wins regardless of mode (vllm)",
    run() {
      const n = resolveOutputTokens({
        mode: "vllm-compatible",
        fromUsage: 42,
        expected: 100,
      });
      assert.equal(n, 42);
    },
  },
  {
    name: "resolveOutputTokens: native + no usage → null",
    run() {
      const n = resolveOutputTokens({
        mode: "native",
        fromUsage: null,
        expected: 100,
      });
      assert.equal(n, null);
    },
  },
  {
    name: "resolveOutputTokens: vllm + no usage → expected (the fallback)",
    run() {
      const n = resolveOutputTokens({
        mode: "vllm-compatible",
        fromUsage: null,
        expected: 100,
      });
      assert.equal(n, 100);
    },
  },
  {
    name: "resolveOutputTokens: usage=0 is a real value, not missing",
    run() {
      // Edge case: zero-token completions are legal (immediate stop).
      // The fallback should not trigger when the server explicitly reported 0.
      const n = resolveOutputTokens({
        mode: "vllm-compatible",
        fromUsage: 0,
        expected: 100,
      });
      assert.equal(n, 0);
    },
  },

  // ─── vllm-compatible TPOT formula ────────────────────────────────────
  {
    name: "vllm: outputTokens=1 → 0 (zero decode tokens after the first)",
    run() {
      const tpot = computeTpotMs("vllm-compatible", {
        e2eMs: 100,
        ttftMs: 50,
        outputTokens: 1,
        chunkGapsMs: [],
      });
      assert.equal(tpot, 0);
    },
  },
  {
    name: "vllm: outputTokens=2, e2e=100, ttft=50 → 50/(2-1)=50",
    run() {
      const tpot = computeTpotMs("vllm-compatible", {
        e2eMs: 100,
        ttftMs: 50,
        outputTokens: 2,
        chunkGapsMs: [],
      });
      assert.equal(tpot, 50);
    },
  },
  {
    name: "vllm: outputTokens=11, e2e=110, ttft=10 → 100/10=10",
    run() {
      const tpot = computeTpotMs("vllm-compatible", {
        e2eMs: 110,
        ttftMs: 10,
        outputTokens: 11,
        chunkGapsMs: [],
      });
      assert.equal(tpot, 10);
    },
  },
  {
    name: "vllm: outputTokens=null → null (cannot compute without count)",
    run() {
      const tpot = computeTpotMs("vllm-compatible", {
        e2eMs: 100,
        ttftMs: 10,
        outputTokens: null,
        chunkGapsMs: [10, 20, 30],
      });
      assert.equal(tpot, null);
    },
  },
  {
    name: "vllm: ttftMs=null → null",
    run() {
      const tpot = computeTpotMs("vllm-compatible", {
        e2eMs: 100,
        ttftMs: null,
        outputTokens: 5,
        chunkGapsMs: [],
      });
      assert.equal(tpot, null);
    },
  },
  {
    name: "vllm: ignores chunkGapsMs entirely",
    run() {
      // If the formula accidentally fell back to mean-of-gaps, this would
      // return 25; vLLM formula must return decode/(n-1) = 50/4 = 12.5.
      const tpot = computeTpotMs("vllm-compatible", {
        e2eMs: 70,
        ttftMs: 20,
        outputTokens: 5,
        chunkGapsMs: [10, 20, 30, 40],
      });
      assert.equal(tpot, 12.5);
    },
  },
  {
    name: "vllm: chunk≠token regression — 5 chunks delivering 10 tokens",
    run() {
      // Server packed 2 tokens per chunk: 5 chunks, 4 gaps of 100 ms each.
      // Native (mean-of-gaps) would say 100. vLLM (decode/9) says ~44.4.
      // This is the headline divergence we set out to fix.
      const tpot = computeTpotMs("vllm-compatible", {
        e2eMs: 500,
        ttftMs: 100,
        outputTokens: 10,
        chunkGapsMs: [100, 100, 100, 100],
      });
      assert.ok(Math.abs(tpot! - 400 / 9) < 1e-9);
    },
  },

  // ─── native TPOT formula ──────────────────────────────────────────────
  {
    name: "native: mean of chunk gaps",
    run() {
      const tpot = computeTpotMs("native", {
        e2eMs: 9999,
        ttftMs: 9999,
        outputTokens: 9999,
        chunkGapsMs: [10, 20, 30, 40],
      });
      assert.equal(tpot, 25);
    },
  },
  {
    name: "native: empty chunk gaps → null",
    run() {
      const tpot = computeTpotMs("native", {
        e2eMs: 100,
        ttftMs: 50,
        outputTokens: 1,
        chunkGapsMs: [],
      });
      assert.equal(tpot, null);
    },
  },
  {
    name: "native: outputTokens irrelevant — depends only on chunkGapsMs",
    run() {
      // Same chunkGapsMs with different outputTokens — should produce
      // identical result. (vllm-compatible would not.)
      const a = computeTpotMs("native", {
        e2eMs: 100,
        ttftMs: 10,
        outputTokens: 5,
        chunkGapsMs: [5, 5, 5, 5],
      });
      const b = computeTpotMs("native", {
        e2eMs: 100,
        ttftMs: 10,
        outputTokens: 50,
        chunkGapsMs: [5, 5, 5, 5],
      });
      assert.equal(a, 5);
      assert.equal(b, 5);
    },
  },

  // ─── MTP / speculative decoding: ~3 tokens per chunk ──────────────────
  // The defining problem this whole patch exists to solve. When the server
  // packs ~3 tokens per SSE chunk, the native chunk-gap runs ~3× the
  // token-normalized TPOT for the SAME run. The two must NOT be conflated,
  // and the ~3× gap is correct behavior — not a regression to "fix" by
  // making the numbers match.
  {
    name: "MTP: native chunk-gap is ~3× the token-normalized TPOT (same run)",
    run() {
      // 99 output tokens delivered in 33 chunks of 3 tokens each → 32 gaps.
      // Decode wall-time = e2e - ttft = 960 ms.
      // Each chunk gap ≈ 960/32 = 30 ms (one gap per chunk after the first).
      const ttftMs = 40;
      const e2eMs = 1000;
      const outputTokens = 99;
      const gapCount = 32; // 33 chunks - 1
      const chunkGapsMs = Array.from({ length: gapCount }, () => (e2eMs - ttftMs) / gapCount);

      const chunkGap = computeMeanChunkGapMs(chunkGapsMs)!;
      const tpot = computeVllmCompatTpotMs({ e2eMs, ttftMs, outputTokens })!;

      // Token-normalized TPOT spreads decode time over (99-1) tokens.
      assert.ok(Math.abs(tpot - (e2eMs - ttftMs) / (outputTokens - 1)) < 1e-9);
      // chunk-gap spreads the same decode time over only 32 gaps → ~3× higher.
      const ratio = chunkGap / tpot;
      assert.ok(
        ratio > 2.5 && ratio < 3.5,
        `expected chunk-gap ≈ 3× TPOT for 3-tokens/chunk, got ratio ${ratio.toFixed(2)}`,
      );
    },
  },
  {
    name: "MTP: the ~3× gap is NOT a regression — 1 token/chunk gives ratio ≈ 1",
    run() {
      // Same decode budget, but the server emits 1 token per chunk (no MTP):
      // 99 tokens → 99 chunks → 98 gaps. Now chunk-gap ≈ TPOT (ratio ~1).
      // Proves the divergence is caused by chunk packing, not a bug.
      const ttftMs = 40;
      const e2eMs = 1000;
      const outputTokens = 99;
      const gapCount = outputTokens - 1; // one chunk per token
      const chunkGapsMs = Array.from({ length: gapCount }, () => (e2eMs - ttftMs) / gapCount);

      const chunkGap = computeMeanChunkGapMs(chunkGapsMs)!;
      const tpot = computeVllmCompatTpotMs({ e2eMs, ttftMs, outputTokens })!;
      const ratio = chunkGap / tpot;
      assert.ok(
        Math.abs(ratio - 1) < 0.05,
        `expected chunk-gap ≈ TPOT for 1-token/chunk, got ratio ${ratio.toFixed(3)}`,
      );
    },
  },
];
