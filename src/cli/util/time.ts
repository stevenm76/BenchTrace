import { performance } from "node:perf_hooks";

/** Monotonic milliseconds since process start. */
export function nowMs(): number {
  return performance.now();
}
