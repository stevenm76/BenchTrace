// src/cli/__tests__/prompt-source.test.ts
import assert from "node:assert/strict";
import {
  buildAlignedPrompts,
  hashTokenIds,
  hashText,
  resolveEffectiveVocab,
} from "../runner/prompt-source";

export const tests = [
  {
    name: "resolveEffectiveVocab: CLI override wins over config and is tagged cli-override",
    async run() {
      const r = resolveEffectiveVocab(248320, 100000);
      assert.equal(r.vocabSize, 248320);
      assert.equal(r.tokenizerSource, "cli-override");
    },
  },
  {
    name: "resolveEffectiveVocab: falls back to config vocab when no override",
    async run() {
      const r = resolveEffectiveVocab(null, 151936);
      assert.equal(r.vocabSize, 151936);
      assert.equal(r.tokenizerSource, "config");
    },
  },
  {
    name: "resolveEffectiveVocab: null/null when neither source is known",
    async run() {
      const r = resolveEffectiveVocab(undefined, null);
      assert.equal(r.vocabSize, null);
      assert.equal(r.tokenizerSource, null);
    },
  },
  {
    name: "resolveEffectiveVocab: rejects non-positive override and uses config",
    async run() {
      const r = resolveEffectiveVocab(0, 248320);
      assert.equal(r.vocabSize, 248320);
      assert.equal(r.tokenizerSource, "config");
    },
  },
  {
    name: "prompt-source: independent mode samples ids within [0,vocab) and is seed-deterministic",
    async run() {
      const a = buildAlignedPrompts({ mode: "independent", seed: 7, count: 3, inputLen: 16, vocabSize: 1000, outputLen: 32 });
      const b = buildAlignedPrompts({ mode: "independent", seed: 7, count: 3, inputLen: 16, vocabSize: 1000, outputLen: 32 });
      assert.equal(a.prompts.length, 3);
      assert.equal(a.prompts[0]!.tokenIds.length, 16);
      assert.ok(a.prompts[0]!.tokenIds.every((t) => t >= 0 && t < 1000));
      assert.deepEqual(a.prompts.map((p) => p.hash), b.prompts.map((p) => p.hash));
      assert.equal(a.prompts[0]!.requestedOutputLen, 32);
      const c = buildAlignedPrompts({ mode: "independent", seed: 8, count: 3, inputLen: 16, vocabSize: 1000, outputLen: 32 });
      assert.notDeepEqual(a.prompts.map((p) => p.hash), c.prompts.map((p) => p.hash));
    },
  },
  {
    name: "prompt-source: replay mode returns the exact reference ids and hashes match",
    async run() {
      const ref = [{ tokenIds: [5, 6, 7], outputLen: 32 }, { tokenIds: [8, 9], outputLen: 16 }];
      const r = buildAlignedPrompts({ mode: "replay", reference: ref });
      assert.deepEqual(r.prompts[0]!.tokenIds, [5, 6, 7]);
      assert.equal(r.prompts[1]!.requestedOutputLen, 16);
      assert.equal(r.prompts[0]!.hash, hashTokenIds([5, 6, 7]));
      assert.equal(r.prompts[0]!.text, null);
    },
  },
  {
    name: "prompt-source: replay mode carries text prompts verbatim with text hash",
    async run() {
      // vLLM's `random` dataset sends re-tokenized decoded STRINGS on the wire,
      // not token-id arrays. Replaying those exact strings is the only way to
      // reproduce vLLM's effective prompt (and its spec-decode acceptance).
      const ref = [
        { text: "hello world prompt", outputLen: 128 },
        { text: "another decoded prompt", outputLen: 64 },
      ];
      const r = buildAlignedPrompts({ mode: "replay", reference: ref });
      assert.equal(r.prompts[0]!.text, "hello world prompt");
      assert.deepEqual(r.prompts[0]!.tokenIds, []);
      assert.equal(r.prompts[0]!.requestedOutputLen, 128);
      assert.equal(r.prompts[0]!.hash, hashText("hello world prompt"));
      assert.equal(r.prompts[1]!.text, "another decoded prompt");
    },
  },
];
