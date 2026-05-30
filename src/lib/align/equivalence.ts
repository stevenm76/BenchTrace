/**
 * Pure equivalence engine for vLLM-aligned runs. Given normalized facts about
 * a BenchTrace run and the paired vLLM reference, decide whether the two are
 * actually comparable. The cardinal rule: strong comparability requires PROVEN
 * payload + prompt + output-token equivalence — never config flags alone, and
 * never when speculative-decoding acceptance diverges.
 */

export type Verdict =
  | "strongly_comparable"
  | "weakly_comparable"
  | "not_comparable";

export interface EquivalenceInput {
  endpointBt: string | null;
  endpointRef: string | null;
  btFieldKeys: string[];
  refFieldKeys: string[] | null;
  promptHashesBt: string[];
  promptHashesRef: string[] | null;
  requestedOutputBt: number[];
  requestedOutputRef: number[] | null;
  actualOutputTokensBt: number;
  actualOutputTokensRef: number | null;
  acceptedTokensPerChunkBt: number | null;
  acceptedTokensPerChunkRef: number | null;
  metricFormulaOk: boolean;
  tolerance: { outputTokensPct: number; acceptedTokensPct: number };
}

export interface EquivalenceResult {
  hasReference: boolean;
  sameEndpoint: boolean | null;
  samePayloadFields: boolean | null;
  samePromptBytes: boolean | null;
  sameOutputLengthPolicy: boolean | null;
  sameOutputTokens: boolean | null;
  sameAcceptedTokensPerChunk: boolean | null;
  sameMetricFormula: boolean;
  verdict: Verdict;
  notes: string[];
}

function pctDiff(a: number, b: number): number {
  if (b === 0) return a === 0 ? 0 : Infinity;
  return (Math.abs(a - b) / Math.abs(b)) * 100;
}
function sameStrList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((k) => sb.has(k));
}
function sameNumList(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function computeEquivalence(i: EquivalenceInput): EquivalenceResult {
  const notes: string[] = [];
  const hasReference = i.refFieldKeys != null && i.promptHashesRef != null;

  const sameEndpoint =
    i.endpointRef == null ? null : i.endpointBt === i.endpointRef;

  const samePayloadFields =
    i.refFieldKeys == null ? null : sameSet(i.btFieldKeys, i.refFieldKeys);
  if (samePayloadFields === false) {
    const extra = i.btFieldKeys.filter((k) => !i.refFieldKeys!.includes(k));
    const missing = i.refFieldKeys!.filter((k) => !i.btFieldKeys.includes(k));
    notes.push(
      `request body fields differ from vLLM (extra: [${extra.join(", ")}], missing: [${missing.join(", ")}])`,
    );
  }

  // Prompt hashes are positional: request k's prompt must match reference
  // request k's prompt (replay sends captured token-ids in order), so this is
  // an ordered index-for-index comparison, not an unordered set match.
  const samePromptBytes =
    i.promptHashesRef == null
      ? null
      : sameStrList(i.promptHashesBt, i.promptHashesRef);
  if (samePromptBytes === false) notes.push("prompt token sequences differ from vLLM");

  const sameOutputLengthPolicy =
    i.requestedOutputRef == null
      ? null
      : sameNumList(i.requestedOutputBt, i.requestedOutputRef);
  if (sameOutputLengthPolicy === false)
    notes.push("requested output lengths differ from vLLM");

  const sameOutputTokens =
    i.actualOutputTokensRef == null
      ? null
      : pctDiff(i.actualOutputTokensBt, i.actualOutputTokensRef) <=
        i.tolerance.outputTokensPct;
  if (sameOutputTokens === false)
    notes.push(
      `actual output tokens differ from vLLM by >${i.tolerance.outputTokensPct}%`,
    );

  const sameAcceptedTokensPerChunk =
    i.acceptedTokensPerChunkRef == null || i.acceptedTokensPerChunkBt == null
      ? null
      : pctDiff(i.acceptedTokensPerChunkBt, i.acceptedTokensPerChunkRef) <=
        i.tolerance.acceptedTokensPct;
  if (sameAcceptedTokensPerChunk === false)
    notes.push(
      "speculative-decode accepted-tokens/chunk diverges — throughput/TPOT/E2E not comparable",
    );

  if (!i.metricFormulaOk) notes.push("metric formula not vLLM-compatible");

  let verdict: Verdict;
  if (
    !i.metricFormulaOk ||
    sameEndpoint === false ||
    samePayloadFields === false ||
    sameOutputLengthPolicy === false ||
    sameOutputTokens === false ||
    sameAcceptedTokensPerChunk === false
  ) {
    verdict = "not_comparable";
  } else if (
    hasReference &&
    sameEndpoint === true &&
    samePayloadFields === true &&
    samePromptBytes === true &&
    sameOutputLengthPolicy === true &&
    sameOutputTokens === true &&
    sameAcceptedTokensPerChunk === true &&
    i.metricFormulaOk
  ) {
    verdict = "strongly_comparable";
  } else {
    verdict = "weakly_comparable";
    if (!hasReference)
      notes.push("no paired vLLM reference — cannot prove strong comparability");
    // Strong comparability must PROVE spec-decode acceptance matches — an
    // unmeasured (null) accepted-tokens/chunk on either side cannot back a
    // strong throughput/TPOT claim, even with byte-identical prompts.
    else if (sameAcceptedTokensPerChunk == null)
      notes.push(
        "accepted-tokens/chunk not measured on both sides — cannot prove spec-decode parity",
      );
  }

  return {
    hasReference,
    sameEndpoint,
    samePayloadFields,
    samePromptBytes,
    sameOutputLengthPolicy,
    sameOutputTokens,
    sameAcceptedTokensPerChunk,
    sameMetricFormula: i.metricFormulaOk,
    verdict,
    notes,
  };
}
