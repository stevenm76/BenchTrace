/**
 * Compute the `comparison_validity` block for a share doc — an honest, machine-
 * checkable judgement of whether a BenchTrace run can be compared against
 * `vllm bench serve`. The cardinal rule from the parity work: never let a
 * native chunk-gap latency masquerade as a vLLM TPOT, and never claim parity
 * the metadata can't support.
 */

import { computeEquivalence } from "@/lib/align/equivalence";
import type { ComparisonValidity } from "@/lib/schemas/repro-json";

import type { MetricMode, OutputTokenSource } from "../runner/metrics";

export interface ComparisonValidityInput {
  /** Full endpoint path actually hit, e.g. "/v1/completions". */
  endpoint: string | null;
  /** "chat" | "completions" | null. */
  apiFormat: string | null;
  /** Dataset name, e.g. "random-tokens". */
  dataset: string | null;
  ignoreEos: boolean | null;
  temperature: number | null;
  seed: number | null;
  metricMode: MetricMode | null;
  /** Weakest output-token provenance observed across the run. */
  outputTokenCountSource: OutputTokenSource;
  /** Random-token sampling mode, when the run used the random-tokens dataset. */
  randomTokenMode: "benchtrace" | "vllm-compatible" | null;
  /**
   * Paired vLLM reference facts. When present, the verdict is delegated to the
   * pure equivalence engine. When absent, the verdict is capped at
   * weakly_comparable — config flags alone never prove strong comparability.
   */
  reference?: {
    endpointRef: string | null;
    btFieldKeys: string[];
    refFieldKeys: string[];
    promptHashesBt: string[];
    promptHashesRef: string[];
    requestedOutputBt: number[];
    requestedOutputRef: number[];
    actualOutputTokensBt: number;
    actualOutputTokensRef: number;
    acceptedTokensPerChunkBt: number | null;
    acceptedTokensPerChunkRef: number | null;
    tolerance?: { outputTokensPct: number; acceptedTokensPct: number };
  } | null;
}

export function computeComparisonValidity(
  i: ComparisonValidityInput,
): ComparisonValidity {
  const notes: string[] = [];

  const same_endpoint = i.endpoint == null ? null : i.endpoint.endsWith("/v1/completions");
  const same_api_format = i.apiFormat == null ? null : i.apiFormat === "completions";
  const same_dataset = i.dataset == null ? null : i.dataset === "random-tokens";
  // Exact byte equality with vLLM's generated prompts can only be asserted by
  // diffing against the paired vLLM run, which a single BenchTrace run cannot
  // see. Left null on purpose rather than guessed.
  const same_dataset_bytes = null;
  const same_prompt_bytes = null;
  const same_input_length_policy = same_dataset === true ? true : null;
  const same_output_length_policy = i.ignoreEos == null ? null : i.ignoreEos === true;
  const same_ignore_eos = i.ignoreEos == null ? null : i.ignoreEos === true;
  const same_max_tokens = true;
  const same_temperature = i.temperature == null ? null : i.temperature === 0;
  const same_seed = i.seed == null ? false : true;
  const same_tokenizer_vocab =
    i.randomTokenMode === "vllm-compatible"
      ? true
      : same_dataset === true
        ? false
        : null;
  const metricFamilyOk =
    i.metricMode === "vllm-compatible" || i.metricMode === "both";
  const same_metric_formula =
    metricFamilyOk && i.outputTokenCountSource !== "unknown";

  if (same_endpoint === false) notes.push("endpoint is not /v1/completions");
  if (same_api_format === false) notes.push("api_format is not completions");
  if (same_metric_formula === false) {
    notes.push(
      metricFamilyOk
        ? "output token count source is unknown — token-normalized TPOT not trustworthy"
        : "metric_mode does not produce vLLM-compatible TPOT",
    );
  }
  if (same_ignore_eos === false) notes.push("ignore_eos is not enabled — output length not fixed");
  if (same_temperature === false) notes.push("temperature is not 0 (greedy)");
  if (same_tokenizer_vocab === false)
    notes.push("random-token vocab differs from vLLM (use --random-token-mode vllm-compatible)");
  if (i.outputTokenCountSource === "estimated")
    notes.push("output tokens estimated from max_tokens (ignore_eos fallback), not server usage");

  // Verdict. A fundamental metric or wire mismatch is fatal. A clean
  // vLLM-style config with server-truth token counts is strong. Everything
  // in between is weak (comparable in principle, with documented caveats).
  let verdict: ComparisonValidity["verdict"];
  let out_same_endpoint: boolean | null = same_endpoint;
  let out_same_prompt_bytes: boolean | null = same_prompt_bytes;
  let out_same_output_length_policy: boolean | null = same_output_length_policy;
  let out_same_metric_formula: boolean | null = same_metric_formula;
  let same_payload_fields: boolean | null = null;
  let same_output_tokens: boolean | null = null;
  let same_accepted_tokens_per_chunk: boolean | null = null;
  let has_reference: boolean;
  let out_notes = notes;

  if (i.reference != null) {
    // A paired reference is present: delegate the verdict to the pure
    // equivalence engine, which proves comparability rather than asserting it.
    const ref = i.reference;
    const eq = computeEquivalence({
      endpointBt: i.endpoint,
      endpointRef: ref.endpointRef,
      btFieldKeys: ref.btFieldKeys,
      refFieldKeys: ref.refFieldKeys,
      promptHashesBt: ref.promptHashesBt,
      promptHashesRef: ref.promptHashesRef,
      requestedOutputBt: ref.requestedOutputBt,
      requestedOutputRef: ref.requestedOutputRef,
      actualOutputTokensBt: ref.actualOutputTokensBt,
      actualOutputTokensRef: ref.actualOutputTokensRef,
      acceptedTokensPerChunkBt: ref.acceptedTokensPerChunkBt,
      acceptedTokensPerChunkRef: ref.acceptedTokensPerChunkRef,
      metricFormulaOk: same_metric_formula,
      tolerance: ref.tolerance ?? { outputTokensPct: 2, acceptedTokensPct: 5 },
    });
    verdict = eq.verdict;
    has_reference = eq.hasReference;
    same_payload_fields = eq.samePayloadFields;
    same_output_tokens = eq.sameOutputTokens;
    same_accepted_tokens_per_chunk = eq.sameAcceptedTokensPerChunk;
    out_same_endpoint = eq.sameEndpoint;
    out_same_prompt_bytes = eq.samePromptBytes;
    out_same_output_length_policy = eq.sameOutputLengthPolicy;
    out_same_metric_formula = eq.sameMetricFormula;
    out_notes = [...notes, ...eq.notes];
  } else {
    // No paired reference: config flags alone can never prove strong
    // comparability. A fatal metric/wire mismatch is still not_comparable;
    // everything else caps at weakly_comparable. strongly_comparable is
    // structurally unreachable here — it is only ever returned via the
    // equivalence engine in the reference branch above.
    has_reference = false;
    if (
      same_metric_formula === false ||
      same_endpoint === false ||
      same_api_format === false
    ) {
      verdict = "not_comparable";
    } else {
      verdict = "weakly_comparable";
      out_notes = [
        ...notes,
        "no paired vLLM reference — cannot prove strong comparability",
      ];
    }
  }

  return {
    same_endpoint: out_same_endpoint,
    same_api_format,
    same_dataset,
    same_dataset_bytes,
    same_prompt_bytes: out_same_prompt_bytes,
    same_payload_fields,
    same_input_length_policy,
    same_output_length_policy: out_same_output_length_policy,
    same_ignore_eos,
    same_max_tokens,
    same_temperature,
    same_seed,
    same_tokenizer_vocab,
    same_metric_formula: out_same_metric_formula,
    same_output_tokens,
    same_accepted_tokens_per_chunk,
    has_reference,
    output_token_count_source: i.outputTokenCountSource,
    verdict,
    notes: out_notes,
  };
}
