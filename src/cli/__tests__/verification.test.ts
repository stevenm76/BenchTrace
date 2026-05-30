import assert from "node:assert/strict";

import { computeVerificationCore } from "../../lib/verification";
import type { VerificationInputShape } from "../../lib/verification";

// Minimal fixture — only the fields computeVerificationCore reads.
function baseTrace(opts: {
  cudaVersion?: string | null;
  rocmVersion?: string | null;
  gpuModels?: { name: string }[];
}): VerificationInputShape {
  return {
    artifacts: [
      { parserStatus: "parsed" as const, sha256: "abc123" },
    ],
    loaderConfig: { launchCommand: "vllm serve foo" },
    benchmarkProfile: {
      command: "npx benchtrace serve ...",
      tool: "benchtrace",
      workloadType: "serving",
      inputLength: 512,
      outputLength: 256,
      concurrency: 4,
    },
    engine: { version: "0.20.2" },
    model: {
      quantization: "NVFP4",
      architecture: "Qwen3",
      parameterCount: 35_000_000_000,
    },
    hardwareProfile: {
      gpuModels: opts.gpuModels ?? [{ name: "NVIDIA RTX 5060 Ti" }],
      cudaVersion: opts.cudaVersion ?? null,
      rocmVersion: opts.rocmVersion ?? null,
    },
    metricPoints: [
      {
        outputTokensPerSecond: 100,
        totalTokensPerSecond: 100,
        prefillTokensPerSecond: null,
        p50TtftMs: 200,
        p95TtftMs: 250,
        p99TtftMs: 260,
        failureRate: 0,
        successfulRequests: 100,
      },
    ],
    nativeBenchmarkTool: "benchtrace",
  };
}

export const tests = [
  {
    name: "NVIDIA path with cudaVersion reaches strong",
    run() {
      const v = computeVerificationCore(
        baseTrace({ cudaVersion: "13.2", rocmVersion: null }),
      );
      assert.equal(v.level, "strong");
    },
  },
  {
    name: "AMD path with rocmVersion reaches strong (H1)",
    run() {
      const v = computeVerificationCore(
        baseTrace({
          cudaVersion: null,
          rocmVersion: "6.2.4",
          gpuModels: [{ name: "Radeon RX 7900 XTX" }],
        }),
      );
      assert.equal(
        v.level,
        "strong",
        "AMD system with rocmVersion populated should reach strong, got: " +
          v.level +
          " · missing: " +
          v.missingCriticalFields.join(","),
      );
    },
  },
  {
    name: "missing both cuda + rocm degrades verification",
    run() {
      const v = computeVerificationCore(
        baseTrace({ cudaVersion: null, rocmVersion: null }),
      );
      assert.notEqual(v.level, "strong");
    },
  },
  {
    name: "native trace without launch_command can still reach strong (carve-out)",
    run() {
      const t = baseTrace({ cudaVersion: "13.2", rocmVersion: null });
      t.loaderConfig = { launchCommand: null };
      const v = computeVerificationCore(t);
      assert.equal(
        v.level,
        "strong",
        "native trace without launch_command should still reach strong, got: " +
          v.level +
          " · missing: " +
          v.missingCriticalFields.join(","),
      );
    },
  },
  {
    name: "imported (non-native) trace without launch_command is below strong",
    run() {
      const t = baseTrace({ cudaVersion: "13.2", rocmVersion: null });
      t.loaderConfig = { launchCommand: null };
      t.nativeBenchmarkTool = null;
      t.benchmarkProfile!.tool = "vllm-bench";
      const v = computeVerificationCore(t);
      assert.notEqual(v.level, "strong");
    },
  },
  {
    name: "trace with no parsed artifact gets flagged",
    run() {
      const t = baseTrace({ cudaVersion: "13.2", rocmVersion: null });
      t.artifacts = [];
      const v = computeVerificationCore(t);
      assert.ok(
        v.missingCriticalFields.length > 0 || v.level !== "strong",
        "expected missing parsed artifact to surface in verification",
      );
    },
  },
];
