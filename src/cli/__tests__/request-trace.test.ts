// src/cli/__tests__/request-trace.test.ts
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeRequestTrace, normalizeTrace } from "../runner/request-trace";

export const tests = [
  {
    name: "request-trace: normalizes and writes one json per request",
    async run() {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bt-trace-"));
      const t = normalizeTrace({
        requestId: "r1", endpoint: "/v1/completions",
        body: { model: "m", prompt: [1, 2], max_tokens: 32 },
        promptHash: "abc", requestedOutputLen: 32,
        scheduledMs: 1, sentMs: 2, firstTokenMs: 5, completeMs: 40,
        actualOutputTokens: 32, actualChunks: 18,
        usage: { prompt_tokens: 2, completion_tokens: 32 },
      });
      assert.deepEqual(t.bodyFieldKeys, ["model", "prompt", "max_tokens"]);
      assert.equal(t.promptHash, "abc");
      await writeRequestTrace(dir, t);
      const written = JSON.parse(await fs.readFile(path.join(dir, "r1.json"), "utf8"));
      assert.equal(written.requestId, "r1");
      assert.equal(written.actualOutputTokens, 32);
    },
  },
];
