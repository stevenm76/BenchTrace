#!/usr/bin/env node
import { Command } from "commander";

import { registerBenchServe } from "./commands/bench-serve";
import { registerImport } from "./commands/import";
import { BENCHTRACE_VERSION } from "./version";

const program = new Command();
program
  .name("benchtrace")
  .description("BenchTrace native benchmark + import tools")
  .version(BENCHTRACE_VERSION);

registerBenchServe(program);
registerImport(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
