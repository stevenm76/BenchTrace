import { randomBytes } from "node:crypto";

export function requestId(): string {
  return "req_" + randomBytes(6).toString("hex");
}

/**
 * Pull SSE-style events out of a UTF-8 byte stream. Events end at "\n\n";
 * within an event we keep only the most recent `data:` line (per the SSE
 * spec — `event:` / `id:` / `retry:` are ignored). Yields the raw `data:`
 * payload (without the prefix). The special `[DONE]` payload is yielded too;
 * callers stop reading after seeing it.
 */
export async function* parseSse(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<string> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = indexOfEventBoundary(buf)) !== -1) {
        const event = buf.slice(0, idx);
        buf = buf.slice(idx + boundaryLength(buf, idx));
        const payload = extractData(event);
        if (payload != null) yield payload;
      }
    }
    buf += decoder.decode();
    if (buf.length > 0) {
      const payload = extractData(buf);
      if (payload != null) yield payload;
    }
  } finally {
    reader.releaseLock();
  }
}

function indexOfEventBoundary(buf: string): number {
  const lf = buf.indexOf("\n\n");
  const crlf = buf.indexOf("\r\n\r\n");
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

function boundaryLength(buf: string, idx: number): number {
  return buf.startsWith("\r\n\r\n", idx) ? 4 : 2;
}

function extractData(event: string): string | null {
  // Concatenate every `data:` line in the event (per SSE spec — but we keep
  // OpenAI's convention of one `data:` per event, which is what every
  // OpenAI-compatible server emits).
  const lines = event.split(/\r?\n/);
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^\s/, ""));
    }
  }
  if (dataLines.length === 0) return null;
  return dataLines.join("\n");
}
