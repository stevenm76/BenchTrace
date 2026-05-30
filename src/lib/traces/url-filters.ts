import type {
  TraceListFilters,
  TraceSortKey,
} from "@/lib/db/queries/traces";
import type { EngineType, VerificationLevel } from "@/lib/db/schema";

const ENGINE_TYPES: readonly EngineType[] = [
  "vllm",
  "sglang",
  "llamacpp",
  "ollama",
  "generic_openai",
  "other",
];

const VERIFICATION_LEVELS: readonly VerificationLevel[] = [
  "strong",
  "medium",
  "weak",
  "suspicious",
];

const SORT_KEYS: readonly TraceSortKey[] = [
  "created_at",
  "name",
  "output_tokens_per_second",
  "p95_ttft_ms",
  "peak_vram_gb",
  "context_length",
  "verification",
];

function csv(value: string | string[] | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(csv);
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

function num(value: string | string[] | undefined): number | undefined {
  const s = Array.isArray(value) ? value[0] : value;
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function str(value: string | string[] | undefined): string | undefined {
  const s = Array.isArray(value) ? value[0] : value;
  return s?.trim() || undefined;
}

export type RawSearchParams = Record<
  string,
  string | string[] | undefined
>;

export function parseTraceFilters(
  params: RawSearchParams,
): TraceListFilters {
  const engineTypes = csv(params.engines).filter((e): e is EngineType =>
    (ENGINE_TYPES as readonly string[]).includes(e),
  );
  const verificationLevels = csv(params.verifications).filter(
    (v): v is VerificationLevel =>
      (VERIFICATION_LEVELS as readonly string[]).includes(v),
  );
  const quantizations = csv(params.quants);
  const sortByRaw = str(params.sort);
  const sortBy = (SORT_KEYS as readonly string[]).includes(sortByRaw ?? "")
    ? (sortByRaw as TraceSortKey)
    : "created_at";
  const sortDir = str(params.dir) === "asc" ? "asc" : "desc";

  return {
    engineTypes: engineTypes.length ? engineTypes : undefined,
    verificationLevels: verificationLevels.length
      ? verificationLevels
      : undefined,
    quantizations: quantizations.length ? quantizations : undefined,
    contextLengthMin: num(params.minCtx),
    outputTpsMin: num(params.minTps),
    tensorParallelSize: num(params.tp),
    kvCacheDtype: str(params.kv),
    search: str(params.q),
    sortBy,
    sortDir,
  };
}

/** Build a query string for an updated filter set. Drops empty/default keys. */
export function buildTraceQuery(filters: TraceListFilters): string {
  const p = new URLSearchParams();
  if (filters.search) p.set("q", filters.search);
  if (filters.engineTypes?.length) p.set("engines", filters.engineTypes.join(","));
  if (filters.quantizations?.length)
    p.set("quants", filters.quantizations.join(","));
  if (filters.verificationLevels?.length)
    p.set("verifications", filters.verificationLevels.join(","));
  if (filters.contextLengthMin != null)
    p.set("minCtx", String(filters.contextLengthMin));
  if (filters.outputTpsMin != null)
    p.set("minTps", String(filters.outputTpsMin));
  if (filters.tensorParallelSize != null)
    p.set("tp", String(filters.tensorParallelSize));
  if (filters.kvCacheDtype) p.set("kv", filters.kvCacheDtype);
  if (filters.sortBy && filters.sortBy !== "created_at")
    p.set("sort", filters.sortBy);
  if (filters.sortDir === "asc") p.set("dir", "asc");
  return p.toString();
}
