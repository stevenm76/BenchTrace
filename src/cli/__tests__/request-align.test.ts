import assert from "node:assert/strict";
import { buildAlignedRequestBody } from "../runner/request";

export const tests = [
  {
    name: "request: aligned completions body matches vLLM's random-dataset wire (no temperature/seed)",
    async run() {
      // Live capture of `vllm bench serve --dataset-name random` shows the wire
      // body carries NO temperature and NO seed — the server samples at its
      // default. Forcing temperature:0 (greedy) raises spec-decode acceptance
      // and inflates throughput, so aligned mode must omit both to align.
      const body = buildAlignedRequestBody({
        model: "m", prompt: [1, 2, 3], maxTokens: 32,
        streaming: true, ignoreEos: true,
      });
      assert.deepEqual(body.prompt, [1, 2, 3]);
      assert.equal(body.ignore_eos, true);
      assert.deepEqual(body.stream_options, { include_usage: true });
      assert.ok(!("temperature" in body), "aligned body must not send temperature");
      assert.ok(!("seed" in body), "aligned body must not send seed");
      assert.ok(!("chat_template_kwargs" in body));
      const allowed = new Set([
        "model", "prompt", "max_tokens", "stream", "stream_options", "ignore_eos",
      ]);
      assert.ok(Object.keys(body).every((k) => allowed.has(k)));
    },
  },
  {
    name: "request: aligned body omits stream_options when streaming=false and ignore_eos when off",
    async run() {
      const body = buildAlignedRequestBody({
        model: "m", prompt: "hi", maxTokens: 32,
        streaming: false, ignoreEos: false,
      });
      assert.ok(!("stream_options" in body));
      assert.ok(!("ignore_eos" in body));
      assert.equal(body.stream, false);
    },
  },
  {
    name: "request: aligned body passes through a string prompt",
    async run() {
      const body = buildAlignedRequestBody({
        model: "m", prompt: "hello world", maxTokens: 16,
        streaming: true, ignoreEos: false,
      });
      assert.equal(body.prompt, "hello world");
      assert.ok(!("ignore_eos" in body));
    },
  },
  {
    name: "request: aligned body mirrors an explicit temperature (vllm --temperature 0)",
    async run() {
      // vllm bench serve omits temperature unless --temperature is passed; when
      // passed it lands on the wire. Mirror that: include temperature only when
      // a value is supplied (e.g. `--vllm-aligned --temperature 0` → greedy).
      const greedy = buildAlignedRequestBody({
        model: "m", prompt: [1, 2], maxTokens: 8,
        streaming: true, ignoreEos: true, temperature: 0,
      });
      assert.equal(greedy.temperature, 0, "explicit temperature must be sent");

      const sampled = buildAlignedRequestBody({
        model: "m", prompt: [1, 2], maxTokens: 8,
        streaming: true, ignoreEos: true, temperature: null,
      });
      assert.ok(!("temperature" in sampled), "null temperature must be omitted");
    },
  },
];
