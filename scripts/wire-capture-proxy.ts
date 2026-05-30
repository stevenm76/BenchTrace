// scripts/wire-capture-proxy.ts
/**
 * Clean-room vLLM oracle capture. A pass-through HTTP proxy: point
 * `vllm bench serve --base-url http://localhost:<PORT>` at it with
 * UPSTREAM=<real server>. It forwards every request unchanged and records the
 * request body + response usage, so we learn exactly what vLLM puts on the
 * wire WITHOUT importing or copying any vLLM code.
 *
 * Usage:
 *   UPSTREAM=http://localhost:8001 PORT=8899 OUT=ref.json npx tsx scripts/wire-capture-proxy.ts
 *
 * Then run the oracle against http://localhost:8899 and Ctrl-C; the bundle is
 * flushed to $OUT on SIGINT.
 */

import http from "node:http";
import { promises as fs } from "node:fs";

export interface Exchange {
  path: string;
  requestBody: Record<string, unknown>;
  usage: { prompt_tokens?: number; completion_tokens?: number } | null;
}

export function recordExchange(store: Exchange[], e: Exchange): void {
  store.push(e);
}

/**
 * Pull the LAST `usage` object out of a JSON or SSE response body. Uses a
 * brace-matching scan (not a regex) because modern vLLM nests fields inside
 * usage (e.g. `prompt_tokens_details: {...}`), which a `[^}]*` regex would
 * truncate — silently undercounting tokens and corrupting the oracle bundle.
 * For SSE streams usage appears only in the final data chunk, so we take the
 * last occurrence.
 */
export function extractLastUsage(text: string): Exchange["usage"] {
  const idx = text.lastIndexOf('"usage"');
  if (idx === -1) return null;
  const start = text.indexOf("{", idx);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1)) as Exchange["usage"];
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function buildBundle(
  store: Exchange[],
  meta: { tool: string; vllmVersion: string | null; endpoint: string },
) {
  const requests = store.map((e) => ({
    prompt_token_ids: Array.isArray(e.requestBody.prompt)
      ? (e.requestBody.prompt as number[])
      : null,
    prompt:
      typeof e.requestBody.prompt === "string" ? e.requestBody.prompt : null,
    max_tokens: e.requestBody.max_tokens ?? null,
    ignore_eos: e.requestBody.ignore_eos ?? null,
    temperature: e.requestBody.temperature ?? null,
    completion_tokens: e.usage?.completion_tokens ?? null,
  }));
  const total_output_tokens = requests.reduce(
    (s, r) => s + (typeof r.completion_tokens === "number" ? r.completion_tokens : 0),
    0,
  );
  const total_input_tokens = store.reduce(
    (s, e) => s + (e.usage?.prompt_tokens ?? 0),
    0,
  );
  return {
    tool: meta.tool,
    vllm_version: meta.vllmVersion,
    endpoint: meta.endpoint,
    requests,
    metrics: { total_output_tokens, total_input_tokens },
  };
}

// --- proxy server (only runs when invoked directly) ---
async function main() {
  const UPSTREAM = process.env.UPSTREAM ?? "http://localhost:8001";
  const PORT = Number(process.env.PORT ?? 8899);
  const OUT = process.env.OUT ?? "reference-bundle.json";
  const store: Exchange[] = [];
  let endpoint = "/v1/completions";

  const server = http.createServer(async (req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      let reqBody: Record<string, unknown> = {};
      try { reqBody = JSON.parse(raw); } catch { /* non-JSON passthrough */ }
      if (req.url) endpoint = req.url;
      const upstream = await fetch(UPSTREAM + (req.url ?? ""), {
        method: req.method, headers: { "Content-Type": "application/json" }, body: raw || undefined,
      });
      const text = await upstream.text();
      const usage = extractLastUsage(text);
      recordExchange(store, { path: req.url ?? "", requestBody: reqBody, usage });
      res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") ?? "application/json" });
      res.end(text);
    });
  });

  async function flush() {
    const bundle = buildBundle(store, { tool: "vllm bench serve", vllmVersion: process.env.VLLM_VERSION ?? null, endpoint });
    await fs.writeFile(OUT, JSON.stringify(bundle, null, 2), "utf8");
    process.stdout.write(`\nwrote ${store.length} exchanges to ${OUT}\n`);
    process.exit(0);
  }
  process.on("SIGINT", () => { void flush(); });
  server.listen(PORT, () => process.stdout.write(`wire-capture-proxy ${PORT} -> ${UPSTREAM}\n`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
