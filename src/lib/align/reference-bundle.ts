/**
 * Normalized view of a captured `vllm bench serve` run. Produced by
 * scripts/wire-capture-proxy.ts. BenchTrace never imports vLLM; this only
 * parses an artifact vLLM's traffic produced.
 */

export interface ReferenceRequest {
  /** Exact prompt token-ids vLLM sent, when the prompt was an int array. */
  promptTokenIds: number[] | null;
  /** Exact prompt text vLLM sent, when the prompt was a string. */
  promptText: string | null;
  maxTokens: number | null;
  ignoreEos: boolean | null;
  temperature: number | null;
  /** Server-reported completion tokens for this request, when captured. */
  completionTokens: number | null;
}

export interface ReferenceMetrics {
  outputThroughput: number | null;
  totalOutputTokens: number | null;
  totalInputTokens: number | null;
  benchmarkDurationS: number | null;
}

export interface ReferenceBundle {
  tool: string | null;
  vllmVersion: string | null;
  endpoint: string | null;
  requests: ReferenceRequest[];
  metrics: ReferenceMetrics;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

export function parseReferenceBundle(raw: string): ReferenceBundle {
  const j = JSON.parse(raw) as Record<string, unknown>;
  const reqsRaw = Array.isArray(j.requests) ? j.requests : [];
  if (reqsRaw.length === 0) {
    throw new Error("reference bundle has no requests");
  }
  const requests: ReferenceRequest[] = reqsRaw.map((r) => {
    const o = r as Record<string, unknown>;
    return {
      promptTokenIds:
        Array.isArray(o.prompt_token_ids) &&
        o.prompt_token_ids.every((x) => typeof x === "number")
          ? (o.prompt_token_ids as number[])
          : null,
      promptText: typeof o.prompt === "string" ? o.prompt : null,
      maxTokens: num(o.max_tokens),
      ignoreEos: bool(o.ignore_eos),
      temperature: num(o.temperature),
      completionTokens: num(o.completion_tokens),
    };
  });
  const m = (j.metrics as Record<string, unknown>) ?? {};
  return {
    tool: typeof j.tool === "string" ? j.tool : null,
    vllmVersion: typeof j.vllm_version === "string" ? j.vllm_version : null,
    endpoint: typeof j.endpoint === "string" ? j.endpoint : null,
    requests,
    metrics: {
      outputThroughput: num(m.output_throughput),
      totalOutputTokens: num(m.total_output_tokens),
      totalInputTokens: num(m.total_input_tokens),
      benchmarkDurationS: num(m.benchmark_duration_s),
    },
  };
}
