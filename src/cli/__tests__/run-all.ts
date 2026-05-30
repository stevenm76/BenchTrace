/**
 * Inline test harness. Runs every *.test.ts file in this folder against tsx.
 * No external test framework — each test file exposes a `tests` array of
 * `{ name, run }`, or a default async fn that takes no args.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TestCase {
  name: string;
  run: () => Promise<void> | void;
}

async function main() {
  const files = (await readdir(__dirname)).filter((f) =>
    f.endsWith(".test.ts"),
  );
  if (files.length === 0) {
    console.error("No *.test.ts files found.");
    process.exit(1);
  }
  let total = 0;
  let failed = 0;
  for (const file of files) {
    const fileUrl = pathToFileURL(path.join(__dirname, file)).href;
    const mod = (await import(fileUrl)) as {
      tests?: TestCase[];
      default?: () => Promise<void> | void;
    };
    const cases = mod.tests ?? (mod.default ? [{ name: file, run: mod.default }] : []);
    for (const t of cases) {
      total += 1;
      const label = `${file} :: ${t.name}`;
      const startedAt = Date.now();
      try {
        await t.run();
        console.log(`  ✓ ${label} (${Date.now() - startedAt}ms)`);
      } catch (err) {
        failed += 1;
        console.error(`  ✗ ${label}`);
        console.error(
          err instanceof Error ? (err.stack ?? err.message) : err,
        );
      }
    }
  }
  console.log(`\n${total - failed}/${total} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
