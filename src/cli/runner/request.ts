import { requestId, parseSse } from "../util/http";
import { nowMs } from "../util/time";

import {
  computeMeanChunkGapMs,
  computeTpotMs,
  computeVllmCompatTpotMs,
  resolveOutputTokens,
  resolveOutputTokenSource,
  type BenchmarkMode,
  type OutputTokenSource,
} from "./metrics";

export type ApiFormat = "chat" | "completions";

export interface RequestConfig {
  baseUrl: string;
  endpoint: string;
  model: string;
  prompt: string | number[];
  maxTokens: number;
  streaming: boolean;
  apiKey: string | null;
  /** Request-scoped seed so the server can reproduce sampling if it honors `seed`. */
  seed: number;
  /**
   * `chat`        → POST /v1/chat/completions with messages=[{role:"user",content:prompt}],
   *                 honors chat_template_kwargs (e.g. enable_thinking=false for Qwen3).
   * `completions` → POST /v1/completions with prompt=<string>, no chat template applied
   *                 server-side. Matches vLLM's bench_serve.py.
   *
   * With a server reasoning parser active (e.g. --reasoning-parser qwen3) the
   * chat endpoint buffers <think>...</think> server-side and only flushes
   * after the closing tag — so chat-mode TTFT reads as "time until thinking
   * finished + first real token." Completions mode bypasses the chat template
   * entirely; TTFT reflects the first raw token. Use --api-format completions
   * for apples-to-apples comparison against vllm bench_serve.py.
   */
  apiFormat: ApiFormat;
  /**
   * Sampling temperature. Defaults to 0 (greedy) — the standardised vLLM
   * benchmarks all use greedy so the cost of sampling doesn't pollute the
   * decode latency measurement.
   */
  temperature: number;
  /**
   * When false (the default for a serving benchmark), tell the server NOT to
   * emit thinking / reasoning tokens — these blow up output length
   * unpredictably and make per-request timing meaningless. Sends
   * `chat_template_kwargs.enable_thinking=false` (vLLM/SGLang convention for
   * Qwen3/DeepSeek-R1). Only applies to chat mode — completions mode bypasses
   * the chat template entirely so the flag is a no-op there.
   */
  thinking: boolean;
  /**
   * Benchmark mode. Controls TPOT formula (and, in later steps, other
   * behaviors). See src/cli/runner/metrics.ts.
   */
  benchmarkMode: BenchmarkMode;
  /**
   * Send `ignore_eos: true` in the request body. Forces fixed-length
   * output decode and makes max_tokens an honest fallback for usage.
   */
  ignoreEos: boolean;
  /**
   * vLLM-aligned strict mode. Sends ONLY the request fields vLLM sends and
   * supports raw token-id array prompts. No chat_template_kwargs / extra
   * BenchTrace fields are added.
   */
  aligned: boolean;
  /**
   * Temperature to put on the aligned wire, mirroring `vllm bench serve
   * --temperature`. null = omit (server default); a value = sent verbatim.
   * Only consulted in aligned mode.
   */
  alignedWireTemperature: number | null;
  /**
   * Arbitrary extra fields merged into the request body. vLLM's
   * `--extra-body` equivalent.
   */
  extraBody: Record<string, unknown> | null;
  /** Wall-clock timeout. Default 120 s. */
  timeoutMs?: number;
}

export interface RequestResult {
  requestId: string;
  streamLevel: number;
  startMs: number;
  firstTokenMs: number | null;
  endMs: number;
  success: boolean;
  errorKind:
    | "timeout"
    | "http_5xx"
    | "http_4xx"
    | "network"
    | "schema"
    | null;
  errorMessage: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Where `outputTokens` came from — see {@link OutputTokenSource}. */
  outputTokenCountSource: OutputTokenSource;
  ttftMs: number | null;
  e2eLatencyMs: number;
  /** Inter-arrival gaps between content chunks (chunk-gaps), ms. */
  interTokenLatenciesMs: number[];
  /**
   * Mode-selected headline TPOT. native → mean chunk-gap; vllm-compatible →
   * token-normalized. Retained for backward compatibility; prefer the two
   * explicit fields below which are always populated regardless of mode.
   */
  tpotMs: number | null;
  /**
   * BenchTrace-native mean chunk-gap latency, ms. NOT token-normalized — when
   * the server packs >1 token per chunk this is N× the per-token decode time.
   */
  meanChunkGapMs: number | null;
  /** vLLM-compatible token-normalized TPOT, ms. */
  tpotMsVllmCompat: number | null;
  /** Number of content chunks received over the stream. */
  chunkCount: number;
  /** outputTokens / chunkCount when both are known (MTP packing factor). */
  tokensPerChunk: number | null;
  outputTokensPerSecond: number | null;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export interface AlignedBodyInput {
  model: string;
  prompt: string | number[];
  maxTokens: number;
  streaming: boolean;
  ignoreEos: boolean;
  /**
   * Wire temperature, mirroring `vllm bench serve --temperature`. vLLM omits it
   * unless the flag is passed; null/undefined here means omit (server samples
   * at its default). A value (e.g. 0 for greedy) is sent verbatim.
   */
  temperature?: number | null;
}

/**
 * Minimal /v1/completions body matching `vllm bench serve --dataset-name
 * random` exactly. vLLM never sends `seed` on the wire, and only sends
 * `temperature` when `--temperature` was passed — so we mirror that. Forcing a
 * default temperature:0 would make greedy decoding raise spec-decode acceptance
 * and inflate throughput, breaking alignment with the no-flag invocation.
 */
export function buildAlignedRequestBody(
  i: AlignedBodyInput,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: i.model,
    prompt: i.prompt,
    max_tokens: i.maxTokens,
    stream: i.streaming,
  };
  if (i.streaming) body.stream_options = { include_usage: true };
  if (i.ignoreEos) body.ignore_eos = true;
  if (i.temperature != null) body.temperature = i.temperature;
  return body;
}

/**
 * Issue a single request against an OpenAI-compatible chat completion
 * endpoint and measure timings. Never throws; failures are reflected in
 * the returned RequestResult.
 */
export async function runRequest(
  cfg: RequestConfig,
  streamLevel: number,
): Promise<RequestResult> {
  const id = requestId();
  const startMs = nowMs();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let body: Record<string, unknown>;
  if (cfg.aligned) {
    body = buildAlignedRequestBody({
      model: cfg.model,
      prompt: cfg.prompt,
      maxTokens: cfg.maxTokens,
      streaming: cfg.streaming,
      ignoreEos: cfg.ignoreEos,
      temperature: cfg.alignedWireTemperature,
    });
  } else {
    body =
      cfg.apiFormat === "completions"
        ? {
            // /v1/completions — raw text in, raw text out. No chat template
            // wrapper, no thinking-tag buffering. Matches vllm bench_serve.py.
            model: cfg.model,
            prompt: cfg.prompt as string,
            max_tokens: cfg.maxTokens,
            temperature: cfg.temperature,
            seed: cfg.seed,
            stream: cfg.streaming,
          }
        : {
            // /v1/chat/completions — server wraps with the model's chat
            // template (system/user/assistant). Adds ~40-80 tokens of prefill
            // overhead vs raw completions, and on reasoning-parser-enabled
            // servers buffers <think>...</think> until the closing tag.
            model: cfg.model,
            messages: [{ role: "user", content: cfg.prompt as string }],
            max_tokens: cfg.maxTokens,
            temperature: cfg.temperature,
            seed: cfg.seed,
            stream: cfg.streaming,
          };
    if (cfg.streaming) {
      body.stream_options = { include_usage: true };
    }
    if (cfg.ignoreEos) {
      body.ignore_eos = true;
    }
    if (cfg.extraBody) {
      Object.assign(body, cfg.extraBody);
    }
    if (cfg.apiFormat === "chat" && !cfg.thinking) {
      // vLLM / SGLang honor this against Qwen3 / DeepSeek-R1 chat templates;
      // other servers ignore the field. We intentionally do NOT send
      // `reasoning_effort` — vLLM strictly validates it against the OpenAI
      // enum (none/low/medium/high) and any value we'd pick risks failing the
      // request body validation on servers that accept the field but disagree
      // on the enum.
      body.chat_template_kwargs = { enable_thinking: false };
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: cfg.streaming ? "text/event-stream" : "application/json",
  };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  try {
    const res = await fetch(joinUrl(cfg.baseUrl, cfg.endpoint), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      const endMs = nowMs();
      return failure(id, streamLevel, startMs, endMs, {
        kind: res.status >= 500 ? "http_5xx" : "http_4xx",
        message: `HTTP ${res.status} ${txt.slice(0, 200)}`,
      });
    }
    if (cfg.streaming) {
      return await collectStreaming(
        res,
        id,
        streamLevel,
        startMs,
        cfg.benchmarkMode,
        cfg.maxTokens,
      );
    }
    return await collectNonStreaming(res, id, streamLevel, startMs);
  } catch (err) {
    const endMs = nowMs();
    const aborted = (err as { name?: string } | undefined)?.name === "AbortError";
    return failure(id, streamLevel, startMs, endMs, {
      kind: aborted ? "timeout" : "network",
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function collectStreaming(
  res: Response,
  id: string,
  streamLevel: number,
  startMs: number,
  benchmarkMode: BenchmarkMode,
  expectedOutputTokens: number,
): Promise<RequestResult> {
  let firstTokenMs: number | null = null;
  let inputTokens: number | null = null;
  let usageOutputTokens: number | null = null;
  const chunkTimes: number[] = [];

  try {
    for await (const payload of parseSse(res.body)) {
      if (payload === "[DONE]") break;
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }
      const obj = parsed as {
        choices?: {
          delta?: {
            content?: unknown;
            reasoning_content?: unknown;
            text?: unknown;
          };
          text?: unknown;
          finish_reason?: string;
        }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const usage = obj.usage;
      if (usage) {
        if (typeof usage.prompt_tokens === "number") inputTokens = usage.prompt_tokens;
        if (typeof usage.completion_tokens === "number")
          usageOutputTokens = usage.completion_tokens;
      }
      const choice = obj.choices?.[0];
      const delta = choice?.delta;
      // Count anything the model emitted toward TTFT / ITL. Different servers
      // and reasoning modes use different fields:
      //   - delta.content              standard OpenAI chat streaming
      //   - delta.reasoning_content    Qwen3 / DeepSeek-R1 thinking-mode output
      //   - delta.text / choice.text   legacy /v1/completions or some non-OpenAI
      //                                compatible servers
      // We accept empty strings too — an empty delta still indicates a chunk
      // boundary, which is the timing signal we need.
      const tokenLike =
        typeof delta?.content === "string"
          ? delta.content
          : typeof delta?.reasoning_content === "string"
            ? delta.reasoning_content
            : typeof delta?.text === "string"
              ? delta.text
              : typeof choice?.text === "string"
                ? choice.text
                : null;
      if (tokenLike != null) {
        const t = nowMs();
        if (firstTokenMs == null) firstTokenMs = t;
        chunkTimes.push(t);
      }
    }
  } catch (err) {
    const endMs = nowMs();
    return failure(id, streamLevel, startMs, endMs, {
      kind: "network",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const endMs = nowMs();
  if (firstTokenMs == null || chunkTimes.length === 0) {
    return failure(id, streamLevel, startMs, endMs, {
      kind: "schema",
      message: "Stream ended before any content tokens",
    });
  }

  const ttftMs = firstTokenMs - startMs;
  const e2eLatencyMs = endMs - startMs;

  const tokenInputs = {
    mode: benchmarkMode,
    fromUsage: usageOutputTokens,
    expected: expectedOutputTokens,
  };
  const outputTokens = resolveOutputTokens(tokenInputs);
  const outputTokenCountSource = resolveOutputTokenSource(tokenInputs);

  const interTokenLatenciesMs: number[] = [];
  for (let i = 1; i < chunkTimes.length; i++) {
    interTokenLatenciesMs.push(chunkTimes[i]! - chunkTimes[i - 1]!);
  }
  // Always compute BOTH metric families. The native chunk-gap mean is honest
  // about inter-chunk timing; the vLLM-compatible TPOT is token-normalized and
  // comparable to `vllm bench serve`. metricMode (a run-level setting) decides
  // which one is the headline — never conflate them.
  const meanChunkGapMs = computeMeanChunkGapMs(interTokenLatenciesMs);
  const tpotMsVllmCompat = computeVllmCompatTpotMs({
    e2eMs: e2eLatencyMs,
    ttftMs,
    outputTokens,
  });
  const tpotMs = computeTpotMs(benchmarkMode, {
    e2eMs: e2eLatencyMs,
    ttftMs,
    outputTokens,
    chunkGapsMs: interTokenLatenciesMs,
  });
  const chunkCount = chunkTimes.length;
  const tokensPerChunk =
    outputTokens != null && chunkCount > 0 ? outputTokens / chunkCount : null;

  const decodeWindowMs = endMs - firstTokenMs;
  const outputTokensPerSecond =
    outputTokens != null && decodeWindowMs > 0
      ? (outputTokens / decodeWindowMs) * 1000
      : null;

  return {
    requestId: id,
    streamLevel,
    startMs,
    firstTokenMs,
    endMs,
    success: true,
    errorKind: null,
    errorMessage: null,
    inputTokens,
    outputTokens,
    outputTokenCountSource,
    ttftMs,
    e2eLatencyMs,
    interTokenLatenciesMs,
    tpotMs,
    meanChunkGapMs,
    tpotMsVllmCompat,
    chunkCount,
    tokensPerChunk,
    outputTokensPerSecond,
  };
}

async function collectNonStreaming(
  res: Response,
  id: string,
  streamLevel: number,
  startMs: number,
): Promise<RequestResult> {
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (err) {
    const endMs = nowMs();
    return failure(id, streamLevel, startMs, endMs, {
      kind: "schema",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  const obj = parsed as {
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const endMs = nowMs();
  const e2eLatencyMs = endMs - startMs;
  const outputTokens =
    typeof obj.usage?.completion_tokens === "number"
      ? obj.usage.completion_tokens
      : null;
  const inputTokens =
    typeof obj.usage?.prompt_tokens === "number"
      ? obj.usage.prompt_tokens
      : null;
  return {
    requestId: id,
    streamLevel,
    startMs,
    firstTokenMs: endMs,
    endMs,
    success: true,
    errorKind: null,
    errorMessage: null,
    inputTokens,
    outputTokens,
    outputTokenCountSource:
      outputTokens != null ? "server_usage" : "unknown",
    ttftMs: e2eLatencyMs,
    e2eLatencyMs,
    interTokenLatenciesMs: [],
    tpotMs: null,
    meanChunkGapMs: null,
    tpotMsVllmCompat: null,
    chunkCount: 0,
    tokensPerChunk: null,
    outputTokensPerSecond:
      outputTokens != null && e2eLatencyMs > 0
        ? (outputTokens / e2eLatencyMs) * 1000
        : null,
  };
}

function failure(
  id: string,
  streamLevel: number,
  startMs: number,
  endMs: number,
  err: { kind: NonNullable<RequestResult["errorKind"]>; message: string },
): RequestResult {
  return {
    requestId: id,
    streamLevel,
    startMs,
    firstTokenMs: null,
    endMs,
    success: false,
    errorKind: err.kind,
    errorMessage: err.message,
    inputTokens: null,
    outputTokens: null,
    outputTokenCountSource: "unknown",
    ttftMs: null,
    e2eLatencyMs: endMs - startMs,
    interTokenLatenciesMs: [],
    tpotMs: null,
    meanChunkGapMs: null,
    tpotMsVllmCompat: null,
    chunkCount: 0,
    tokensPerChunk: null,
    outputTokensPerSecond: null,
  };
}

function joinUrl(base: string, endpoint: string): string {
  return `${base.replace(/\/$/, "")}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
}
