# BenchTrace

Local-first LLM performance trace system. Turns messy benchmark outputs
from vLLM, SGLang, llama.cpp, Ollama, and generic OpenAI-compatible
servers into **structured, comparable, verifiable, and shareable**
performance traces.

> A benchmark result is only useful if it's understandable, comparable,
> and reproducible. `Qwen 35B — 175 tok/s` isn't.

BenchTrace can both **ingest** results from external tools (vLLM bench,
llama-bench, hand-authored bundles) and **produce** its own — a native
serve-sweep benchmark (`benchtrace bench serve`, profile **BT-SERVE-001**)
drives any OpenAI-compatible endpoint through a stream-count sweep and
lands a `strong`-verification trace in the dashboard.

**Design principle: missing data is visible, never silent.** Every field
that the schema can capture is rendered in the UI; absent values render
as an amber `—` with a "not captured" tooltip. Adapters declare fields
their source format structurally cannot provide, so the user can tell
the difference between "not measured" and "the tool never knew."

## Routes

| Path | What |
|---|---|
| [`/`](http://localhost:18000/) | Dashboard — Hero summary card, plus charts and tables that scale with the Basic / Intermediate / Expert tier toggle |
| [`/traces`](http://localhost:18000/traces) | Filterable, sortable explorer (URL-encoded filters) |
| [`/traces/[id]`](http://localhost:18000/traces) | Full detail incl. Serve Sweep panel for BT-SERVE-001 runs, missing-fields panel, Share modal |
| [`/compare?ids=…`](http://localhost:18000/compare) | Delta table + side-by-side charts, comparability warnings |
| [`/profiles`](http://localhost:18000/profiles) | Per-BT-profile rankings |
| [`/import`](http://localhost:18000/import) | 5-step wizard: pick adapter → upload → preview → override → commit |
| `/api/export/[id]/json` · `/markdown` | Repro JSON / Markdown downloads (`?redact=`, `?paths=`, `?download=`) |
| `/api/import` | `POST {action:"preview"\|"commit"\|"bundle_preview"\|"bundle_commit"}` |

CLI:

| Command | What |
|---|---|
| `npm run bench -- serve --base-url … --model …` | Native BT-SERVE-001 sweep against an OpenAI-compatible server |
| `npm run bench -- import <path>` | POST a run folder or `benchtrace.share.v1.json` to the local dashboard |

## What's here

| Area | Status | Path |
|---|---|---|
| **Native benchmark** — `benchtrace bench serve` (BT-SERVE-001 sweep) | ✓ | [`src/cli/`](src/cli) · [`docs/native-benchmark.md`](docs/native-benchmark.md) |
| Import — vLLM, llama.cpp, Manual JSON, Trace Bundle | ✓ | [`src/lib/adapters/`](src/lib/adapters), [`src/lib/import/bundle.ts`](src/lib/import/bundle.ts), [`src/app/import/page.tsx`](src/app/import/page.tsx) |
| Schema (SQLite + Drizzle, 11 entities) | ✓ | [`src/lib/db/schema.ts`](src/lib/db/schema.ts) |
| Repro JSON contract (`benchtrace.share.v1`) | ✓ | [`src/lib/schemas/repro-json.ts`](src/lib/schemas/repro-json.ts) |
| Seed data — 5 synthetic traces (vLLM × 2, SGLang, llama.cpp, Ollama) | ✓ | [`src/seed/index.ts`](src/seed/index.ts) |
| Tier-aware dashboard (hero card + tier-gated charts) | ✓ | [`src/app/page.tsx`](src/app/page.tsx) |
| Traces explorer (filter / sort / search) | ✓ | [`src/app/traces/`](src/app/traces) |
| Trace detail — tier-gated sections + Serve Sweep panel for BT-SERVE-001 + Missing-fields panel (Expert tier) | ✓ | [`src/app/traces/[id]/page.tsx`](src/app/traces/%5Bid%5D/page.tsx) |
| Compare (delta table + comparability warnings) | ✓ | [`src/app/compare/page.tsx`](src/app/compare/page.tsx) |
| Performance profiles (BT-CHAT/CODE/BATCH/LONGCTX/SERVE/PREFILL) | ✓ | [`src/app/profiles/page.tsx`](src/app/profiles/page.tsx) |
| Share modal — Card + Markdown + Repro JSON + ZIP bundle | ✓ | [`src/components/share/`](src/components/share) |
| Redaction (HF tokens, API keys, home paths, env secrets, IPs) | ✓ | [`src/lib/redaction/`](src/lib/redaction) |
| Verification level computation (+ native-strong carve-out) | ✓ | [`src/lib/verification/`](src/lib/verification) |
| Adapter stubs — SGLang, Ollama, generic OpenAI | stub | [`src/lib/adapters/stubs.ts`](src/lib/adapters/stubs.ts) |
| Example import payloads + a real native run | ✓ | [`example-imports/`](example-imports) |
| Schema reference · native benchmark docs · import formats | ✓ | [`docs/`](docs) |

## Stack

- **Next.js 16** App Router · **React 19** · **TypeScript** strict
- **Tailwind v4** · **shadcn/ui** · **Recharts**
- **SQLite** (`better-sqlite3`, WAL) · **Drizzle ORM**
- **Zod** for import + export validation
- **html-to-image** for share-card PNG · **JSZip** for evidence bundles
- **commander** + **tsx** for the native benchmark CLI; no separate test
  framework — the inline harness in `src/cli/__tests__/` runs unit +
  integration tests via tsx

The UI ships with a **Basic / Intermediate / Expert tier toggle** (sidebar
footer) that progressively discloses detail, and a **light / system / dark
theme toggle** — light "Cool Slate" is the default.

## Running

```bash
npm install
npm run db:migrate    # apply baseline + any pending schema migrations
npm run seed          # populate 5 synthetic traces
npm run dev           # http://localhost:18000
```

Other scripts:

```bash
npm run typecheck     # tsc --noEmit
npm run db:studio     # drizzle-kit studio (web GUI for the DB)
npm run seed:clear    # wipe seed data without re-inserting
npm run lint
npm run build
npm run bench         # run the native benchmark CLI (see below)
npm run bench:test    # CLI unit + integration tests
npm run bench:smoke   # full sweep + import against a running dev server
```

The SQLite file lives at `./benchtrace.db` (gitignored).

### Upgrading an existing install

If you pulled a schema change and the install was previously done via
`db:push`, run `npm run db:adopt-baseline` once to mark the existing
schema as baseline, then `npm run db:migrate` for any new migrations.
On a fresh clone, `npm run db:migrate` runs from scratch and the
database file is created automatically.

## Running the native benchmark

BenchTrace ships its own benchmark — `benchtrace bench serve` — that
drives any already-running OpenAI-compatible endpoint through a
stream-count sweep and emits a BenchTrace-native trace bundle.

```bash
# Sweep 1, 2, 4, 8, 16, 32 concurrent streams against a local vLLM
npm run bench -- serve \
  --base-url http://localhost:8000 \
  --model meta-llama/Llama-3.1-70B-Instruct \
  --num-prompts 100 \
  --streams 1,2,4,8,16,32

# Push the result into the dashboard
npm run bench -- import ./benchtrace-runs/<the-run-folder>
```

What you get:

- a **Native** badge in the hero / table / dashboard
- a **Serve Sweep** section with max-valid concurrency callout, per-level
  validity table (TTFT / TPOT / failure-rate vs the SLAs), and the
  reasons each failing level failed
- **strong** verification — the runner captures everything except how
  the server was launched, which lands as a soft warning rather than
  dropping the level

See [`docs/native-benchmark.md`](docs/native-benchmark.md) for the full
CLI surface, output folder layout, redaction rules, and the
"native-strong" carve-out in the verification logic.

A worked example folder lives at
[`example-imports/benchtrace-run/`](example-imports/benchtrace-run/) — drop
it into the Trace Bundle wizard to see the native UX without running a
server.

> **Note:** All numbers, model names, and hardware in `example-imports/`
> and in the seed data are **synthetic sample data** for demonstration
> only. They are not official vendor benchmarks and do not reflect any
> particular deployment. Figures like `Qwen 35B — 175 tok/s` above are
> illustrative.

## Importing benchmark results

1. Open `/import`.
2. Pick the source format (or leave Auto-detect).
3. Paste or upload the raw output. Example payloads in [`example-imports/`](example-imports/).
4. Click **Parse**. The preview shows parsed fields, parser confidence,
   warnings, and a list of fields the source structurally can't provide.
5. Optionally override trace name, tags, notes.
6. Click **Import trace** → routes to the new trace detail page.

The raw input is attached as an artifact with its SHA-256 hash so every
trace is reproducible from its own evidence.

> **What format does the parser want?** See
> [`docs/import-formats.md`](docs/import-formats.md) — covers the exact
> CLI command to run for each tool, the keys the parser reads, what
> the source structurally can't provide, and a skeleton you can
> hand-author for unsupported engines.

### Adapter coverage

| Adapter | MVP status |
|---|---|
| `vllm` | Full — `bench_serving` JSON, handles legacy + current key names, percentile arrays + objects |
| `llamacpp` | Full — `llama-bench --output json`, derives prefill + decode tok/s |
| `manual` | Full — re-imports an exported `benchtrace.share.v1` document, Zod-validated |
| `bundle` | Full — **Trace Bundle**: multi-file import (result + launch/benchmark commands + nvidia-smi + logs + notes). Lifts verification from "suspicious" to "strong" |
| `sglang` | Stub — interface ready; parser TODO |
| `ollama` | Stub |
| `generic_openai` | Stub |

Stubs fail gracefully with `parserStatus: "failed"` and a clear warning.
For unsupported engines, export a similar trace's Repro JSON, hand-edit
it, and re-import via the Manual adapter.

## The Repro JSON contract

Every trace can be exported as a `benchtrace.share.v1` document — a
versioned, Zod-validated JSON containing **everything** about the run:
hardware, model, loader config, benchmark workload, normalized
metrics, metric provenance, cost (when known), and verification.

- Every optional field is emitted as `null` rather than omitted.
  Missing data is part of the record.
- The output is validated against the Zod schema before being returned,
  so any internal divergence in shape throws on the server rather than
  silently shipping a malformed document.

See [`docs/schema.md`](docs/schema.md#repro-json-benchtracesharev1) for
the full key list.

## Verification

Every trace stores a `verificationLevel` computed by
[`src/lib/verification/index.ts`](src/lib/verification/index.ts) from the
trace's commands, artifacts, hardware, and metric points.

| Level | Rule |
|---|---|
| **strong** | Raw artifact + launch_command + benchmark_command + workload populated + model **or** engine version + hardware complete + ≥1 metric point — **and no warnings** |
| **medium** | Raw artifact + at least one command + at least one of (model details, engine version, workload details) |
| **weak** | Metrics only / missing commands / missing workload |
| **suspicious** | Any warning fires — wins over the other levels. Triggered by impossible tok/s, percentile ordering inconsistencies, throughput-without-workload, metrics-without-command-and-artifact, no metric points at all |

**Native-strong carve-out**: when the trace is produced by
`benchtrace bench serve` (detected via `nativeBenchmarkTool === "benchtrace"`
or `benchmarkProfile.tool === "benchtrace"`), a missing
`launch_command` becomes a soft warning (`launch_command_not_provided`)
instead of dropping verification. The runner captures and signs every
other piece of evidence; vouching for its own provenance is enough.

The Trace Detail page's "Verification" section shows the live checklist
plus the missing-critical-field count. The seed data ships with a mix
(2 strong, 2 medium, 1 weak) so you can see each badge. **The fastest
path to a `strong` trace from a real server is `npm run bench -- serve …`**
(see "Running the native benchmark" above); for traces from external
tools, wrap the result in a [Trace Bundle](docs/import-formats.md#7-trace-bundle--adapter-bundle).

## Comparability

`/compare?ids=a,b,c` shows a delta table. Differences across these
dimensions are flagged:

- **Critical**: model, quantization, engine type, context length,
  tensor parallel size, benchmark profile, input length, output length,
  GPU profile
- **Advisory**: engine version, KV cache dtype, speculative decoding,
  CPU offload, dataset, benchmark tool, CUDA/ROCm version, driver
  version

Mismatches are surfaced but never block comparison — they're an
interpretation aid, not a gate.

## Sharing

The Share button on every trace opens a modal with four tabs:

- **Card** — polished visual PNG (downloadable via html-to-image)
- **Markdown** — GitHub-ready summary with collapsible commands
- **Repro JSON** — the full `benchtrace.share.v1` document
- **Evidence bundle** — ZIP with `benchtrace.json` + `share-summary.md`
  + `share-card.png` + redacted command files

Two redaction toggles in the modal header:

1. **Redact secrets & home paths** (on by default) — Hugging Face
   tokens, OpenAI-style keys, Bearer tokens, `/home/<user>`,
   `/Users/<user>`, env vars with `SECRET`/`TOKEN`/`KEY`/`PASSWORD`,
   IPv4 addresses
2. **Also redact local model paths** (off by default) — opt-in:
   `/foo/bar/qwen.gguf` → `<local_model_path>`

A breakdown of redacted items is shown above the preview.

## BenchTrace benchmark profiles

Six standardized workload contracts. `BT-SERVE-001` is implemented
natively; the others are scored from imported traces and will be wired
to the native runner as it grows.

| ID | Use case | Primary metric | Status |
|---|---|---|---|
| `BT-CHAT-001` | Single-user chat | minimize TTFT p95 | scoring only |
| `BT-CODE-001` | Coding agent | maximize prefill tok/s | scoring only |
| `BT-BATCH-001` | Batch generation | maximize total tok/s | scoring only |
| `BT-LONGCTX-001` | Long context | maximize context tested | scoring only |
| `BT-SERVE-001` | Serving concurrency | maximize max valid concurrency | **native runner** ✓ |
| `BT-PREFILL-DECODE-001` | Prefill vs decode diagnostic | prefill/decode ratio | scoring only |

Definitions in [`src/lib/benchmark-profiles/index.ts`](src/lib/benchmark-profiles/index.ts).
Local ranking views in [`/profiles`](/profiles).

## Security & dependency advice

**Do not run `npm audit fix`** on this repo. It will silently downgrade
`next` and `drizzle-kit` to ancient majors and introduce dozens of new
vulnerabilities. The 6 remaining audit findings are accepted and
documented in [`SECURITY.md`](SECURITY.md).

## Current limitations

- **The native benchmark only drives serving endpoints — it does not
  launch them.** `benchtrace bench serve` talks HTTP to an
  already-running OpenAI-compatible server (vLLM, SGLang, llama.cpp,
  Ollama, LM Studio, …). Engine launching is not yet implemented.
- **Only `BT-SERVE-001` has a native runner.** The other five profiles
  are scoring-only — they rank imported traces.
- **SGLang, Ollama, generic OpenAI parsers** are stubs. They fail
  gracefully with a "parser not yet implemented" warning; use the
  Manual / Repro JSON adapter or Trace Bundle for those engines.
- **Recharts dev-mode console warning** about `width(-1)` is a known
  flicker before ResizeObserver fires; charts render correctly. Doesn't
  appear in production builds.
- **Local single user.** No auth, no multi-tenancy. SQLite WAL is the
  concurrency model.
- **No hosted sharing.** Card / Markdown / JSON / ZIP are downloads;
  there are no hosted share URLs.

## Direction

`BT-SERVE-001` shipped first because it's the most useful for the
common "how many concurrent streams can I push?" question. The next
likely additions:

- **More native profiles** — `BT-CHAT-001`, `BT-CODE-001`, and
  `BT-BATCH-001` mostly need the same SSE plumbing plus a different
  workload shape. They'll share `src/cli/runner/request.ts`.
- **`BT-LONGCTX-001`** needs a tokenizer dep to hit precise input
  lengths, so it's slightly heavier.
- **Engine-launching runner** — when this lands, it slots into the
  existing adapter IDs (`vllm`, `sglang`, `llamacpp`, …) so a captured
  artifact flows through the same parser whether produced by us or by
  the engine's own bench tool.
- **Real SGLang / Ollama parsers** to replace the current stubs, so
  imports from those engines don't have to round-trip through the
  Manual adapter.

Until engine launching arrives, the bundle path (`Trace Bundle`
adapter) plus the native serve sweep cover the practical workflow:
launch your server however you want, capture `launch_command.txt` +
`nvidia-smi.txt` alongside the result, hand the folder to BenchTrace.
