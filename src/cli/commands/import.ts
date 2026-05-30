import { Command } from "commander";

import { autoImport } from "../output/auto-import";

export function registerImport(program: Command) {
  program
    .command("import <path>")
    .description(
      "Import a benchtrace run folder or a benchtrace.share.v1.json into a local app instance",
    )
    .option(
      "--base-url <url>",
      "BenchTrace web app base URL",
      process.env.BENCHTRACE_BASE_URL ?? "http://localhost:18000",
    )
    .option(
      "--tag <csv>",
      "comma-separated tags to attach (in addition to any in the file)",
    )
    .option("--notes <text>", "override or add notes")
    .action(
      async (
        input: string,
        opts: { baseUrl: string; tag?: string; notes?: string },
      ) => {
        const overrides = {
          notes: opts.notes,
          tags: opts.tag
            ? opts.tag.split(",").map((s) => s.trim()).filter(Boolean)
            : undefined,
        };
        const result = await autoImport({
          inputPath: input,
          baseUrl: opts.baseUrl,
          overrides,
          timeoutMs: 5000,
        });
        if (!result.ok) {
          if (result.skipReason === "unreachable") {
            console.error(`Could not reach ${opts.baseUrl}.`);
          } else {
            console.error(`Import failed: ${result.error}`);
            for (const w of result.warnings ?? []) console.error(`  - ${w}`);
          }
          process.exit(1);
        }
        console.log(`Imported: ${result.traceName}`);
        console.log(`URL:      ${result.url}`);
        if (result.warnings?.length) {
          console.log("Warnings:");
          for (const w of result.warnings) console.log(`  - ${w}`);
        }
      },
    );
}
