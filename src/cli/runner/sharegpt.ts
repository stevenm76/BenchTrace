/**
 * ShareGPT prompt corpus support — opt-in, lazy download.
 *
 * Why: vLLM's bench_serve.py and most published serving benchmarks use
 * ShareGPT for prompts. Matching corpus gives apples-to-apples comparison;
 * synthetic prompts produce systematically different prefill costs.
 *
 * License posture: this code does NOT bundle ShareGPT. On first use, the
 * user is asked to acknowledge that the data is community-collected and
 * has no clean upstream license. After consent, the JSON is cached at
 * `~/.cache/benchtrace/sharegpt.json` (small for ~90k convs, ~600 MB).
 *
 * Disable interactive consent for CI/auto by setting
 * `BENCHTRACE_ACCEPT_SHAREGPT=1` (the same opt-in vLLM users typically set
 * in container automation).
 */

import { createWriteStream, promises as fs } from "node:fs";
import { createInterface } from "node:readline/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const DEFAULT_URL =
  "https://huggingface.co/datasets/anon8231489123/ShareGPT_Vicuna_unfiltered/resolve/main/ShareGPT_V3_unfiltered_cleaned_split.json";

export interface ShareGptOptions {
  /** Override the cache path. Defaults to ~/.cache/benchtrace/sharegpt.json. */
  cachePath?: string;
  /** Override the download URL (e.g. a local mirror). */
  url?: string;
  /** Skip the interactive prompt — caller has independently obtained consent. */
  acceptedExplicitly?: boolean;
  /** Stream a progress line to this fn while downloading. */
  onProgress?: (info: { downloadedBytes: number; totalBytes: number | null }) => void;
}

export function defaultCachePath(): string {
  const home = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  return path.join(home, "benchtrace", "sharegpt.json");
}

/**
 * Ensure the ShareGPT JSON exists locally. Returns the absolute path.
 * Prompts for consent on first download unless overridden by env or option.
 *
 * Throws when the user declines or the download fails — the caller surfaces
 * the message and falls back to synthetic prompts.
 */
export async function ensureShareGptCorpus(
  options: ShareGptOptions = {},
): Promise<string> {
  const targetPath = options.cachePath ?? defaultCachePath();
  // Already cached?
  try {
    const stat = await fs.stat(targetPath);
    if (stat.size > 1024 * 1024) return targetPath;
    // Tiny file — treat as corrupted, refetch.
  } catch {
    /* missing — proceed to download */
  }

  // Consent gate
  const envAccepted = process.env.BENCHTRACE_ACCEPT_SHAREGPT === "1";
  const accepted = options.acceptedExplicitly === true || envAccepted;
  if (!accepted) {
    await promptForConsent();
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const url = options.url ?? DEFAULT_URL;
  await downloadToPath(url, targetPath, options.onProgress);
  return targetPath;
}

/**
 * Load + sample N prompts from the cached corpus.
 *
 * Each ShareGPT entry has a "conversations" array of {from, value} turns.
 * We use the first human turn as the prompt — matching what vLLM's
 * bench_serve.py does in its default ShareGPT loader.
 *
 * Filters out entries with no human turn, or where the first human message
 * is < 4 tokens (roughly < 20 chars) since those don't exercise prefill.
 */
export async function sampleShareGptPrompts(
  corpusPath: string,
  count: number,
  rngSeed: number,
): Promise<string[]> {
  const raw = await fs.readFile(corpusPath, "utf8");
  const data = JSON.parse(raw) as Array<{
    conversations?: Array<{ from?: string; value?: string }>;
  }>;
  if (!Array.isArray(data)) {
    throw new Error("ShareGPT corpus is not a JSON array");
  }
  const prompts: string[] = [];
  for (const entry of data) {
    if (!entry?.conversations) continue;
    const firstHuman = entry.conversations.find(
      (t) => t.from === "human" && typeof t.value === "string",
    );
    if (firstHuman?.value && firstHuman.value.length >= 20) {
      prompts.push(firstHuman.value);
    }
  }
  if (prompts.length === 0) {
    throw new Error("ShareGPT corpus produced 0 usable prompts");
  }

  // Deterministic shuffle from rngSeed (mulberry32) — same seed = same
  // sample order, just like the synthetic path.
  const shuffled = mulberryShuffle(prompts, rngSeed);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function mulberryShuffle<T>(arr: T[], seed: number): T[] {
  let a = (seed >>> 0) || 1;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // In-place Fisher–Yates, but on a copy so the caller's array is untouched.
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy;
}

async function promptForConsent(): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error(
      [
        "ShareGPT requires consent. Re-run interactively, or set",
        "BENCHTRACE_ACCEPT_SHAREGPT=1 in your environment.",
      ].join("\n"),
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = (
    await rl.question(
      [
        "",
        "ShareGPT corpus consent",
        "─────────────────────────",
        "ShareGPT is a community-collected set of user/ChatGPT conversations from",
        "the (now-defunct) sharegpt.com browser extension. The HuggingFace copy",
        "BenchTrace will download has no explicit upstream license, and the",
        "conversations were never explicitly licensed by their authors.",
        "",
        "vLLM, SGLang, and most published serving benchmarks use it as the de",
        "facto prompt corpus. BenchTrace will use it only for benchmark prompts,",
        "not training. It will be cached under ~/.cache/benchtrace/ and used for",
        "future runs.",
        "",
        "Proceed with download? [y/N] ",
      ].join("\n"),
    )
  )
    .trim()
    .toLowerCase();
  rl.close();
  if (answer !== "y" && answer !== "yes") {
    throw new Error("ShareGPT consent declined. Falling back to synthetic prompts.");
  }
}

async function downloadToPath(
  url: string,
  targetPath: string,
  onProgress?: ShareGptOptions["onProgress"],
): Promise<void> {
  const tmp = targetPath + ".part";
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ShareGPT: HTTP ${res.status}`);
  }
  const total = Number(res.headers.get("content-length")) || null;
  const sink = createWriteStream(tmp);
  let received = 0;
  const reader = (res.body as unknown as ReadableStream<Uint8Array>).getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        sink.write(value);
        received += value.byteLength;
        onProgress?.({ downloadedBytes: received, totalBytes: total });
      }
    }
  } finally {
    sink.end();
    reader.releaseLock();
  }
  await new Promise<void>((resolve, reject) => {
    sink.on("finish", () => resolve());
    sink.on("error", reject);
  });
  await fs.rename(tmp, targetPath);
}

// Bring Readable into scope for older node defs — we use the web stream API,
// but ts-lib for node 18 sometimes resolves the type oddly.
export const _readableMarker = Readable;
