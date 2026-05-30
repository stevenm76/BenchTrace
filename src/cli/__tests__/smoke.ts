/**
 * End-to-end smoke test:
 *   1. spin up the in-process SSE mock server
 *   2. run a real sweep against it (3 stream levels x 6 prompts)
 *   3. let the sweep auto-import the bundle into the running dev server
 *
 * Run after `npm run dev` is up on port 18000.
 *
 *   npm run bench:smoke
 */
import path from "node:path";

import { runBenchServe } from "../runner/sweep";

import { startMockServer } from "./mock-server";

async function main() {
  const dev = process.env.BENCHTRACE_BASE_URL ?? "http://localhost:18000";
  const ping = await fetch(dev).catch((err: Error) => err);
  if (ping instanceof Error) {
    console.error(
      `Dev server not reachable at ${dev}. Start it with \`npm run dev\` first.`,
    );
    process.exit(1);
  }

  const mock = await startMockServer({
    ttftMs: 30,
    itlMs: 5,
    tokensPerRequest: 12,
  });
  console.log(`mock server up at ${mock.url}`);

  const outDir = path.resolve("/tmp/benchtrace-smoke-" + Date.now());
  try {
    const exitCode = await runBenchServe({
      baseUrl: mock.url,
      endpoint: "/v1/chat/completions",
      model: "mock-qwen-3.6b",
      profile: "BT-SERVE-001",
      inputLen: 64,
      outputLen: 12,
      numPrompts: 6,
      streams: [1, 2, 4],
      streaming: true,
      apiFormat: "chat",
      temperature: 0,
      dataset: "synthetic",
      thinking: false,
      requestRate: "inf",
      ttftSlaMs: 5000,
      tpotSlaMs: 100,
      failureThreshold: 0.05,
      warmup: 1,
      seed: 42,
      apiKey: null,
      launchCommandFile: null,
      engineName: "MockEngine",
      engineVersion: "0.0.1-smoke",
      tags: ["smoke", "benchtrace-native"],
      notes: "Smoke test via npm run bench:smoke",
      out: outDir,
      redact: true,
      jsonOnly: false,
      verbose: true,
      importTo: dev,
      argv: ["serve", "--base-url", mock.url, "--model", "mock-qwen-3.6b"],
      benchmarkMode: "native",
      ignoreEos: false,
      extraBody: null,
      rangeRatio: 0,
      prefixLen: 0,
      vocabSizeOverride: null,
      metricMode: "native",
      randomTokenMode: "benchtrace",
      strictComparison: false,
      aligned: false,
      alignedWireTemperature: null,
      referencePrompts: null,
      referenceMetrics: null,
      traceRequests: null,
    });
    if (exitCode !== 0) {
      console.error(`sweep returned non-zero exit code: ${exitCode}`);
      process.exit(exitCode);
    }
  } finally {
    await mock.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
