import assert from "node:assert/strict";

import { classifyFilename, parseBundle } from "../../lib/import/bundle";

export const tests = [
  {
    name: "classifies benchmark_result.json as benchmark_result",
    run() {
      assert.equal(classifyFilename("benchmark_result.json"), "benchmark_result");
    },
  },
  {
    name: "classifies benchtrace.share.v1.json as benchmark_result",
    run() {
      assert.equal(
        classifyFilename("benchtrace.share.v1.json"),
        "benchmark_result",
      );
    },
  },
  {
    name: "classifies launch_command.txt as launch_command",
    run() {
      assert.equal(classifyFilename("launch_command.txt"), "launch_command");
    },
  },
  {
    name: "classifies benchmark_command.txt as benchmark_command",
    run() {
      assert.equal(
        classifyFilename("benchmark_command.txt"),
        "benchmark_command",
      );
    },
  },
  {
    name: "classifies nvidia-smi.txt as nvidia_smi",
    run() {
      assert.equal(classifyFilename("nvidia-smi.txt"), "nvidia_smi");
      assert.equal(classifyFilename("nvidia_smi.txt"), "nvidia_smi");
    },
  },
  {
    name: "classifies notes.md as notes",
    run() {
      assert.equal(classifyFilename("notes.md"), "notes");
    },
  },
  {
    name: "unknown files classify as other",
    run() {
      assert.equal(classifyFilename("random-file.dat"), "other");
    },
  },
  {
    name: "parseBundle missing benchmark_result reports it in missingExpected",
    run() {
      const result = parseBundle([
        { name: "launch_command.txt", content: "vllm serve foo", size: 10 },
      ]);
      assert.ok(
        result.missingExpected.some((m) => m.role === "benchmark_result"),
      );
    },
  },
];
