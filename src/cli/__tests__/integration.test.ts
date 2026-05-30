import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { reproJsonV1Schema } from "@/lib/schemas/repro-json";

import { runBenchServe } from "../runner/sweep";

import { startMockServer } from "./mock-server";

export const tests = [
  {
    name: "end-to-end sweep against in-process mock SSE server",
    async run() {
      const mock = await startMockServer({
        ttftMs: 30,
        itlMs: 5,
        tokensPerRequest: 12,
      });
      const outDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "benchtrace-test-"),
      );
      const finalDir = path.join(outDir, "run");

      try {
        const exitCode = await runBenchServe({
          baseUrl: mock.url,
          endpoint: "/v1/chat/completions",
          model: "mock-model",
          profile: "BT-SERVE-001",
          inputLen: 64,
          outputLen: 16,
          numPrompts: 4,
          streams: [1, 2],
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
          engineVersion: "test",
          tags: ["test"],
          notes: null,
          out: finalDir,
          redact: true,
          jsonOnly: false,
          verbose: false,
          importTo: null,
          argv: ["serve", "--base-url", mock.url],
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
        assert.equal(exitCode, 0, "sweep should return 0 with valid levels");

        // share JSON validates
        const sharePath = path.join(finalDir, "benchtrace.share.v1.json");
        const shareText = await fs.readFile(sharePath, "utf8");
        const json = JSON.parse(shareText);
        const validated = reproJsonV1Schema.parse(json);
        assert.equal(validated.schema_version, "benchtrace.share.v1");
        assert.equal(validated.benchmark.tool, "benchtrace");
        assert.equal(validated.verification.level === "weak", false);
        assert.equal(
          validated.benchmark.concurrency_strategy,
          "max_valid_concurrency",
          "share doc should carry profile.concurrencyStrategy, not a hard-coded literal",
        );
        assert.equal(
          validated.benchmark.benchmark_mode,
          "native",
          "share doc should carry benchmark_mode from BenchServeOptions",
        );

        // expected files exist
        for (const f of [
          "benchtrace.share.v1.json",
          "share-summary.md",
          "manifest.json",
          "raw/per-request-results.jsonl",
          "raw/aggregate-results.json",
          "raw/benchmark-command.txt",
          "raw/launch-command.txt",
          "raw/hardware-snapshot-before.json",
          "raw/hardware-snapshot-after.json",
        ]) {
          await fs.access(path.join(finalDir, f));
        }

        // per-request results: should be 8 (2 levels × 4 prompts), warmup excluded
        const jsonl = await fs.readFile(
          path.join(finalDir, "raw", "per-request-results.jsonl"),
          "utf8",
        );
        const lineCount = jsonl.trim().split("\n").length;
        assert.equal(lineCount, 8, "per-request results count");

        // max valid concurrency must be 2 (both levels pass SLAs)
        assert.equal(validated.results.max_valid_concurrency, 2);

        // metric_definitions populated
        assert.ok(validated.metric_definitions.length > 0);
      } finally {
        await mock.close();
        await fs.rm(outDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: "vllm-compatible mode hits /v1/completions with ignore_eos:true",
    async run() {
      const mock = await startMockServer({
        ttftMs: 20,
        itlMs: 3,
        tokensPerRequest: 8,
      });
      const outDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "benchtrace-compat-"),
      );
      const finalDir = path.join(outDir, "run");

      try {
        const exitCode = await runBenchServe({
          baseUrl: mock.url,
          endpoint: "/v1/completions",
          model: "mock-model",
          profile: "BT-SERVE-001",
          inputLen: 64,
          outputLen: 8,
          numPrompts: 2,
          streams: [1],
          streaming: true,
          apiFormat: "completions",
          temperature: 0,
          dataset: "synthetic",
          thinking: false,
          requestRate: "inf",
          ttftSlaMs: 5000,
          tpotSlaMs: 100,
          failureThreshold: 0.05,
          warmup: 0,
          seed: 42,
          apiKey: null,
          launchCommandFile: null,
          engineName: "MockEngine",
          engineVersion: "test",
          tags: ["compat"],
          notes: null,
          out: finalDir,
          redact: true,
          jsonOnly: false,
          verbose: false,
          importTo: null,
          argv: ["serve", "--benchmark-mode", "vllm-compatible"],
          benchmarkMode: "vllm-compatible",
          ignoreEos: true,
          extraBody: { top_p: 0.95 },
          rangeRatio: 0,
          prefixLen: 0,
          vocabSizeOverride: null,
          metricMode: "vllm-compatible",
          randomTokenMode: "vllm-compatible",
          strictComparison: false,
          aligned: false,
          alignedWireTemperature: null,
          referencePrompts: null,
          referenceMetrics: null,
          traceRequests: null,
        });
        assert.equal(exitCode, 0, "compat sweep should return 0");

        // Share doc carries compat metadata.
        const sharePath = path.join(finalDir, "benchtrace.share.v1.json");
        const json = JSON.parse(await fs.readFile(sharePath, "utf8"));
        const validated = reproJsonV1Schema.parse(json);
        assert.equal(validated.benchmark.benchmark_mode, "vllm-compatible");
        assert.equal(validated.benchmark.api_format, "completions");
        assert.equal(validated.benchmark.ignore_eos, true);
        assert.deepEqual(validated.benchmark.extra_body, { top_p: 0.95 });

        // Mock captured a /v1/completions body with ignore_eos:true and the
        // merged extra_body field. Skip the preflight request (max_tokens=1).
        const realBodies = mock.bodies.filter(
          (b) => (b as { max_tokens?: number })?.max_tokens === 8,
        );
        assert.ok(realBodies.length >= 1, "should have measurement requests");
        const body = realBodies[0] as Record<string, unknown>;
        assert.equal(body.ignore_eos, true, "ignore_eos must be in body");
        assert.equal(body.top_p, 0.95, "extra_body must merge into body");
        assert.ok(
          typeof body.prompt === "string",
          "completions body uses `prompt`, not `messages`",
        );
      } finally {
        await mock.close();
        await fs.rm(outDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: "integration: --vllm-aligned produces token-id prompts, completions endpoint, no chat_template_kwargs",
    async run() {
      const { runRequest } = await import("../runner/request");
      const http = await import("node:http");
      let captured: Record<string, unknown> | null = null;
      const server = http.createServer((req, res) => {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          captured = JSON.parse(raw) as Record<string, unknown>;
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.write(`data: {"choices":[{"text":"x"}]}\n\n`);
          res.write(
            `data: {"choices":[{"text":"y"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n`,
          );
          res.write("data: [DONE]\n\n");
          res.end();
        });
      });
      await new Promise<void>((r) => server.listen(0, r));
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      await runRequest(
        {
          baseUrl: `http://127.0.0.1:${port}`,
          endpoint: "/v1/completions",
          model: "m",
          prompt: [1, 2, 3],
          maxTokens: 32,
          streaming: true,
          apiKey: null,
          seed: 0,
          apiFormat: "completions",
          temperature: 0,
          thinking: false,
          benchmarkMode: "vllm-compatible",
          ignoreEos: true,
          extraBody: null,
          aligned: true,
          alignedWireTemperature: null,
        },
        1,
      );
      server.close();
      assert.ok(captured != null, "server should have received a request");
      const body = captured as Record<string, unknown>;
      assert.deepEqual(body.prompt, [1, 2, 3]);
      assert.equal("chat_template_kwargs" in body, false);
      assert.equal(body.ignore_eos, true);
    },
  },
];
