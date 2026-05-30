import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";

import * as schema from "./schema";

const dbPath =
  process.env.BENCHTRACE_DB_PATH ??
  path.join(process.cwd(), "benchtrace.db");

declare global {
  var __benchtraceSqlite: Database.Database | undefined;
}

const sqlite =
  globalThis.__benchtraceSqlite ??
  (() => {
    const conn = new Database(dbPath);
    conn.pragma("journal_mode = WAL");
    conn.pragma("foreign_keys = ON");
    conn.pragma("synchronous = NORMAL");
    return conn;
  })();

if (process.env.NODE_ENV !== "production") {
  globalThis.__benchtraceSqlite = sqlite;
}

export const db = drizzle(sqlite, { schema });
export { schema };
export { sqlite };
