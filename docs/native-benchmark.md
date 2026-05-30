# Native benchmark — BT-SERVE-001 Serve Sweep

BenchTrace ships a small benchmark client of its own — `benchtrace bench
serve` — that drives an already-running OpenAI-compatible endpoint
through a stream-count sweep and emits a BenchTrace-native trace
folder. The output is designed to import cleanly through the existing
Trace Bundle path; the resulting trace lands as **strong** verification
without any manual evidence gathering.

This benchmark does **not** launch vLLM / SGLang / llama.cpp / Ollama
for you. It only talks HTTP to a server you're already running.

## Quick start

```bash
# 1. Start any OpenAI-compatible server on http://localhost:8000
#    (vLLM, SGLang, llama.cpp server, Ollama, LM Studio, …)

# 2. Run BenchTrace's dashboard if you want auto-import:
npm run dev

# 3. Sweep concurrency — the trace auto-imports into the dashboard
#    and the URL is printed on the last line of output.
npm run bench -- serve \
  --base-url http://localhost:8000 \
  --model meta-llama/Llama-3.1-70B-Instruct \
  --num-prompts 100 \
  --streams 1,2,4,8,16,32
```

If the dashboard wasn't reachable at run time, the CLI falls back to
printing the manual import command:

```bash
npm run bench -- import ./benchtrace-runs/<the-run-folder>
```

Auto-import behavior:

- **Default**: try `http://localhost:18000`. On success, print the new
  trace URL. On connection failure, print the manual `bench import`
  command and exit normally — the run folder is still written.
- `--import-to <url>` — override the target (e.g. a remote dashboard).
- `--no-import` — skip auto-import entirely (useful for CI / capture
  on a different host).
- `BENCHTRACE_BASE_URL` env var — same effect as `--import-to`, lower
  priority than the flag.

The import lands a trace that shows:

- a **Native** badge in the hero + traces table + dashboard
- a **Serve Sweep** section with the max-valid concurrency callout and
  a per-level validity table (TTFT / TPOT / failure-rate vs the SLAs)
- a list of invalid stream levels and the specific reason each failed
- a **strong** verification level (the runner captures everything except
  the launch command, which becomes a soft warning rather than gating)

## CLI surface

```
benchtrace bench serve [options]

  --base-url <url>             required — server base URL
  --endpoint <path>            default /v1/chat/completions
  --model <name>               required — model name as the server expects
  --profile <id>               default BT-SERVE-001
  --input-len <n>              default 1024  approximate prompt length, tokens
  --output-len <n>             default 256   max_tokens per request
  --num-prompts <n>            default 100   prompts per stream level
  --streams <csv>              default 1,2,4,8,16,32
  --streaming <bool>           default true  use SSE
  --request-rate <n|inf>       default inf   pacing cap, inf = full-throttle
  --ttft-sla-ms <n>            default 5000
  --tpot-sla-ms <n>            default 100
  --failure-threshold <0..1>   default 0.05
  --warmup <n>                 default 1     warmup requests per level (discarded)
  --seed <n>                   default 42    RNG seed for prompts
  --api-key <key>              optional or BENCHTRACE_API_KEY env
  --launch-command-file <p>    optional — contents become loader.launch_command
  --engine-name <s>            default OpenAI-compatible
  --engine-version <s>         default unknown
  --tags <csv>                 optional
  --notes <text>               optional
  --out <dir>                  default ./benchtrace-runs/<auto-name>
  --no-redact                  default false (redaction is on)
  --json-only                  skip share-summary.md
  --import-to <url>            dashboard URL for auto-import after the run
                               default: BENCHTRACE_BASE_URL or http://localhost:18000
  --no-import                  skip auto-import entirely
  --verbose                    progress logging
```

## What gets written

```
benchtrace-runs/<trace-name>/
  benchtrace.share.v1.json        ← canonical share document (Zod-validated)
  share-summary.md                ← human-readable summary, redacted
  manifest.json                   ← filename → sha256 of every file in the folder
  raw/
    per-request-results.jsonl     ← one JSON line per request
    aggregate-results.json        ← per-level + sweep-wide aggregates
    benchmark-command.txt         ← exact CLI invocation, redacted
    launch-command.txt            ← contents of --launch-command-file, or marker
    hardware-snapshot-before.json
    hardware-snapshot-after.json
    nvidia-smi-before.txt
    nvidia-smi-after.txt
```

The folder is written atomically to `<out>.tmp/` first and renamed on
success. `benchtrace bench serve` refuses to overwrite an existing
folder — pick a fresh `--out` for each run.

## How max valid concurrency is decided

For each measured stream level, the level is **valid** iff:

- failure rate ≤ `--failure-threshold` (default 0.05)
- p95 TTFT ≤ `--ttft-sla-ms` (default 5000)
- p95 TPOT ≤ `--tpot-sla-ms` (default 100)

Max valid concurrency = the **highest** stream level that satisfies all
three. The CLI prints it on the last line; the share document records
it as `results.max_valid_concurrency`; the Serve Sweep panel on the
trace detail page crowns the winning row.

If no level passes, the trace records `max_valid_concurrency: null`
and a warning `no_valid_concurrency_level`. The benchmark still
completes and writes its folder — the SLAs are an interpretation aid,
not a gate.

## Importing into the dashboard

Two paths land the same trace:

**a) CLI subcommand**

```bash
npm run bench -- import ./benchtrace-runs/<the-folder>
```

POSTs the folder contents to `POST /api/import` on the running dev
server (default `http://localhost:18000`, override with `--base-url`).
Prints the new trace URL on success.

**b) Web UI drag-and-drop**

1. Open `/import`
2. Pick **Trace Bundle**
3. Drag the run folder (or all files from it) into the uploader

Same result. The folder's `benchtrace.share.v1.json` is the primary
benchmark result; `launch-command.txt`, `benchmark-command.txt`, and
`nvidia-smi-before.txt` populate the loader / workload / hardware
fields; everything else lands as artifacts with sha256 hashes.

## How "strong" verification works for native runs

Normal traces need a launch command captured externally (e.g. via a
Trace Bundle that wraps `launch_command.txt`). Native BenchTrace
traces are exempt: the runner produces and signs every piece of
evidence except how the server was started, so a missing launch
command becomes a soft warning (`launch_command_not_provided`) instead
of dropping verification.

Pass `--launch-command-file ./server-command.txt` to remove the
warning. The contents are copied verbatim into
`loader.launch_command`, redacted at the same time as the benchmark
command.

## Talking to non-vLLM endpoints

Tested implicitly against the in-process mock SSE server. The runner
relies on:

- `POST <endpoint>` with `{ model, messages, max_tokens, stream:
  true|false, stream_options: { include_usage: true } }`
- SSE response with `data: {...}\n\n` events terminated by `data:
  [DONE]\n\n`
- Final usage block with `usage.prompt_tokens` +
  `usage.completion_tokens`

Servers that ignore `stream_options: { include_usage: true }` (some
LM Studio versions) will land with `inputTokens` / `outputTokens` as
`null` in the per-request log and a `usage_not_returned` style warning
in the share document.

## Synthetic prompts

The runner generates deterministic prompts of approximately
`--input-len` tokens from a fixed word bank, seeded by `--seed`. Same
seed + same options + same model = same workload, modulo server-side
nondeterminism (KV cache reuse, kernel scheduling).

Prompt sourcing options like ShareGPT replay or `--prompt-file` are
intentionally deferred; the synthetic generator is enough to compare
configurations apples-to-apples.

## Redaction

Before writing `share-summary.md` and the redacted command files, the
CLI applies the same rules as the web app's Share modal:

- HF tokens, OpenAI-style `sk-*` keys, generic `Bearer …` tokens
- `/home/<user>` and `/Users/<user>` paths
- env var values where the key matches `*SECRET*`, `*TOKEN*`, `*KEY*`,
  `*PASSWORD*`
- IPv4 addresses

Pass `--no-redact` if you're certain the run folder will stay local.
The `raw/per-request-results.jsonl` is never redacted — it contains
timestamps and token counts only, no commands or paths.

## Testing

The CLI ships with an inline test harness — no external test framework
required:

```bash
npm run bench:test     # unit tests + in-process integration test
npm run bench:smoke    # full sweep + import against a running dev server
```

`bench:smoke` spins up the mock server, runs a 3-level sweep against
it, and POSTs the resulting bundle to `http://localhost:18000/api/import`.
It prints the new trace URL on success.

## See also

- [`docs/import-formats.md`](import-formats.md) — full bundle format reference
- [`docs/schema.md`](schema.md) — Repro JSON keys + verification rules
- [`example-imports/benchtrace-run/`](../example-imports/benchtrace-run/) — a sample run folder
