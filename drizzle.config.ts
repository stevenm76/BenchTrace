import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.BENCHTRACE_DB_PATH ?? "./benchtrace.db",
  },
  strict: true,
  verbose: false,
});
