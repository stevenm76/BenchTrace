# Contributing to BenchTrace

Thanks for the interest. BenchTrace is a local-first LLM benchmark
dashboard + CLI. Contributions are welcome via PR.

## Setup

```bash
git clone <your-fork-url>
cd BenchTrace
npm install
npm run db:migrate
npm run seed
npm run dev   # http://localhost:18000
```

Node 20+ is required (enforced via `engines` in `package.json`).
`better-sqlite3` is a native module — prebuilt binaries cover Linux,
macOS, and Windows when available. On exotic toolchains, `node-gyp` will
fall back to building from source (requires Python + a C++ compiler).

## Running tests

```bash
npm run typecheck         # tsc --noEmit
npm run lint              # eslint
npm run bench:test        # CLI + lib unit + integration tests
npm run bench:smoke       # requires `npm run dev` to be running
```

The test harness is custom — `src/cli/__tests__/run-all.ts` auto-discovers
every `*.test.ts` file in that directory. Each test file exports a
`tests` array of `{ name, run }` objects using `node:assert/strict`. See
`src/cli/__tests__/aggregate.test.ts` for the pattern.

## Conventions

- **TypeScript strict.** No `any`. Prefer narrow types.
- **Drizzle schema is authoritative.** Schema changes go via
  `npm run db:generate` (creates a new migration file in `drizzle/`).
  Commit the generated SQL.
- **Repro JSON contract is versioned.** The Zod schema in
  `src/lib/schemas/repro-json.ts` defines `benchtrace.share.v1`. Breaking
  changes require a v2 alongside, not in-place edits.
- **Redaction first.** Anything that flows into a share document goes
  through `src/lib/redaction/index.ts` when the caller is using
  `--redact` (CLI) or the redact toggle (dashboard).
- **CLI uses `tsx` directly** — no compile step. See `src/cli/index.ts`.

## Migration adoption (existing installs only)

If you previously initialised the database with `db:push`, the
`__drizzle_migrations` table doesn't exist yet and `db:migrate` will
fail. Run the adoption script once to mark the baseline migration as
applied:

```bash
npm run db:adopt-baseline
```

After that, `npm run db:migrate` runs cleanly against your existing DB.

## Keep private data out of the repo

This is a public repository. **Never commit:**

- `.env` / `.env.*` files or any real secrets, API keys, or tokens (only
  `.env.example` with placeholders belongs in git).
- Run outputs, benchmark bundles, or the `runs/` directory.
- Local configs and tool state: `.claude/`, `.codex/`, `.cursor/`,
  `*.local.*`.
- Database files or backups: `*.db`, `*.sqlite`, `*.bak`, `*.bak-*`.
- Logs, dumps, or screenshots that contain personal/host data.
- Private infrastructure details: real hostnames, private IPs
  (`10.*`, `172.16–31.*`, `192.168.*`), internal/private model aliases,
  internal ports, absolute home paths (`/home/<you>`, `/Users/<you>`,
  `/root/.cache/...`).
- Internal audit, forensic, parity, or private planning/spec docs.

`.gitignore` already covers the common cases — but check `git status`
before every commit. When in doubt, leave it out.

**Test fixtures must be synthetic or public-source-safe.** Use obviously
fake values (`example.com`, `localhost`, `127.0.0.1`, public model names
like `meta-llama/Llama-3.1-8B-Instruct`). Never paste captured output
from a private server, real user prompts, or real telemetry into a
fixture.

## PR checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run bench:test` passes
- [ ] If you changed `src/lib/db/schema.ts`, you ran `db:generate` and
      committed the new migration in `drizzle/`
- [ ] If you changed `src/lib/schemas/repro-json.ts`, you also updated
      the manual adapter (`src/lib/adapters/manual.ts`) to round-trip
      the new fields, and added a test in
      `src/cli/__tests__/manual-adapter.test.ts`
- [ ] You added or updated tests for non-trivial logic

## Reporting issues

Use GitHub Issues. Include:

- BenchTrace commit hash
- Engine + version (vLLM 0.20.2, etc.)
- Hardware sketch (GPU count + model)
- Steps to reproduce
- Expected vs actual

## Security

See [SECURITY.md](./SECURITY.md). Do **not** run `npm audit fix` blindly
— it has previously downgraded `next` and `drizzle-kit` to ancient
majors. Use the documented advice instead.

## Code of conduct

Be respectful. This is a small project; we don't have a formal CoC yet,
but [the Contributor Covenant](https://www.contributor-covenant.org/)
captures the spirit.
