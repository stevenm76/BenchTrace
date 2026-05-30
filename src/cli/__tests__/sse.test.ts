import assert from "node:assert/strict";

import { parseSse } from "../util/http";

function mkStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

export const tests = [
  {
    name: "parses two events split into one TCP read",
    async run() {
      const stream = mkStream([
        'data: {"a":1}\n\ndata: {"b":2}\n\n',
      ]);
      const out: string[] = [];
      for await (const p of parseSse(stream)) out.push(p);
      assert.deepEqual(out, ['{"a":1}', '{"b":2}']);
    },
  },
  {
    name: "handles event split across chunks",
    async run() {
      const stream = mkStream(['data: {"a":', '1}\n\n']);
      const out: string[] = [];
      for await (const p of parseSse(stream)) out.push(p);
      assert.deepEqual(out, ['{"a":1}']);
    },
  },
  {
    name: "ignores ping comments and unknown lines",
    async run() {
      const stream = mkStream([
        ":keepalive\n\nevent: msg\ndata: hi\n\n",
      ]);
      const out: string[] = [];
      for await (const p of parseSse(stream)) out.push(p);
      assert.deepEqual(out, ["hi"]);
    },
  },
  {
    name: "yields [DONE]",
    async run() {
      const stream = mkStream(['data: {"x":1}\n\ndata: [DONE]\n\n']);
      const out: string[] = [];
      for await (const p of parseSse(stream)) out.push(p);
      assert.deepEqual(out, ['{"x":1}', "[DONE]"]);
    },
  },
];
