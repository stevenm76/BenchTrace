import assert from "node:assert/strict";

import {
  buildRunColorMap,
  disambigLabel,
  middleTruncate,
} from "@/lib/charts/run-identity";

const NAME_C1 =
  "Qwen3.6-35B-NVFP4-vLLM-TP2-MTP-K3-2048in-512out-c1-run-2026-05-29";
const NAME_C4 =
  "Qwen3.6-35B-NVFP4-vLLM-TP2-MTP-K3-2048in-512out-c4-run-2026-05-29";

export const tests = [
  {
    name: "middleTruncate keeps colliding runs distinct (audit repro)",
    run() {
      // The exact pair that collided under end-truncation at maxLen=36.
      assert.notEqual(
        middleTruncate(NAME_C1, 40),
        middleTruncate(NAME_C4, 40),
        "c1 and c4 runs must not render the same compact label",
      );
    },
  },
  {
    name: "middleTruncate preserves the distinguishing suffix",
    run() {
      const out = middleTruncate(NAME_C1, 40);
      assert.ok(
        out.endsWith("c1-run-2026-05-29"),
        `expected suffix preserved, got: ${out}`,
      );
      assert.ok(out.length <= 40, `expected <= 40 chars, got ${out.length}`);
      assert.ok(out.includes("…"), "expected an ellipsis in a truncated label");
    },
  },
  {
    name: "middleTruncate leaves short names untouched",
    run() {
      assert.equal(middleTruncate("short-run", 40), "short-run");
    },
  },
  {
    name: "buildRunColorMap gives 6 distinct runs 6 distinct colors",
    run() {
      const ids = Array.from({ length: 6 }, (_, i) => `trace-${i}-xyz`);
      const map = buildRunColorMap(ids);
      const colors = new Set(ids.map((id) => map.get(id)));
      assert.equal(
        colors.size,
        6,
        `expected 6 unique colors, got ${colors.size}`,
      );
    },
  },
  {
    name: "buildRunColorMap is deterministic and order-independent",
    run() {
      const ids = ["c", "a", "b"];
      const m1 = buildRunColorMap(ids);
      const m2 = buildRunColorMap([...ids].reverse());
      for (const id of ids) {
        assert.equal(m1.get(id), m2.get(id), `color for ${id} must be stable`);
      }
    },
  },
  {
    name: "buildRunColorMap wraps only after the palette is exhausted",
    run() {
      // 11 runs, 10-color palette → exactly one repeat (the 11th wraps to #0).
      const ids = Array.from({ length: 11 }, (_, i) => `t${i}`);
      const map = buildRunColorMap(ids);
      const colors = new Set(ids.map((id) => map.get(id)));
      assert.equal(colors.size, 10, `expected 10 colors for 11 runs`);
    },
  },
  {
    name: "disambigLabel formats concurrency and context, omits nulls",
    run() {
      assert.equal(
        disambigLabel({ concurrency: 1, contextLength: 2048 }),
        "c=1 · 2k ctx",
      );
      assert.equal(disambigLabel({ concurrency: 4, contextLength: null }), "c=4");
      assert.equal(
        disambigLabel({ concurrency: null, contextLength: null }),
        "",
      );
    },
  },
];
