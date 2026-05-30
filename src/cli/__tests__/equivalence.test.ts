import assert from "node:assert/strict";
import { parseReferenceBundle } from "@/lib/align/reference-bundle";

export const tests = [
  {
    name: "reference-bundle: parses captured requests + metrics",
    async run() {
      const raw = JSON.stringify({
        tool: "vllm bench serve",
        vllm_version: "0.20.2",
        endpoint: "/v1/completions",
        requests: [
          { prompt_token_ids: [1, 2, 3], max_tokens: 32, ignore_eos: true,
            temperature: 0, completion_tokens: 32 },
        ],
        metrics: { output_throughput: 78.29, total_output_tokens: 640 },
      });
      const b = parseReferenceBundle(raw);
      assert.equal(b.endpoint, "/v1/completions");
      assert.equal(b.requests.length, 1);
      assert.deepEqual(b.requests[0]!.promptTokenIds, [1, 2, 3]);
      assert.equal(b.requests[0]!.completionTokens, 32);
      assert.equal(b.metrics.totalOutputTokens, 640);
    },
  },
  {
    name: "reference-bundle: rejects a bundle with no requests",
    async run() {
      assert.throws(() => parseReferenceBundle(JSON.stringify({ requests: [] })));
    },
  },
  {
    name: "equivalence: hash-identical prompts + matching tokens → strong",
    async run() {
      const { computeEquivalence } = await import("@/lib/align/equivalence");
      const v = computeEquivalence({
        endpointBt: "/v1/completions",
        endpointRef: "/v1/completions",
        btFieldKeys: ["model", "prompt", "max_tokens", "temperature", "stream", "ignore_eos"],
        refFieldKeys: ["model", "prompt", "max_tokens", "temperature", "stream", "ignore_eos"],
        promptHashesBt: ["a", "b"],
        promptHashesRef: ["a", "b"],
        requestedOutputBt: [32, 32],
        requestedOutputRef: [32, 32],
        actualOutputTokensBt: 64,
        actualOutputTokensRef: 64,
        acceptedTokensPerChunkBt: 1.75,
        acceptedTokensPerChunkRef: 1.75,
        metricFormulaOk: true,
        tolerance: { outputTokensPct: 2, acceptedTokensPct: 10 },
      });
      assert.equal(v.samePromptBytes, true);
      assert.equal(v.sameOutputTokens, true);
      assert.equal(v.verdict, "strongly_comparable");
    },
  },
  {
    name: "equivalence: extra BenchTrace field → not strong",
    async run() {
      const { computeEquivalence } = await import("@/lib/align/equivalence");
      const v = computeEquivalence({
        endpointBt: "/v1/completions", endpointRef: "/v1/completions",
        btFieldKeys: ["model", "prompt", "max_tokens", "chat_template_kwargs"],
        refFieldKeys: ["model", "prompt", "max_tokens"],
        promptHashesBt: ["a"], promptHashesRef: ["a"],
        requestedOutputBt: [32], requestedOutputRef: [32],
        actualOutputTokensBt: 32, actualOutputTokensRef: 32,
        acceptedTokensPerChunkBt: 1.75, acceptedTokensPerChunkRef: 1.75,
        metricFormulaOk: true,
        tolerance: { outputTokensPct: 2, acceptedTokensPct: 10 },
      });
      assert.equal(v.samePayloadFields, false);
      assert.notEqual(v.verdict, "strongly_comparable");
    },
  },
  {
    name: "equivalence: spec-decode acceptance gap caps at not_comparable",
    async run() {
      const { computeEquivalence } = await import("@/lib/align/equivalence");
      const v = computeEquivalence({
        endpointBt: "/v1/completions", endpointRef: "/v1/completions",
        btFieldKeys: ["model", "prompt", "max_tokens"],
        refFieldKeys: ["model", "prompt", "max_tokens"],
        // Identical prompts so the ONLY failing check is the acceptance gap —
        // proves the spec-decode guardrail forces not_comparable on its own.
        promptHashesBt: ["x"], promptHashesRef: ["x"],
        requestedOutputBt: [32], requestedOutputRef: [32],
        actualOutputTokensBt: 32, actualOutputTokensRef: 32,
        acceptedTokensPerChunkBt: 2.53, acceptedTokensPerChunkRef: 1.75,
        metricFormulaOk: true,
        tolerance: { outputTokensPct: 2, acceptedTokensPct: 10 },
      });
      assert.equal(v.samePromptBytes, true);
      assert.equal(v.sameAcceptedTokensPerChunk, false);
      assert.equal(v.verdict, "not_comparable");
    },
  },
  {
    name: "equivalence: byte-identical prompts but unmeasured acceptance → not strong",
    async run() {
      const { computeEquivalence } = await import("@/lib/align/equivalence");
      const v = computeEquivalence({
        endpointBt: "/v1/completions", endpointRef: "/v1/completions",
        btFieldKeys: ["model", "prompt", "max_tokens"],
        refFieldKeys: ["model", "prompt", "max_tokens"],
        promptHashesBt: ["x"], promptHashesRef: ["x"],
        requestedOutputBt: [32], requestedOutputRef: [32],
        actualOutputTokensBt: 32, actualOutputTokensRef: 32,
        // Acceptance unmeasured on the reference side — strong throughput/TPOT
        // parity cannot be PROVEN, so the verdict must drop to weakly.
        acceptedTokensPerChunkBt: 1.75, acceptedTokensPerChunkRef: null,
        metricFormulaOk: true,
        tolerance: { outputTokensPct: 2, acceptedTokensPct: 10 },
      });
      assert.equal(v.samePromptBytes, true);
      assert.equal(v.sameAcceptedTokensPerChunk, null);
      assert.equal(v.verdict, "weakly_comparable");
      assert.ok(v.notes.some((n) => /accepted-tokens\/chunk not measured/.test(n)));
    },
  },
  {
    name: "equivalence: no reference (null hashes) cannot be strong",
    async run() {
      const { computeEquivalence } = await import("@/lib/align/equivalence");
      const v = computeEquivalence({
        endpointBt: "/v1/completions", endpointRef: null,
        btFieldKeys: ["model", "prompt", "max_tokens"], refFieldKeys: null,
        promptHashesBt: ["a"], promptHashesRef: null,
        requestedOutputBt: [32], requestedOutputRef: null,
        actualOutputTokensBt: 32, actualOutputTokensRef: null,
        acceptedTokensPerChunkBt: 1.75, acceptedTokensPerChunkRef: null,
        metricFormulaOk: true,
        tolerance: { outputTokensPct: 2, acceptedTokensPct: 10 },
      });
      assert.equal(v.verdict, "weakly_comparable");
    },
  },
];
