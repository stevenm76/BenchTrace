/**
 * Best-effort parser for `nvidia-smi` plain-text output. Picks out
 *   - driver version
 *   - CUDA version
 *   - GPU models + per-GPU VRAM (MiB → GB)
 *   - per-GPU PCIe generation + width (when the verbose `nvidia-smi -q`
 *     output is appended to the standard table dump)
 *
 * Tolerates the header line + the per-GPU table format from recent driver
 * releases. Returns null fields rather than throwing on malformed input.
 */

import type { GpuInfo } from "@/lib/db/schema";

export interface NvidiaSmiParsed {
  driverVersion: string | null;
  cudaVersion: string | null;
  gpuCount: number;
  gpuModels: GpuInfo[];
  gpuVramGb: number | null;
}

export function parseNvidiaSmi(text: string): NvidiaSmiParsed {
  const out: NvidiaSmiParsed = {
    driverVersion: null,
    cudaVersion: null,
    gpuCount: 0,
    gpuModels: [],
    gpuVramGb: null,
  };

  // Driver: "NVIDIA-SMI 565.77    Driver Version: 565.77    CUDA Version: 13.0"
  const driverMatch = text.match(/Driver Version:\s*([0-9.]+)/);
  if (driverMatch) out.driverVersion = driverMatch[1]!;
  const cudaMatch = text.match(/CUDA Version:\s*([0-9.]+)/);
  if (cudaMatch) out.cudaVersion = cudaMatch[1]!;

  // Per-GPU rows look like:
  //   |   0  NVIDIA GeForce RTX 5060 Ti     Off | 00000000:01:00.0 Off |                  N/A |
  //   |  0%   45C    P0   20W / 165W       |   3MiB /  16380MiB | 0%      Default |
  // The model + VRAM cap appear on two consecutive table rows. Match by line.
  const lines = text.split(/\r?\n/);
  let lastModel: string | null = null;
  for (const line of lines) {
    // Row that contains the GPU index and the model name.
    const modelMatch = line.match(
      /\|\s*\d+\s+(NVIDIA[A-Za-z0-9 \-_.]+?|AMD[A-Za-z0-9 \-_.]+?)\s{2,}(?:On|Off|N\/A)/,
    );
    if (modelMatch) {
      lastModel = modelMatch[1]!.trim();
      continue;
    }
    // Row that contains the memory usage column: "  3MiB /  16380MiB"
    const memMatch = line.match(/\|\s*\d+MiB\s*\/\s*(\d+)MiB/);
    if (memMatch && lastModel) {
      const totalMiB = parseInt(memMatch[1]!, 10);
      out.gpuModels.push({
        name: lastModel,
        vramGb: Math.round((totalMiB / 1024) * 10) / 10,
        pcieGeneration: null,
        pcieWidth: null,
      });
      lastModel = null;
    }
  }

  out.gpuCount = out.gpuModels.length;
  if (out.gpuModels.length > 0) {
    out.gpuVramGb = out.gpuModels.reduce(
      (acc, g) => acc + (g.vramGb ?? 0),
      0,
    );
  }

  // If the input includes the verbose `nvidia-smi -q` block (the CLI snapshot
  // script appends it to the plain table), scrape PCIe generation + link
  // width per GPU. Order in -q output matches order in the table.
  enrichWithPcie(text, out);
  return out;
}

/**
 * Walk verbose `nvidia-smi -q` blocks (one per GPU, started by a line
 * matching `GPU 00000000:bus:dev.f`) and pull the PCIe gen + link width
 * into the corresponding GpuInfo.
 */
function enrichWithPcie(text: string, out: NvidiaSmiParsed): void {
  const headerPattern = /GPU\s+[0-9A-F]{8}:[0-9A-F]{2}:[0-9A-F]{2}\.\d/g;
  const blockStarts: number[] = [];
  let match = headerPattern.exec(text);
  while (match != null) {
    blockStarts.push(match.index);
    match = headerPattern.exec(text);
  }
  if (blockStarts.length !== out.gpuModels.length) return;
  for (let i = 0; i < blockStarts.length; i++) {
    const start = blockStarts[i]!;
    const end = i + 1 < blockStarts.length ? blockStarts[i + 1]! : text.length;
    const block = text.slice(start, end);

    const gen = pickValue(block, "PCIe Generation", ["Current", "Max"]);
    if (gen) out.gpuModels[i]!.pcieGeneration = `Gen ${gen}`;

    const width = pickValue(block, "Link Width", ["Current", "Max"]);
    if (width) {
      // Width values usually look like "8x" — normalize to "x8" so the
      // dashboard renders "PCIe Gen 5 · x8".
      const normalized = /^\d+x$/.test(width)
        ? "x" + width.slice(0, -1)
        : width;
      out.gpuModels[i]!.pcieWidth = normalized;
    }
  }
}

/**
 * Within an `nvidia-smi -q` GPU block, find a sub-section by header name and
 * pick the first sub-key from `preference` order. Returns the trimmed value
 * or null.
 *
 *   PCIe Generation
 *       Max                       : 5
 *       Current                   : 5
 */
function pickValue(
  block: string,
  header: string,
  preference: string[],
): string | null {
  const headerIdx = block.indexOf(header);
  if (headerIdx < 0) return null;
  // Look at the next ~10 lines after the header for the preferred sub-keys.
  const slice = block.slice(headerIdx, headerIdx + 600);
  for (const key of preference) {
    const re = new RegExp(`${key}\\s*:\\s*([^\\n]+)`);
    const m = slice.match(re);
    if (m) return m[1]!.trim();
  }
  return null;
}
