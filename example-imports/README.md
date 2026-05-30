# Example imports

Drop these into the Import wizard to see each parser at work.

| File | Adapter | Demonstrates |
|---|---|---|
| `vllm-bench-serving.json` | `vllm` | Full `bench_serving` JSON shape — percentile arrays, throughput trio, dataset config |
| `llama-bench.json` | `llamacpp` | `llama-bench --output json` row — prefill (`t_pp`) and decode (`t_tg`) timings, GGUF metadata |
| `bundle/` | `bundle` | A complete Trace Bundle: result + launch/benchmark commands + nvidia-smi + server log + notes.md. Selecting **Trace Bundle** in the wizard and dropping all six files in lands a `strong` verification |
| `benchtrace-run/` | `bundle` | A native BenchTrace BT-SERVE-001 run produced by `npm run bench -- serve`. Drop the folder into the Trace Bundle uploader to see a Native badge + Serve Sweep panel land at `strong` verification |

Both files are synthetic but mirror real tool output. The parsers tolerate
both the older and newer key conventions; if your real file fails to parse,
attach it to a GitHub issue.

**Need to know what your real file should look like?** See
[`../docs/import-formats.md`](../docs/import-formats.md) — it lists the
exact CLI command for each tool, the keys each parser reads, and what
fields the source structurally cannot provide. A blank Repro JSON
skeleton lives at [`../docs/repro-json-skeleton.json`](../docs/repro-json-skeleton.json).

## What's NOT included yet

- `sglang-bench-serving.txt` — SGLang adapter is a stub (no parser yet)
- `ollama-show.json` — Ollama adapter is a stub
- `generic-openai-bench.json` — generic OpenAI adapter is a stub

For those engines, use the **Manual / Repro JSON** adapter: export a
`benchtrace.share.v1` document from a similar trace, hand-edit it, then
re-import.
