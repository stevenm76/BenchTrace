import { and, asc, desc, eq, gte, inArray, like, type SQL } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type {
  EngineType,
  Trace,
  VerificationLevel,
} from "@/lib/db/schema";

export type TraceSortKey =
  | "created_at"
  | "name"
  | "output_tokens_per_second"
  | "p95_ttft_ms"
  | "peak_vram_gb"
  | "context_length"
  | "verification";

export interface TraceListFilters {
  engineTypes?: EngineType[];
  quantizations?: string[];
  verificationLevels?: VerificationLevel[];
  contextLengthMin?: number;
  outputTpsMin?: number;
  tensorParallelSize?: number;
  kvCacheDtype?: string;
  search?: string;
  sortBy?: TraceSortKey;
  sortDir?: "asc" | "desc";
  limit?: number;
}

export type TraceListRow = Trace & {
  model: typeof schema.models.$inferSelect;
  engine: typeof schema.engines.$inferSelect;
  hardwareProfile: typeof schema.hardwareProfiles.$inferSelect;
  loaderConfig: typeof schema.loaderConfigs.$inferSelect | null;
  benchmarkProfile: typeof schema.benchmarkProfiles.$inferSelect | null;
  metricPoints: (typeof schema.metricPoints.$inferSelect)[];
};

/**
 * "Best" metric point for a trace — the row with the highest output tok/s.
 * Used for table column display.
 */
export function bestMetricPoint(trace: TraceListRow) {
  if (trace.metricPoints.length === 0) return null;
  return trace.metricPoints.reduce((best, m) => {
    const cur = m.outputTokensPerSecond ?? -Infinity;
    const bst = best.outputTokensPerSecond ?? -Infinity;
    return cur > bst ? m : best;
  });
}

export async function getTraces(
  filters: TraceListFilters = {},
): Promise<TraceListRow[]> {
  const where: SQL[] = [];
  const {
    engineTypes,
    quantizations,
    verificationLevels,
    contextLengthMin,
    tensorParallelSize,
    kvCacheDtype,
    search,
    sortBy = "created_at",
    sortDir = "desc",
    limit,
  } = filters;

  if (verificationLevels?.length) {
    where.push(inArray(schema.traces.verificationLevel, verificationLevels));
  }
  if (contextLengthMin != null) {
    where.push(gte(schema.traces.contextLength, contextLengthMin));
  }
  if (search) {
    where.push(like(schema.traces.name, `%${search}%`));
  }

  // Engine type + quantization + loader filters live on joined rows; we fetch
  // all matching trace rows then filter in JS for these dimensions. The seed
  // size makes this trivial; revisit when row counts grow.
  let rows = await db.query.traces.findMany({
    where: where.length ? and(...where) : undefined,
    with: {
      model: true,
      engine: true,
      hardwareProfile: true,
      loaderConfig: true,
      benchmarkProfile: true,
      metricPoints: true,
    },
    orderBy: pickOrder(sortBy, sortDir),
    limit,
  });

  if (engineTypes?.length) {
    rows = rows.filter((r) => engineTypes.includes(r.engine.type));
  }
  if (quantizations?.length) {
    rows = rows.filter(
      (r) => r.model.quantization && quantizations.includes(r.model.quantization),
    );
  }
  if (tensorParallelSize != null) {
    rows = rows.filter(
      (r) => r.loaderConfig?.tensorParallelSize === tensorParallelSize,
    );
  }
  if (kvCacheDtype) {
    rows = rows.filter((r) => r.loaderConfig?.kvCacheDtype === kvCacheDtype);
  }
  if (filters.outputTpsMin != null) {
    rows = rows.filter((r) => {
      const best = bestMetricPoint(r);
      return (best?.outputTokensPerSecond ?? 0) >= (filters.outputTpsMin ?? 0);
    });
  }

  // Secondary sort for metric-derived columns that we can't push to SQL.
  if (
    sortBy === "output_tokens_per_second" ||
    sortBy === "p95_ttft_ms" ||
    sortBy === "peak_vram_gb"
  ) {
    rows.sort((a, b) => {
      const aBest = bestMetricPoint(a);
      const bBest = bestMetricPoint(b);
      const aVal =
        sortBy === "output_tokens_per_second"
          ? (aBest?.outputTokensPerSecond ?? -Infinity)
          : sortBy === "p95_ttft_ms"
            ? (aBest?.p95TtftMs ?? Infinity)
            : (aBest?.peakVramGb ?? -Infinity);
      const bVal =
        sortBy === "output_tokens_per_second"
          ? (bBest?.outputTokensPerSecond ?? -Infinity)
          : sortBy === "p95_ttft_ms"
            ? (bBest?.p95TtftMs ?? Infinity)
            : (bBest?.peakVramGb ?? -Infinity);
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });
  }

  return rows;
}

function pickOrder(key: TraceSortKey, dir: "asc" | "desc") {
  const order = dir === "asc" ? asc : desc;
  switch (key) {
    case "name":
      return [order(schema.traces.name)];
    case "context_length":
      return [order(schema.traces.contextLength)];
    case "verification":
      return [order(schema.traces.verificationLevel)];
    case "output_tokens_per_second":
    case "p95_ttft_ms":
    case "peak_vram_gb":
      // Re-sorted in JS after fetch (metric-derived).
      return [desc(schema.traces.createdAt)];
    case "created_at":
    default:
      return [order(schema.traces.createdAt)];
  }
}

export type TraceDetail = NonNullable<
  Awaited<ReturnType<typeof getTraceById>>
>;

export async function getTraceById(id: string) {
  return db.query.traces.findFirst({
    where: eq(schema.traces.id, id),
    with: {
      project: true,
      model: true,
      engine: true,
      hardwareProfile: true,
      loaderConfig: true,
      benchmarkProfile: true,
      costProfile: true,
      artifacts: true,
      metricPoints: {
        with: { metricDefinitions: true },
      },
    },
  });
}

/**
 * Enumerate distinct filter dimension values across all traces. Used by the
 * filter panel to populate its option lists.
 */
export async function getFilterDimensions() {
  const all = await db.query.traces.findMany({
    columns: { id: true },
    with: {
      engine: { columns: { type: true } },
      model: { columns: { quantization: true } },
      loaderConfig: { columns: { tensorParallelSize: true, kvCacheDtype: true } },
    },
  });
  const engineTypes = new Set<string>();
  const quantizations = new Set<string>();
  const tpSizes = new Set<number>();
  const kvDtypes = new Set<string>();
  for (const t of all) {
    engineTypes.add(t.engine.type);
    if (t.model.quantization) quantizations.add(t.model.quantization);
    if (t.loaderConfig?.tensorParallelSize != null) {
      tpSizes.add(t.loaderConfig.tensorParallelSize);
    }
    if (t.loaderConfig?.kvCacheDtype) {
      kvDtypes.add(t.loaderConfig.kvCacheDtype);
    }
  }
  return {
    engineTypes: [...engineTypes].sort(),
    quantizations: [...quantizations].sort(),
    tensorParallelSizes: [...tpSizes].sort((a, b) => a - b),
    kvCacheDtypes: [...kvDtypes].sort(),
  };
}
