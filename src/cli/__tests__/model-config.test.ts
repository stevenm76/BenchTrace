import assert from "node:assert/strict";

import { probeModelConfig } from "../snapshot/model-config";

/** A reader that serves a single config.json body and null for anything else. */
function configReader(body: object) {
  return async (p: string): Promise<string | null> =>
    p.endsWith("config.json") ? JSON.stringify(body) : null;
}

export const tests = [
  {
    name: "model-config: reads top-level vocab_size",
    async run() {
      const probe = await probeModelConfig(
        "/fake/model",
        configReader({ architectures: ["LlamaForCausalLM"], vocab_size: 128_256 }),
      );
      assert.equal(probe?.vocabSize, 128_256);
    },
  },
  {
    name: "model-config: reads nested text_config.vocab_size (multimodal)",
    async run() {
      // Qwen-VL-style config: vocab_size lives under text_config, not top level.
      // Regression: random-token sampling silently fell back to a smaller vocab
      // and diverged from vLLM's prompt distribution when this was missed.
      const probe = await probeModelConfig(
        "/fake/model",
        configReader({
          architectures: ["Qwen3_5MoeForConditionalGeneration"],
          vision_config: { hidden_size: 1280 },
          text_config: { vocab_size: 248_320 },
        }),
      );
      assert.equal(probe?.vocabSize, 248_320);
    },
  },
  {
    name: "model-config: prefers top-level vocab_size over nested",
    async run() {
      const probe = await probeModelConfig(
        "/fake/model",
        configReader({
          architectures: ["X"],
          vocab_size: 100,
          text_config: { vocab_size: 200 },
        }),
      );
      assert.equal(probe?.vocabSize, 100);
    },
  },
  {
    name: "model-config: vocab_size null when absent everywhere",
    async run() {
      const probe = await probeModelConfig(
        "/fake/model",
        configReader({ architectures: ["X"] }),
      );
      assert.equal(probe?.vocabSize, null);
    },
  },
];
