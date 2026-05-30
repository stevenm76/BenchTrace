/**
 * Metric-family display logic shared by the dashboard.
 *
 * BenchTrace measures two different per-token latency families and they are
 * NOT interchangeable:
 *
 *   - vLLM-compatible TPOT — token-normalized: (e2e - ttft) / (output_tokens - 1).
 *     Directly comparable to `vllm bench serve`. Stored in p*TpotMs.
 *   - Native chunk-gap latency — mean inter-chunk arrival gap, NOT
 *     token-normalized. When an SSE chunk carries more than one token (e.g.
 *     speculative decoding / MTP) this runs ~Nx higher than TPOT for the same
 *     run. Stored in p*ChunkGapMs.
 *
 * A trace's `metricMode` selects which family is the headline and whether the
 * other should be shown alongside (always with a warning, never silently as
 * "TPOT").
 */

export type MetricMode = "native" | "vllm-compatible" | "both" | null;

export interface MetricFamilyView {
  /** The family to gate SLAs / headline on: token-normalized TPOT or chunk-gap. */
  primary: "tpot" | "chunkGap";
  /** Show both families side-by-side (with a divergence warning). */
  showBoth: boolean;
  /** Header/label for the token-normalized TPOT family. */
  tpotLabel: string;
  /** Header/label for the native chunk-gap family. */
  chunkGapLabel: string;
  /** Short label for the primary family (used in compact stat cards). */
  primaryLabel: string;
  /** When true, the primary value is chunk-gap, which must carry a caveat. */
  primaryIsChunkGap: boolean;
  /** Human note explaining the displayed family; null when nothing to caveat. */
  note: string | null;
}

const TPOT_LABEL = "TPOT (token-norm)";
const CHUNK_GAP_LABEL = "Mean chunk-gap latency";

export function metricFamilyView(mode: MetricMode): MetricFamilyView {
  switch (mode) {
    case "native":
      return {
        primary: "chunkGap",
        showBoth: false,
        tpotLabel: TPOT_LABEL,
        chunkGapLabel: CHUNK_GAP_LABEL,
        primaryLabel: "Chunk-gap p95",
        primaryIsChunkGap: true,
        note:
          "Native mode: this is mean chunk-gap latency (inter-chunk arrival gap), " +
          "NOT token-normalized TPOT. Do not compare it to a vLLM TPOT number — " +
          "with multi-token chunks (e.g. MTP) it runs several× higher.",
      };
    case "both":
      return {
        primary: "tpot",
        showBoth: true,
        tpotLabel: TPOT_LABEL,
        chunkGapLabel: CHUNK_GAP_LABEL,
        primaryLabel: "TPOT p95",
        primaryIsChunkGap: false,
        note:
          "Both metric families shown. TPOT is token-normalized (vLLM-comparable); " +
          "chunk-gap is the inter-chunk arrival gap and is NOT comparable to vLLM TPOT.",
      };
    case "vllm-compatible":
      return {
        primary: "tpot",
        showBoth: false,
        tpotLabel: TPOT_LABEL,
        chunkGapLabel: CHUNK_GAP_LABEL,
        primaryLabel: "TPOT p95",
        primaryIsChunkGap: false,
        note: null,
      };
    default:
      // Legacy / unspecified: we can't prove which family p*TpotMs holds.
      return {
        primary: "tpot",
        showBoth: false,
        tpotLabel: "TPOT",
        chunkGapLabel: CHUNK_GAP_LABEL,
        primaryLabel: "TPOT p95",
        primaryIsChunkGap: false,
        note:
          "Metric mode not recorded for this trace (legacy import). TPOT family " +
          "is unverified — treat cross-tool comparisons with caution.",
      };
  }
}
