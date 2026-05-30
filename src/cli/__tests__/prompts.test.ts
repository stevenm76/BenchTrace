import assert from "node:assert/strict";

import { generatePrompts, syntheticPrompt } from "../runner/prompts";

export const tests = [
  {
    name: "same seed + index yields the same prompt",
    run() {
      const a = syntheticPrompt(42, 0, 256);
      const b = syntheticPrompt(42, 0, 256);
      assert.equal(a, b);
    },
  },
  {
    name: "different indices yield different prompts",
    run() {
      const a = syntheticPrompt(42, 0, 256);
      const b = syntheticPrompt(42, 1, 256);
      assert.notEqual(a, b);
    },
  },
  {
    name: "generatePrompts produces the requested count",
    run() {
      const xs = generatePrompts(7, 50, 64);
      assert.equal(xs.length, 50);
      assert.equal(new Set(xs).size, 50);
    },
  },
];
