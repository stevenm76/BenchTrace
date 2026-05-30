/**
 * Engine-keyed chart palette. Light + dark variants resolve to the same
 * semantic value (e.g. "vllm = sky"); the chosen oklch lightness differs
 * so the color reads well on each backdrop.
 *
 * Light values are calibrated against the Cool Slate (#f8fafc) backdrop.
 * Dark values are calibrated against the existing slate-tinted dark
 * background. Keep these two tables in sync — same key set, same order.
 */

export type Engine = "vllm" | "sglang" | "llamacpp" | "ollama" | "generic" | "other";

const LIGHT_ENGINE: Record<Engine, string> = {
  vllm: "#0284c7", // sky-600
  sglang: "#8b5cf6", // violet-500
  llamacpp: "#f59e0b", // amber-500
  ollama: "#14b8a6", // teal-500
  generic: "#94a3b8", // slate-400
  other: "#94a3b8",
};

const DARK_ENGINE: Record<Engine, string> = {
  vllm: "#38bdf8", // sky-400, brighter for dark
  sglang: "#a78bfa", // violet-400
  llamacpp: "#fbbf24", // amber-400
  ollama: "#2dd4bf", // teal-400
  generic: "#cbd5e1", // slate-300
  other: "#cbd5e1",
};

function normalize(engine: string | null | undefined): Engine {
  if (!engine) return "other";
  const k = engine.toLowerCase().replace(/[^a-z]/g, "");
  if (k.includes("vllm")) return "vllm";
  if (k.includes("sglang")) return "sglang";
  if (k.includes("llama")) return "llamacpp";
  if (k.includes("ollama")) return "ollama";
  if (k.includes("openai") || k.includes("generic")) return "generic";
  return "other";
}

export function engineColor(
  engine: string | null | undefined,
  mode: "light" | "dark" = "light",
): string {
  const key = normalize(engine);
  return (mode === "dark" ? DARK_ENGINE : LIGHT_ENGINE)[key];
}

/** Always sky vs slate, regardless of engine — to avoid confusion when both
 *  models are the same engine, or when comparing across engines. */
export function compareColors(mode: "light" | "dark" = "light") {
  return mode === "dark"
    ? { a: "#38bdf8", b: "#cbd5e1" }
    : { a: "#0284c7", b: "#94a3b8" };
}

/**
 * Ordered, well-separated categorical palette for per-run series (one color
 * per benchmark run). 10 distinct hues so a chart with up to 10 runs never
 * repeats a color; consecutive entries are chosen to be visually far apart.
 */
export function seriesPalette(mode: "light" | "dark" = "light"): string[] {
  return mode === "dark"
    ? [
        "#38bdf8", // sky-400
        "#fb7185", // rose-400
        "#4ade80", // green-400
        "#fbbf24", // amber-400
        "#a78bfa", // violet-400
        "#22d3ee", // cyan-400
        "#f472b6", // pink-400
        "#a3e635", // lime-400
        "#e879f9", // fuchsia-400
        "#94a3b8", // slate-400
      ]
    : [
        "#0284c7", // sky-600
        "#e11d48", // rose-600
        "#16a34a", // green-600
        "#d97706", // amber-600
        "#7c3aed", // violet-600
        "#0891b2", // cyan-600
        "#db2777", // pink-600
        "#65a30d", // lime-600
        "#c026d3", // fuchsia-600
        "#475569", // slate-600
      ];
}
