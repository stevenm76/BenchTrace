// src/cli/__tests__/no-vllm-code.test.ts
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, acc);
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

export const tests = [
  {
    name: "no-vllm-code: src imports no vllm module and package.json has no vllm dep",
    async run() {
      const files = await walk(path.join(process.cwd(), "src"));
      for (const f of files) {
        const txt = await fs.readFile(f, "utf8");
        // Match a bare-package specifier of exactly `vllm` (optionally `vllm/subpath`)
        // in an import/require. A specifier like "../../example-imports/vllm-bench.json"
        // is a local data fixture — not a dependency on vLLM code — so it must not match.
        const bad = txt.match(/(?:from\s+|require\(\s*)["']vllm(?:\/[^"']*)?["']/);
        assert.equal(bad, null, `vLLM package import found in ${f}`);
      }
      const pkg = JSON.parse(await fs.readFile(path.join(process.cwd(), "package.json"), "utf8"));
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      assert.ok(!Object.keys(deps).some((d) => /vllm/i.test(d)), "vllm dependency present");
    },
  },
];
