// src/cli/runner/request-trace.ts
/**
 * Normalized per-request trace for the vLLM equivalence comparator. Captures
 * exactly what BenchTrace put on the wire and what it observed back, so a
 * paired vLLM reference can be diffed field-by-field.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export interface RawTrace {
  requestId: string;
  endpoint: string;
  body: Record<string, unknown>;
  promptHash: string;
  requestedOutputLen: number;
  scheduledMs: number;
  sentMs: number;
  firstTokenMs: number | null;
  completeMs: number;
  actualOutputTokens: number | null;
  actualChunks: number | null;
  usage: { prompt_tokens?: number; completion_tokens?: number } | null;
}

export interface NormalizedTrace extends RawTrace {
  bodyFieldKeys: string[];
}

export function normalizeTrace(t: RawTrace): NormalizedTrace {
  return { ...t, bodyFieldKeys: Object.keys(t.body) };
}

export async function writeRequestTrace(
  dir: string,
  t: NormalizedTrace,
): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${t.requestId}.json`),
    JSON.stringify(t, null, 2),
    "utf8",
  );
}
