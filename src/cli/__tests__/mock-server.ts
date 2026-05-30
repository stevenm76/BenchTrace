import http from "node:http";
import { AddressInfo } from "node:net";

export interface MockServerConfig {
  /** Per-request "compute" delay before streaming begins. */
  ttftMs?: number;
  /** Delay between content tokens. */
  itlMs?: number;
  /** Number of content tokens emitted per request. */
  tokensPerRequest?: number;
  /** Fraction of requests to fail (HTTP 503). */
  failureRate?: number;
}

export interface MockServer {
  url: string;
  close: () => Promise<void>;
  requests: number;
  /** Bodies of every request received, in order. */
  bodies: unknown[];
}

/**
 * In-process OpenAI-compatible mock. Serves /v1/chat/completions with SSE
 * (or plain JSON when stream:false). Deterministic per-request timing
 * driven by MockServerConfig.
 */
export function startMockServer(cfg: MockServerConfig = {}): Promise<MockServer> {
  const state: { requests: number; bodies: unknown[] } = {
    requests: 0,
    bodies: [],
  };
  const ttft = cfg.ttftMs ?? 50;
  const itl = cfg.itlMs ?? 10;
  const tokensPerRequest = cfg.tokensPerRequest ?? 16;
  const failureRate = cfg.failureRate ?? 0;

  return new Promise<MockServer>((resolve) => {
    const server = http.createServer(async (req, res) => {
      state.requests += 1;
      const isChat =
        req.url === "/v1/chat/completions" && req.method === "POST";
      const isCompletions =
        req.url === "/v1/completions" && req.method === "POST";
      if (!isChat && !isCompletions) {
        res.statusCode = 404;
        res.end();
        return;
      }
      // Capture body so tests can assert what was sent.
      const bodyText: string = await new Promise<string>((r) => {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => r(Buffer.concat(chunks).toString("utf8")));
      });
      try {
        state.bodies.push(JSON.parse(bodyText));
      } catch {
        state.bodies.push(bodyText);
      }

      // Simulated failure
      if (failureRate > 0 && Math.random() < failureRate) {
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: { message: "simulated_failure" } }));
        return;
      }

      const accept = req.headers["accept"] ?? "";
      const wantsStream = String(accept).includes("event-stream");

      if (!wantsStream) {
        await sleep(ttft + itl * tokensPerRequest);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        if (isChat) {
          res.end(
            JSON.stringify({
              id: "chatcmpl-mock",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: "x".repeat(tokensPerRequest) },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 64,
                completion_tokens: tokensPerRequest,
                total_tokens: 64 + tokensPerRequest,
              },
            }),
          );
        } else {
          res.end(
            JSON.stringify({
              id: "cmpl-mock",
              object: "text_completion",
              choices: [
                {
                  index: 0,
                  text: "x".repeat(tokensPerRequest),
                  finish_reason: "length",
                },
              ],
              usage: {
                prompt_tokens: 64,
                completion_tokens: tokensPerRequest,
                total_tokens: 64 + tokensPerRequest,
              },
            }),
          );
        }
        return;
      }

      // Streaming path
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      await sleep(ttft);
      for (let i = 0; i < tokensPerRequest; i++) {
        const text = i === 0 ? "tok" : " tok";
        const chunk = isChat
          ? {
              id: "chatcmpl-mock",
              object: "chat.completion.chunk",
              choices: [{ index: 0, delta: { content: text } }],
            }
          : {
              id: "cmpl-mock",
              object: "text_completion",
              choices: [{ index: 0, text, finish_reason: null }],
            };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        await sleep(itl);
      }
      // Final usage chunk
      const finalChunk = isChat
        ? {
            id: "chatcmpl-mock",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: {
              prompt_tokens: 64,
              completion_tokens: tokensPerRequest,
              total_tokens: 64 + tokensPerRequest,
            },
          }
        : {
            id: "cmpl-mock",
            object: "text_completion",
            choices: [],
            usage: {
              prompt_tokens: 64,
              completion_tokens: tokensPerRequest,
              total_tokens: 64 + tokensPerRequest,
            },
          };
      res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((r) =>
            server.close(() => r()),
          ),
        get requests() {
          return state.requests;
        },
        get bodies() {
          return state.bodies;
        },
      });
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
