/**
 * Vendor-agnostic GPU probe. Tries each backend in order and stops at the
 * first one that yields a non-empty result:
 *
 *   1. nvidia-smi (NVIDIA GPUs)
 *   2. rocm-smi   (AMD GPUs)
 *   3. macOS system_profiler (Apple Silicon, Intel Mac integrated/discrete)
 *
 * Every backend is independently try/catched. Missing binaries are not
 * errors — they're just "this isn't the vendor". Returns a normalized
 * `GpuProbe` shape that the rest of the snapshot code can consume.
 *
 * Raw text is also returned (concatenated when multiple backends ran) so
 * the trace can attach it as evidence in `nvidia-smi-before.txt` /
 * `nvidia-smi-after.txt` — even when the backend isn't nvidia, the file
 * preserves the original output. We keep the filename `nvidia-smi-*` for
 * backwards compatibility with the bundle classifier.
 */

import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";

import { parseNvidiaSmi } from "@/lib/import/nvidia-smi";

const execPromise = promisify(execCb);

export interface GpuProbe {
  /** "nvidia" | "amd" | "apple" | null when nothing matched. */
  vendor: "nvidia" | "amd" | "apple" | null;
  driverVersion: string | null;
  cudaVersion: string | null;
  rocmVersion: string | null;
  gpuModels: {
    name: string;
    vramGb: number | null;
    pcieGeneration: string | null;
    pcieWidth: string | null;
  }[];
  /** Concatenated raw output from whichever backends produced anything. */
  rawText: string | null;
}

export async function probeGpus(): Promise<GpuProbe> {
  const out: GpuProbe = {
    vendor: null,
    driverVersion: null,
    cudaVersion: null,
    rocmVersion: null,
    gpuModels: [],
    rawText: null,
  };
  const rawParts: string[] = [];

  // 1) NVIDIA
  const smi = await safe("nvidia-smi");
  if (smi) {
    const verbose = await safe("nvidia-smi -q");
    const combined = verbose ? `${smi}\n${verbose}` : smi;
    const parsed = parseNvidiaSmi(combined);
    if (parsed.gpuModels.length > 0) {
      out.vendor = "nvidia";
      out.driverVersion = parsed.driverVersion;
      out.cudaVersion = parsed.cudaVersion;
      out.gpuModels = parsed.gpuModels.map((g) => ({
        name: g.name,
        vramGb: g.vramGb ?? null,
        pcieGeneration: g.pcieGeneration ?? null,
        pcieWidth: g.pcieWidth ?? null,
      }));
      rawParts.push(combined);
    }
  }

  // 2) AMD (only try if NVIDIA gave us nothing — most boxes are one vendor)
  if (out.vendor == null) {
    const amdJson = await safe("rocm-smi --showproductname --showmeminfo vram --showdriverversion --json");
    if (amdJson) {
      const parsed = parseRocmSmi(amdJson);
      if (parsed.gpuModels.length > 0) {
        out.vendor = "amd";
        out.driverVersion = parsed.driverVersion;
        out.rocmVersion = parsed.rocmVersion;
        out.gpuModels = parsed.gpuModels;
        rawParts.push(amdJson);
      }
    }
  }

  // 3) macOS Apple Silicon (system_profiler is present on every Mac)
  if (out.vendor == null && process.platform === "darwin") {
    const sp = await safe("system_profiler SPDisplaysDataType -json");
    if (sp) {
      const parsed = parseSystemProfiler(sp);
      if (parsed.gpuModels.length > 0) {
        out.vendor = "apple";
        out.gpuModels = parsed.gpuModels;
        rawParts.push(sp);
      }
    }
  }

  if (rawParts.length > 0) out.rawText = rawParts.join("\n");
  return out;
}

interface ParsedAmd {
  driverVersion: string | null;
  rocmVersion: string | null;
  gpuModels: GpuProbe["gpuModels"];
}

/**
 * Parse `rocm-smi --json` output. The schema is keyed by `card N`:
 *   {
 *     "card0": {
 *       "Card series": "Radeon RX 7900 XTX",
 *       "GPU memory vendor": "...",
 *       "VRAM Total Memory (B)": "25753026560",
 *       "Driver version": "6.2.4"
 *     },
 *     ...
 *     "system": { "Driver version": "..." }
 *   }
 */
export function parseRocmSmi(jsonText: string): ParsedAmd {
  const out: ParsedAmd = {
    driverVersion: null,
    rocmVersion: null,
    gpuModels: [],
  };
  let data: Record<string, Record<string, string>>;
  try {
    data = JSON.parse(jsonText) as Record<string, Record<string, string>>;
  } catch {
    return out;
  }
  // System-wide driver version
  const sys = data["system"];
  if (sys && typeof sys === "object") {
    if (typeof sys["Driver version"] === "string") {
      out.driverVersion = sys["Driver version"];
    }
    if (typeof sys["ROCm version"] === "string") {
      out.rocmVersion = sys["ROCm version"];
    }
  }
  // Per-card entries
  for (const [k, v] of Object.entries(data)) {
    if (!/^card\d+$/.test(k)) continue;
    const name =
      v["Card series"] ?? v["Card model"] ?? v["GPU model"] ?? "AMD GPU";
    const vramBytes = parseInt(
      v["VRAM Total Memory (B)"] ?? v["GPU memory used (B)"] ?? "0",
      10,
    );
    out.gpuModels.push({
      name: String(name),
      vramGb:
        Number.isFinite(vramBytes) && vramBytes > 0
          ? Math.round((vramBytes / 1024 ** 3) * 10) / 10
          : null,
      pcieGeneration: null,
      pcieWidth: null,
    });
    // Fall back to per-card driver version if system block was missing it.
    if (!out.driverVersion && typeof v["Driver version"] === "string") {
      out.driverVersion = v["Driver version"];
    }
  }
  return out;
}

interface ParsedApple {
  gpuModels: GpuProbe["gpuModels"];
}

/**
 * Parse `system_profiler SPDisplaysDataType -json` output (macOS).
 *
 * Shape (abridged):
 *   {
 *     "SPDisplaysDataType": [
 *       {
 *         "sppci_model": "Apple M3 Max",
 *         "spdisplays_vram_shared": "32 GB"
 *       }
 *     ]
 *   }
 */
export function parseSystemProfiler(jsonText: string): ParsedApple {
  const out: ParsedApple = { gpuModels: [] };
  let data: { SPDisplaysDataType?: Array<Record<string, unknown>> };
  try {
    data = JSON.parse(jsonText) as typeof data;
  } catch {
    return out;
  }
  for (const entry of data.SPDisplaysDataType ?? []) {
    const name =
      (entry.sppci_model as string | undefined) ??
      (entry._name as string | undefined) ??
      "Apple GPU";
    // VRAM can be reported under several keys depending on whether it's a
    // discrete GPU (sppci_vram) or unified memory (spdisplays_vram_shared).
    const vramRaw =
      (entry.sppci_vram as string | undefined) ??
      (entry.spdisplays_vram as string | undefined) ??
      (entry.spdisplays_vram_shared as string | undefined) ??
      null;
    let vramGb: number | null = null;
    if (vramRaw) {
      const m = vramRaw.match(/([\d.]+)\s*(GB|MB)/i);
      if (m) {
        const v = parseFloat(m[1]!);
        vramGb = m[2]!.toUpperCase() === "MB" ? v / 1024 : v;
        vramGb = Math.round(vramGb * 10) / 10;
      }
    }
    out.gpuModels.push({
      name: String(name),
      vramGb,
      pcieGeneration: null,
      pcieWidth: null,
    });
  }
  return out;
}

async function safe(command: string): Promise<string | null> {
  try {
    const { stdout } = await execPromise(command, { timeout: 5000 });
    return stdout;
  } catch {
    return null;
  }
}
