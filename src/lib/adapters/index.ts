import { llamacppAdapter } from "./llamacpp";
import { manualAdapter } from "./manual";
import {
  genericOpenAIAdapter,
  ollamaAdapter,
  sglangAdapter,
} from "./stubs";
import { vllmAdapter } from "./vllm";
import type { BenchmarkAdapter } from "./types";

export const ADAPTERS: BenchmarkAdapter[] = [
  vllmAdapter,
  llamacppAdapter,
  sglangAdapter,
  ollamaAdapter,
  genericOpenAIAdapter,
  manualAdapter,
];

export function getAdapter(id: string): BenchmarkAdapter | null {
  return ADAPTERS.find((a) => a.id === id) ?? null;
}

export function detectAdapter(input: unknown): BenchmarkAdapter | null {
  for (const adapter of ADAPTERS) {
    if (adapter.canParse(input)) return adapter;
  }
  return null;
}
