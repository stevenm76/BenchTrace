/**
 * Vendor-agnostic GPU snapshot. Despite the file name (kept for backwards
 * compatibility with the bundle classifier), this now tries nvidia-smi, then
 * rocm-smi (AMD), then macOS system_profiler — returning the first that
 * yields something. Returns null if none of them produce GPU info.
 *
 * Behavior is intentionally a superset of the old nvidia-only path: when
 * a machine has NVIDIA cards, the output is unchanged.
 */

import { probeGpus } from "./gpu-probe";

export async function captureNvidiaSmi(): Promise<string | null> {
  const probe = await probeGpus();
  return probe.rawText;
}
