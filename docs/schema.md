# Schema reference

## Database

SQLite via `better-sqlite3`, schema declared in `src/lib/db/schema.ts`
using Drizzle ORM. The schema is a single file by design — readable as a
single document for the whole MVP.

### Entities

```
projects                Optional grouping for traces.
models                  Model identity + quantization + tokenizer metadata.
engines                 vLLM / SGLang / llama.cpp / Ollama / generic — name, version, type.
hardware_profiles       CPU, RAM, OS, kernel, GPUs (JSON array), CUDA/ROCm, container.
loader_configs          Engine launch command + env + TP/PP/DP + KV dtype + flags.
benchmark_profiles      Per-trace instance of a BT-* workload definition.
traces                  Core trace row, FK to all of the above. verificationLevel persisted.
metric_points           One row per measured concurrency or request rate.
metric_definitions      Per-metric provenance (raw name, source tool, percentile, definition).
cost_profiles           Optional cost estimates.
artifacts               Raw files attached to a trace + parser status + sha256.
```

### Conventions

- **IDs** are 24-char text cuid2, never numeric autoincrement, to allow
  merging imports from multiple machines.
- **Timestamps** are stored as integer epoch milliseconds (Drizzle
  `integer({ mode: "timestamp_ms" })`).
- **Booleans** are stored as 0/1 integers (Drizzle
  `integer({ mode: "boolean" })`).
- **Arrays and free-form objects** are stored as JSON text columns
  (`text({ mode: "json" })`). Only fields used in filters/sorting live
  as typed scalar columns.
- **Missing data** is `null` everywhere. Strings like `"not_captured"`
  or `"unknown"` are reserved for cases where the system captured
  context but the value is genuinely absent — they should not collide
  with real data.

### Foreign keys

Foreign keys are declared in the schema and enforced via
`PRAGMA foreign_keys = ON` in `src/lib/db/index.ts`. Cascade rules:

| From | To | onDelete |
|---|---|---|
| `traces.project_id` | `projects.id` | set null |
| `traces.model_id` | `models.id` | restrict |
| `traces.engine_id` | `engines.id` | restrict |
| `traces.hardware_profile_id` | `hardware_profiles.id` | restrict |
| `traces.loader_config_id` | `loader_configs.id` | set null |
| `traces.benchmark_profile_id` | `benchmark_profiles.id` | set null |
| `loader_configs.engine_id` | `engines.id` | cascade |
| `metric_points.trace_id` | `traces.id` | cascade |
| `metric_definitions.metric_point_id` | `metric_points.id` | cascade |
| `cost_profiles.trace_id` | `traces.id` | cascade |
| `artifacts.trace_id` | `traces.id` | cascade |

### Indexes

Filterable + sortable scalar columns are indexed:
`models.name`, `models.quantization`, `models.architecture`,
`engines.type`, `engines.version`,
`traces.model_id`, `traces.engine_id`, `traces.verification_level`,
`traces.created_at`, `traces.fingerprint`,
`metric_points.trace_id`, `metric_points.output_tokens_per_second`,
`metric_points.p95_ttft_ms`,
`artifacts.trace_id`.

## Repro JSON (`benchtrace.share.v1`)

Defined as a Zod schema in `src/lib/schemas/repro-json.ts`. Built by
`buildReproJson()` in `src/lib/export/repro-json.ts` and validated
before returning — any divergence in shape is treated as a developer
bug.

The schema is intentionally explicit: every optional field is emitted
as `null` rather than omitted, so missing data is part of the record.

Top-level keys:

- `schema_version` — literal `"benchtrace.share.v1"`
- `trace` — name, created_at, tags, fingerprint
- `hardware` — CPU, RAM, OS, kernel, GPUs, drivers, container
- `model` — name, provider, architecture, quantization, tokenizer, etc.
- `loader` — engine name + version, launch_command, env, environment{TP/PP/DP/KV/...}
- `benchmark` — tool, command, dataset, input/output length, concurrency
- `benchmark_profile` — when associated with a BT-* profile (else null)
- `results` — flat dictionary of every aggregated metric (peak/min/mean)
- `metric_definitions` — provenance for each normalized metric (source
  tool, raw name, definition, percentile)
- `cost` — optional cost estimates
- `verification` — level, artifact list, missing_fields, warnings, notes

## Verification levels

Computed by `computeVerification()` in `src/lib/verification/index.ts`.

| Level | Trigger |
|---|---|
| `suspicious` | Impossible values (tok/s > 100k, p95<p50), no metrics, or metrics without a launch/bench command. |
| `strong` | Checklist score 7+/8 with no warnings. |
| `medium` | Checklist score 4–6 with no warnings. |
| `weak` | Anything else. |

Checklist items: raw artifact present, parsed artifact, artifact hash,
launch command, benchmark command, model details complete,
engine version, hardware profile complete, ≥1 metric point.

## Benchmark profiles

Static definitions in `src/lib/benchmark-profiles/index.ts`. Six
profiles cover the workload axes: chat (BT-CHAT-001), coding agent
(BT-CODE-001), batch (BT-BATCH-001), long context (BT-LONGCTX-001),
serving (BT-SERVE-001), prefill/decode split (BT-PREFILL-DECODE-001).

A trace optionally references a profile via its
`benchmark_profile.profile_id`; the static definition is then matched
back in via `getBenchmarkProfile()`.

## Adapters

Parser-only in the MVP (no execution). Interface in
`src/lib/adapters/types.ts`, implementations in
`src/lib/adapters/{vllm,llamacpp,manual}.ts` and stubs in
`src/lib/adapters/stubs.ts`.

Each adapter declares `getUnavailableFields()` — fields its source
format structurally cannot provide — so the UI can show
"not captured by this source" rather than the generic "not captured".
