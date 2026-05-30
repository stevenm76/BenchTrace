/**
 * One-time adoption script for an existing install. Inserts a row into
 * the drizzle __drizzle_migrations table so subsequent `db:migrate` runs
 * treat the existing schema as already at baseline.
 *
 * Safe to run multiple times — uses INSERT OR IGNORE.
 *
 * Usage:
 *   npm run db:adopt-baseline
 */
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";

const DB_PATH = process.env.BENCHTRACE_DB_PATH ?? "./benchtrace.db";

const journal = JSON.parse(
  readFileSync(path.join("drizzle", "migrations", "meta", "_journal.json"), "utf8"),
) as { entries: { idx: number; when: number; tag: string; hash?: string }[] };

if (!journal.entries || journal.entries.length === 0) {
  console.error("No migration entries found in drizzle/migrations/meta/_journal.json");
  process.exit(1);
}

const baseline = journal.entries[0]!;
const sqlPath = path.join(
  "drizzle",
  "migrations",
  `${baseline.tag}.sql`,
);
const sqlContent = readFileSync(sqlPath, "utf8");
const hash = crypto.createHash("sha256").update(sqlContent).digest("hex");
const when = baseline.when ?? Date.now();

const db = new Database(DB_PATH);
db.prepare(
  "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at INTEGER)",
).run();

const existing = db
  .prepare("SELECT id FROM __drizzle_migrations WHERE hash = ?")
  .get(hash) as { id: number } | undefined;

if (existing) {
  console.log(`Baseline migration ${hash} already adopted (id=${existing.id}).`);
} else {
  db.prepare(
    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
  ).run(hash, when);
  console.log(`Baseline migration ${hash} adopted.`);
}

db.close();
