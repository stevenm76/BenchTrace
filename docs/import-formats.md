# Import formats

The Import wizard at [`/import`](http://localhost:18000/import) accepts
the raw JSON output from each supported benchmark tool. This doc is the
canonical reference: **what CLI command produces it, what keys the
parser reads, what the source structurally can't provide.**

Sample payloads live in [`../example-imports/`](../example-imports/).

If your real file doesn't parse, the wizard's preview shows which
keys it tried and which it gave up on. Most parser failures are due to
new/renamed keys in newer tool releases — the parsers already tolerate
the most common variants, but file an issue with a redacted sample if
yours doesn't.

---

## 1. vLLM — adapter `vllm`

### How to produce the input

Run vLLM's serving benchmark and save the result:

```bash
python -m vllm.entrypoints.cli.bench serve \
  --model meta-llama/Llama-3.1-70B-Instruct \
  --dataset-name random \
  --random-input-len 1024 \
  --random-output-len 256 \
  --num-prompts 200 \
  --max-concurrency 16 \
  --save-result \
  --result-dir ./bench-output
```

`--save-result` writes a JSON file to `./bench-output/` named
`vllm-<timestamp>.json`. That's the file to upload.

> Older vLLM versions use `python -m vllm.bench_serving` or
> `python benchmarks/benchmark_serving.py`. Same JSON shape.

### Minimum keys

The parser needs **at least one** of:

- `output_throughput` (number) — output tok/s
- `total_throughput` (number) — total tok/s
- `request_throughput` (number) — requests per sec

If none of these are present the parser fails (`parserStatus: "failed"`).

### Recognized keys

| Key | Maps to | Notes |
|---|---|---|
| `model_id`, `model` | `models.name` + `models.repoOrPath` | Either works |
| `backend` | `engines.type` | Should be `"vllm"` |
| `vllm_version` | `engines.version` | Optional |
| `dataset_name` | `benchmark_profile.dataset` | |
| `random_input_len` | `benchmark_profile.inputLength` | |
| `random_output_len` | `benchmark_profile.outputLength` | |
| `random_seed` | `benchmark_profile.randomSeed` | |
| `num_prompts` | `benchmark_profile.numPrompts` | |
| `max_concurrency`, `concurrency` | `benchmark_profile.concurrency`, `metric_points.concurrency` | First match wins |
| `request_rate` | `benchmark_profile.requestRate`, `metric_points.requestRate` | |
| `duration`, `duration_s` | `benchmark_profile.measurementDurationSeconds` | |
| `completed`, `successful_requests` | `metric_points.successfulRequests` | |
| `output_throughput` | `metric_points.outputTokensPerSecond` | |
| `total_throughput` | `metric_points.totalTokensPerSecond` | |
| `request_throughput` | `metric_points.requestsPerSecond` | |
| `median_ttft_ms`, `percentiles_ttft_ms[50]`, `p50_ttft_ms` | `metric_points.p50TtftMs` | First match wins |
| `percentiles_ttft_ms[95]`, `p95_ttft_ms` | `metric_points.p95TtftMs` | |
| `percentiles_ttft_ms[99]`, `p99_ttft_ms` | `metric_points.p99TtftMs` | |
| Same pattern for `tpot_ms`, `itl_ms`, `e2el_ms` | `p50/p95/p99_{tpot,itl,e2eLatency}Ms` | |

The percentile arrays can be either of these shapes; both work:

```json
"percentiles_ttft_ms": [[50, 298.1], [95, 488.7], [99, 612.3]]
"percentiles_ttft_ms": {"50": 298.1, "95": 488.7, "99": 612.3}
```

### What this source can't provide

vLLM bench measures the serving layer; it doesn't probe the hardware.
These fields will always show "not captured by this source":

- `peak_vram_gb`, `average_vram_gb`
- `gpu_utilization_avg`, `gpu_utilization_peak`
- `power_draw_watts_avg`, `gpu_temperature_avg`
- `tokens_per_watt`

To capture them, run `nvidia-smi --query-gpu=… --format=csv` alongside
the benchmark and attach the output to the trace via the Manual
adapter (see below).

### Sample

[`example-imports/vllm-bench-serving.json`](../example-imports/vllm-bench-serving.json)

---

## 2. llama.cpp — adapter `llamacpp`

### How to produce the input

```bash
./llama-bench \
  -m models/Mistral-7B-Instruct-v0.3.Q8_0.gguf \
  -ngl 999 \
  -p 512 \
  -n 128 \
  -t 12 \
  -fa 1 \
  --output json
```

Pipe the stdout to a file. The output is either a single JSON object
(one run) or a JSON array of rows (multiple `-p`/`-n` combinations).
The parser handles both — it imports the **first** row.

### Minimum keys

The parser accepts the input if any of these are present:

- `t_pp` (prefill time, ms) AND `n_prompt`
- `t_tg` (generation time, ms) AND `n_gen`
- `ts_pp` / `ts_tg` (precomputed tokens/sec)
- `model_filename`

### Recognized keys

| Key | Maps to | Notes |
|---|---|---|
| `model_filename` | `models.name`, `models.repoOrPath` | `.gguf` suffix stripped from name |
| `model_type` | `models.architecture` | |
| `quant` | `models.quantization` | |
| `build_commit` | `engines.gitSha` | |
| `n_prompt` | `benchmark_profile.inputLength` | |
| `n_gen` | `benchmark_profile.outputLength` | |
| `t_pp` (ms) + `n_prompt` | derived `prefillTokensPerSecond` | If `ts_pp` not present |
| `t_tg` (ms) + `n_gen` | derived `outputTokensPerSecond` | If `ts_tg` not present |
| `ts_pp` | `metric_points.prefillTokensPerSecond` | Direct tok/s, preferred |
| `ts_tg` | `metric_points.outputTokensPerSecond` | Direct tok/s, preferred |
| `n_runs` | `metric_points.successfulRequests` | |
| `n_threads` | `loader_configs.schedulerSettings.n_threads` | |
| `n_gpu_layers` | `loader_configs.schedulerSettings.n_gpu_layers` + `gpuResidency` (`full` ≥ 999, else `partial`) | |
| `flash_attn` | `loader_configs.flashAttention` | |

Format is hard-coded to `"gguf"` since `llama-bench` only runs GGUFs.

### What this source can't provide

`llama-bench` is a single-user, non-streaming benchmark. It has no
notion of serving concurrency, request rate, or per-request percentiles:

- `p50/p95/p99_ttft_ms`, `p50/p95/p99_tpot_ms`, `p50/p95/p99_itl_ms`
- `requests_per_second`, `max_valid_concurrency`, `failure_rate`
- `peak_vram_gb`, `power_draw_watts_avg`, `gpu_temperature_avg`

### Sample

[`example-imports/llama-bench.json`](../example-imports/llama-bench.json)

---

## 3. Manual / Repro JSON — adapter `manual`

### What it accepts

A complete `benchtrace.share.v1` document. The Zod schema in
[`src/lib/schemas/repro-json.ts`](../src/lib/schemas/repro-json.ts) is
authoritative — every field is documented there with its type and
`.nullable()` status.

### How to produce one

The simplest path: open an existing trace, click **Share**, switch to
the **Repro JSON** tab, hit **Copy** or **Download .json**. That gives
you a known-good document you can edit and re-import.

To author one from scratch, copy [`docs/repro-json-skeleton.json`](./repro-json-skeleton.json)
and fill in the fields you have. Every optional field must be present
as `null` (the schema requires it — missing keys fail validation).

### Minimum requirements

The Zod schema enforces structure but not completeness. You can submit
a document with every value `null` (except `schema_version`,
`trace.name`, `model.name`, and the GPU array) — it will import as a
`weak` or `suspicious` trace.

### What this adapter can capture

Everything. It's the only path for engines without a dedicated parser
(SGLang, Ollama, generic OpenAI-compatible, anything custom). Hand-author
the JSON, attach raw artifacts after import via the trace detail page
once that UI lands (currently artifacts are only added through the
adapter pipeline).

---

## 4. SGLang — adapter `sglang` (stub)

Parser **not yet implemented.** The wizard will fail gracefully with
the message "SGLang adapter is not yet implemented."

### Workaround

Use the Manual adapter. The shape you'd produce from
`python -m sglang.bench_serving --backend sglang …` is very similar to
vLLM's; the future SGLang parser will likely reuse most of the vLLM
field map.

Or: run vLLM serving against the SGLang server (if it's
OpenAI-compatible) and use the vLLM bench client. The resulting JSON
will land as a vLLM trace — tag it with `sglang-backend` for clarity.

---

## 5. Ollama — adapter `ollama` (stub)

Parser **not yet implemented.**

### Workaround

Ollama's `/api/chat` doesn't emit a standard benchmark JSON, so the
authoritative path will probably be: scrape `eval_duration` and
`eval_count` from streaming responses, then derive tok/s. Until that
parser lands, use the Manual adapter and hand-author the fields you
can measure. `ollama show <model>` and `ollama ps` give you the model
metadata + residency.

---

## 6. Generic OpenAI-compatible — adapter `generic_openai` (stub)

Parser **not yet implemented.**

### Workaround

Run the vLLM bench client against the OpenAI-compatible endpoint —
`bench serve` accepts any OpenAI-compatible base URL. The resulting
JSON imports cleanly through the `vllm` adapter; just rename the trace
afterwards.

---

---

## 7. Trace Bundle — adapter `bundle`

### Why

The single-file adapters can only capture what the source tool emits.
vLLM bench, for example, never reports VRAM or the launch command —
so a vLLM-only import lands as `suspicious` because it's irreproducible
on its own.

A **Trace Bundle** wraps the benchmark result with the surrounding
evidence: launch command, benchmark command, hardware snapshot,
optionally server logs and notes. With those present, verification
reaches `strong`.

### Minimum useful bundle

```
benchmark_result.json
benchmark_command.txt
```

### Preferred bundle

```
benchmark_result.json     ← parsed via the matching adapter (vLLM, llama.cpp, …)
launch_command.txt        ← stored on LoaderConfig.launchCommand
benchmark_command.txt     ← stored on BenchmarkProfile.command
nvidia-smi.txt            ← parsed for GPU model / driver / CUDA / VRAM
server.log                ← preserved as an artifact
stdout.log / stderr.log   ← preserved as artifacts
notes.md                  ← populates Trace.notes if not overridden
hardware_snapshot.txt     ← preserved as an artifact (alternative to nvidia-smi)
```

### How to produce one

A short shell helper around any benchmark run:

```bash
set -euo pipefail
mkdir -p run-$(date +%s) && cd "$_"

# 1. Capture the launch command — actually run vLLM in another shell
cat > launch_command.txt <<'EOF'
vllm serve Qwen/Qwen3-235B-A22B-Instruct-NVFP4 \
  --tensor-parallel-size 2 \
  --kv-cache-dtype fp8 \
  --max-model-len 65536
EOF

# 2. Hardware snapshot
nvidia-smi > nvidia-smi.txt

# 3. Capture the benchmark command + run it
cat > benchmark_command.txt <<'EOF'
python -m vllm.entrypoints.cli.bench serve \
  --model Qwen/Qwen3-235B-A22B-Instruct-NVFP4 \
  --random-input-len 1024 --random-output-len 256 \
  --num-prompts 500 --max-concurrency 32 --save-result
EOF
bash benchmark_command.txt
mv vllm-*.json benchmark_result.json

# 4. (optional) notes
cat > notes.md <<'EOF'
Reference run, lab box, NVFP4 weights + FP8 KV.
EOF

# Then drop the whole folder into the Trace Bundle uploader.
```

### How the importer classifies your files

By filename (lowercase, basename). The classifier is lenient about
suffixes and small variations:

| Pattern | Role |
|---|---|
| `benchmark_result*`, `result*`, `*bench_result*` | `benchmark_result` |
| `launch_command*`, `launch_cmd*` | `launch_command` |
| `benchmark_command*`, `bench_command*`, `bench_cmd*` | `benchmark_command` |
| `nvidia-smi*`, `nvidia_smi*` | `nvidia_smi` |
| `hardware_snapshot*`, `hwinfo*` | `hardware_snapshot` |
| `server*`, `*server_log*` | `server_log` |
| `stdout*` / `stderr*` | `stdout` / `stderr` |
| `notes*` or `*.md` | `notes` |

Anything else is preserved as an `other` artifact.

### What happens on import

1. `benchmark_result` is auto-detected against the adapter chain (vLLM,
   llama.cpp, manual). If it parses, metric points + model details land
   normally.
2. `launch_command` is stored on `LoaderConfig.launchCommand`.
3. `benchmark_command` is stored on `BenchmarkProfile.command`.
4. `nvidia-smi` is parsed for driver version, CUDA version, GPU model,
   per-GPU VRAM; merged on top of the adapter's hardware fields (the
   adapter usually doesn't have any).
5. Every file becomes an Artifact row with `sha256`, `parser_status`,
   `raw_json`. The bundle is reproducible from its own evidence.
6. `notes.md` populates `Trace.notes` unless the wizard's override is set.
7. Verification is recomputed — with all four key files present this
   typically lands at `strong`.

### Sample

- [`example-imports/bundle/`](../example-imports/bundle/) — a synthetic
  hand-assembled bundle (vLLM result + commands + nvidia-smi).
- [`example-imports/benchtrace-run/`](../example-imports/benchtrace-run/) —
  output of the native `benchtrace bench serve` runner. The benchmark_result
  is a `benchtrace.share.v1.json` instead of the raw vLLM JSON.
  Importing this folder also lights up the **Native** badge and the
  **Serve Sweep** panel on the trace detail page.

### What this source can't provide

Nothing structurally — the bundle is open-ended; if you have additional
files (`perf.txt`, `flame.svg`, `slo-config.json`), they'll attach as
`other` artifacts. The only things never captured are runtime
observations from a runner that isn't running here yet
(`peak_vram_gb` over the lifetime of the benchmark, etc.).

---

## Auto-detection

If you leave the wizard's adapter selector on **Auto-detect**, the
adapters are tried in this order and the first one whose `canParse()`
returns `true` wins:

1. `vllm` — requires throughput keys
2. `llamacpp` — requires `t_pp` / `t_tg` / `model_filename`
3. `manual` — requires `schema_version: "benchtrace.share.v1"`

Stubs (`sglang`, `ollama`, `generic_openai`) return `canParse: false`
so they never claim a payload they can't handle. If none match, the
wizard shows "Could not auto-detect — choose one from the dropdown."

## Adding a new adapter

The contract lives in
[`src/lib/adapters/types.ts`](../src/lib/adapters/types.ts):

```typescript
export interface BenchmarkAdapter {
  id: string;
  displayName: string;
  description: string;
  canParse(input: unknown): boolean;
  parse(input: unknown): ParseResult;
  getUnavailableFields(): string[];
}
```

To wire a new parser:

1. Add `src/lib/adapters/<name>.ts` implementing the interface.
2. Add it to the `ADAPTERS` array in
   [`src/lib/adapters/index.ts`](../src/lib/adapters/index.ts).
3. (Optional) Add a sample payload to `example-imports/`.

The import pipeline (`src/lib/import/pipeline.ts`) takes care of
upserting entities, computing the fingerprint, attaching the raw text
as an artifact with its SHA-256, and recomputing the verification
level.
