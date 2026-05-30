/**
 * Per-adapter user-facing guidance for the Import wizard. Bundled into the
 * client component so users don't have to read external docs to make their
 * first import work.
 */

import vllmExampleRaw from "../../../example-imports/vllm-bench-serving.json";
import llamacppExampleRaw from "../../../example-imports/llama-bench.json";
import skeletonRaw from "../../../docs/repro-json-skeleton.json";

const VLLM_EXAMPLE = JSON.stringify(vllmExampleRaw, null, 2);
const LLAMACPP_EXAMPLE = JSON.stringify(llamacppExampleRaw, null, 2);
const REPRO_SKELETON = JSON.stringify(skeletonRaw, null, 2);

export interface AdapterGuidance {
  /** One-line summary shown above the help block. */
  intro: string;
  /** Shell command the user runs to produce the input file. */
  cliCommand?: string;
  /** Where the produced file ends up (so the user knows what to upload). */
  outputHint?: string;
  /** Sample payload — gets loaded into the textarea when the user clicks "Load example". */
  examplePayload?: string;
  /** Marks the adapter as not implemented; UI suggests Manual. */
  isStub?: boolean;
  /** Free-form tips. */
  tips?: string[];
}

export const GUIDANCE: Record<string, AdapterGuidance> = {
  auto: {
    intro:
      "Auto-detect tries every parser until one matches. Works for vLLM JSON, llama-bench JSON, or a previously exported BenchTrace document. If detection fails, pick a parser by hand.",
  },

  vllm: {
    intro:
      "Run vLLM's serving benchmark with --save-result. The JSON file it writes is what you upload here.",
    cliCommand: `python -m vllm.entrypoints.cli.bench serve \\
  --model meta-llama/Llama-3.1-70B-Instruct \\
  --dataset-name random \\
  --random-input-len 1024 \\
  --random-output-len 256 \\
  --num-prompts 200 \\
  --max-concurrency 16 \\
  --save-result \\
  --result-dir ./bench-output`,
    outputHint:
      "Upload ./bench-output/vllm-<timestamp>.json (some vLLM versions use python -m vllm.bench_serving — same JSON shape).",
    examplePayload: VLLM_EXAMPLE,
    tips: [
      "vLLM bench measures the serving layer only — VRAM, power, temperature, and GPU utilization will show 'not captured'. Run nvidia-smi alongside to fill them in later.",
      "Both percentile formats are accepted: [[50, 298.1], [95, 488.7]] arrays and {\"50\": 298.1, \"95\": 488.7} objects.",
    ],
  },

  llamacpp: {
    intro:
      "Run llama-bench with --output json and pipe stdout to a file. Single-row or multi-row arrays both work; the parser imports the first row.",
    cliCommand: `./llama-bench \\
  -m models/Mistral-7B-Instruct-v0.3.Q8_0.gguf \\
  -ngl 999 \\
  -p 512 \\
  -n 128 \\
  -t 12 \\
  -fa 1 \\
  --output json > bench.json`,
    outputHint: "Upload bench.json.",
    examplePayload: LLAMACPP_EXAMPLE,
    tips: [
      "llama-bench is single-user and non-streaming — TTFT, TPOT, ITL percentiles and concurrency / request rate / failure rate are structurally unavailable and will show 'not captured'.",
      "Format is hard-coded to GGUF since that's all llama-bench runs.",
    ],
  },

  manual: {
    intro:
      "Paste a complete benchtrace.share.v1 JSON document. This is the only path for engines without a dedicated parser — hand-author the fields you have.",
    outputHint:
      "Easiest path: open an existing trace, hit Share → Repro JSON → Download. Edit the resulting file, then upload it here.",
    examplePayload: REPRO_SKELETON,
    tips: [
      "Every optional field must be present as null — the schema validates structure, not completeness. Missing keys fail Zod validation.",
      "The resulting trace's verification level will reflect what you fill in: most fields null → weak/suspicious; commands, hardware, and metrics filled → medium/strong.",
    ],
  },

  sglang: {
    intro:
      "The SGLang adapter is a stub — the parser is not implemented yet.",
    isStub: true,
    tips: [
      "Workaround: run vLLM's bench client against the SGLang OpenAI-compatible endpoint, then use the vLLM adapter (most key names align). Tag the trace with sglang-backend for clarity.",
      "Or: switch to the Manual adapter and hand-author a benchtrace.share.v1 document. Use Repro JSON skeleton as a starting point.",
    ],
  },

  ollama: {
    intro: "The Ollama adapter is a stub — the parser is not implemented yet.",
    isStub: true,
    tips: [
      "Ollama doesn't emit a standard benchmark JSON; the dedicated parser will scrape eval_duration and eval_count from streaming responses.",
      "For now: switch to the Manual adapter. Use 'ollama show <model>' and 'ollama ps' to fill in model metadata + residency, derive tok/s by hand.",
    ],
  },

  generic_openai: {
    intro:
      "The generic OpenAI-compatible adapter is a stub — the parser is not implemented yet.",
    isStub: true,
    tips: [
      "Cleanest workaround: run vLLM's bench client against the OpenAI-compatible endpoint (it accepts any base URL). The resulting JSON imports cleanly through the vLLM adapter.",
      "Or: switch to the Manual adapter.",
    ],
  },

  bundle: {
    intro:
      "Upload a folder of evidence around one benchmark run. The bundle gives you a much higher verification level than a single result file because it captures the launch command, benchmark command, and a hardware snapshot alongside the result.",
    outputHint:
      "Files are classified by filename: benchmark_result.json or benchtrace.share.v1.json → primary result · launch_command.txt → engine command · benchmark_command.txt → workload command · nvidia-smi.txt → hardware · server.log / stdout / stderr / notes.md → preserved as artifacts.",
    tips: [
      "Minimum useful bundle: benchmark_result.json + benchmark_command.txt. Add launch_command.txt + nvidia-smi.txt to reach 'strong' verification.",
      "Save your run with a small helper: `nvidia-smi > nvidia-smi.txt; echo 'vllm serve …' > launch_command.txt; echo 'python -m vllm.bench …' > benchmark_command.txt`, then zip the result.json alongside.",
      "Or skip the helper entirely: `npm run bench -- serve --base-url http://localhost:8000 --model your/model` produces a runnable bundle automatically, including benchtrace.share.v1.json and nvidia-smi snapshots before/after.",
      "Every file is stored as an artifact with its sha256, so the trace stays reproducible from its own evidence.",
    ],
  },
};
