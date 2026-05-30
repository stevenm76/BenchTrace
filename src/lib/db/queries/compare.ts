import { inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";

export type CompareTrace = NonNullable<
  Awaited<ReturnType<typeof getTracesByIds>>
>[number];

export async function getTracesByIds(ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await db.query.traces.findMany({
    where: inArray(schema.traces.id, ids),
    with: {
      model: true,
      engine: true,
      hardwareProfile: true,
      loaderConfig: true,
      benchmarkProfile: true,
      metricPoints: true,
      artifacts: true,
    },
  });
  // Preserve user-specified order
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((v): v is (typeof rows)[number] => !!v);
}
