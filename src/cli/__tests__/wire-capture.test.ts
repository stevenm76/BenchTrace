// src/cli/__tests__/wire-capture.test.ts
import assert from "node:assert/strict";
import { recordExchange, buildBundle, extractLastUsage } from "../../../scripts/wire-capture-proxy";

export const tests = [
  {
    name: "wire-capture: records request bodies + usage into a bundle",
    async run() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store: any[] = [];
      recordExchange(store, {
        path: "/v1/completions",
        requestBody: { model: "m", prompt: [1, 2, 3], max_tokens: 32, ignore_eos: true, temperature: 0 },
        usage: { prompt_tokens: 3, completion_tokens: 32 },
      });
      const bundle = buildBundle(store, { tool: "vllm bench serve", vllmVersion: "0.20.2", endpoint: "/v1/completions" });
      assert.equal(bundle.requests.length, 1);
      assert.deepEqual(bundle.requests[0].prompt_token_ids, [1, 2, 3]);
      assert.equal(bundle.requests[0].completion_tokens, 32);
      assert.equal(bundle.metrics.total_output_tokens, 32);
    },
  },
  {
    name: "wire-capture: extractLastUsage handles nested usage fields (no regex truncation)",
    async run() {
      const body = JSON.stringify({
        choices: [],
        usage: {
          prompt_tokens: 7,
          completion_tokens: 32,
          total_tokens: 39,
          prompt_tokens_details: { cached_tokens: 4 },
        },
      });
      const usage = extractLastUsage(body);
      assert.equal(usage?.prompt_tokens, 7);
      assert.equal(usage?.completion_tokens, 32);
    },
  },
  {
    name: "wire-capture: extractLastUsage takes the final usage object from an SSE stream",
    async run() {
      const sse =
        'data: {"choices":[{"delta":{"content":"hi"}}],"usage":null}\n\n' +
        'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":11}}\n\n' +
        "data: [DONE]\n\n";
      const usage = extractLastUsage(sse);
      assert.equal(usage?.prompt_tokens, 5);
      assert.equal(usage?.completion_tokens, 11);
    },
  },
  {
    name: "wire-capture: extractLastUsage returns null when no usage present",
    async run() {
      assert.equal(extractLastUsage('{"choices":[]}'), null);
    },
  },
];
