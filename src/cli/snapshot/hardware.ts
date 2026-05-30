import { exec as execCb } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import { promisify } from "node:util";

import { probeGpus } from "./gpu-probe";

const execPromise = promisify(execCb);

export interface HardwareSnapshot {
  os: string | null;
  kernel: string | null;
  cpu: string | null;
  ramGb: number | null;
  gpuModels: {
    name: string;
    vramGb: number | null;
    pcieGeneration: string | null;
    pcieWidth: string | null;
  }[];
  /** Lowest PCIe generation across GPUs (`"Gen 5"` etc.) — the limiting slot
   *  matters more than the best. Null if no GPU reports it. */
  gpuPcieGeneration: string | null;
  /** Narrowest PCIe link width across GPUs (`"x8"`). */
  gpuPcieWidth: string | null;
  /** Detected GPU vendor ("nvidia" | "amd" | "apple") — null when no GPU
   *  probe succeeded. Drives which secondary fields make sense. */
  gpuVendor: "nvidia" | "amd" | "apple" | null;
  driverVersion: string | null;
  cudaVersion: string | null;
  rocmVersion: string | null;
  containerRuntime: string | null;
  motherboard: string | null;
  chipset: string | null;
  storage: string | null;
}

/**
 * Best-effort hardware capture. Every field is independently try/catched and
 * left null on failure. Never throws.
 */
export async function captureHardware(): Promise<HardwareSnapshot> {
  const snap: HardwareSnapshot = {
    os: null,
    kernel: os.release() || null,
    cpu: null,
    ramGb: null,
    gpuModels: [],
    gpuPcieGeneration: null,
    gpuPcieWidth: null,
    gpuVendor: null,
    driverVersion: null,
    cudaVersion: null,
    rocmVersion: null,
    containerRuntime: null,
    motherboard: null,
    chipset: null,
    storage: null,
  };

  // OS
  try {
    if (process.platform === "linux") {
      const release = await fs.readFile("/etc/os-release", "utf8");
      const m = release.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
      snap.os = m?.[1] ?? "linux";
    } else if (process.platform === "darwin") {
      const productName = (await safeExec("sw_vers -productName"))?.trim() ?? "macOS";
      const productVersion = (await safeExec("sw_vers -productVersion"))?.trim() ?? "";
      snap.os = `${productName} ${productVersion}`.trim();
    } else if (process.platform === "win32") {
      // PowerShell is universally available on Windows 10+; fall back to a
      // bare "windows" if it isn't.
      const ps = await safeExec(
        'powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).Caption"',
      );
      snap.os = ps?.trim() || "windows";
    } else {
      snap.os = process.platform;
    }
  } catch {
    /* ignore — snap.os stays null */
  }

  // CPU
  try {
    if (process.platform === "linux") {
      const info = await fs.readFile("/proc/cpuinfo", "utf8");
      const m = info.match(/^model name\s*:\s*(.+)$/m);
      snap.cpu = m?.[1]?.trim() ?? null;
    } else if (process.platform === "darwin") {
      snap.cpu =
        (await safeExec("sysctl -n machdep.cpu.brand_string"))?.trim() ?? null;
    } else if (process.platform === "win32") {
      const cpu = await safeExec(
        'powershell -NoProfile -Command "(Get-CimInstance Win32_Processor).Name"',
      );
      snap.cpu = cpu?.trim() || os.cpus()[0]?.model || null;
    } else {
      const cpus = os.cpus();
      snap.cpu = cpus[0]?.model ?? null;
    }
  } catch {
    /* ignore */
  }

  // RAM
  try {
    if (process.platform === "linux") {
      const mem = await fs.readFile("/proc/meminfo", "utf8");
      const m = mem.match(/^MemTotal:\s+(\d+)\s+kB/m);
      if (m) snap.ramGb = Math.round((parseInt(m[1]!, 10) / (1024 * 1024)) * 10) / 10;
    } else if (process.platform === "darwin") {
      const bytes = parseInt(
        (await safeExec("sysctl -n hw.memsize"))?.trim() ?? "0",
        10,
      );
      if (bytes > 0)
        snap.ramGb = Math.round((bytes / (1024 ** 3)) * 10) / 10;
    } else {
      const bytes = os.totalmem();
      snap.ramGb = Math.round((bytes / (1024 ** 3)) * 10) / 10;
    }
  } catch {
    /* ignore */
  }

  // Motherboard + chipset
  if (process.platform === "linux") {
    try {
      const boardVendor = (await safeRead("/sys/devices/virtual/dmi/id/board_vendor"))?.trim();
      const boardName = (await safeRead("/sys/devices/virtual/dmi/id/board_name"))?.trim();
      if (boardVendor || boardName) {
        snap.motherboard = [boardVendor, boardName].filter(Boolean).join(" ") || null;
      }
      const productName = (await safeRead("/sys/devices/virtual/dmi/id/product_name"))?.trim();
      if (productName && productName !== "System Product Name") {
        snap.chipset = boardVendor ? `${boardVendor} · ${productName}` : productName;
      }
    } catch {
      /* ignore */
    }
  } else if (process.platform === "darwin") {
    // Apple Silicon / Intel Mac — "motherboard" is really the model identifier.
    try {
      const model = (await safeExec("sysctl -n hw.model"))?.trim();
      if (model) snap.motherboard = `Apple · ${model}`;
    } catch {
      /* ignore */
    }
  } else if (process.platform === "win32") {
    try {
      const board = await safeExec(
        'powershell -NoProfile -Command "(Get-CimInstance Win32_BaseBoard) | ForEach-Object { $_.Manufacturer + \\" \\" + $_.Product }"',
      );
      if (board) snap.motherboard = board.trim();
    } catch {
      /* ignore */
    }
  }

  // Storage (Linux only — df is everywhere on Mac too but the output column
  // names differ between BSD and GNU; restrict to Linux to keep this clean).
  if (process.platform === "linux") {
    try {
      const dfOut = await safeExec("df -h --output=source,size,used,fstype /");
      if (dfOut) {
        const lines = dfOut.trim().split(/\n/);
        if (lines.length >= 2) {
          const parts = lines[1]!.trim().split(/\s+/);
          if (parts.length >= 4) {
            snap.storage = `${parts[0]} · ${parts[1]} (${parts[2]} used) · ${parts[3]}`;
          }
        }
      }
    } catch {
      /* ignore */
    }
  } else if (process.platform === "darwin") {
    try {
      const dfOut = await safeExec("df -h /");
      const lines = dfOut?.trim().split(/\n/) ?? [];
      if (lines.length >= 2) {
        const parts = lines[1]!.trim().split(/\s+/);
        if (parts.length >= 5) {
          snap.storage = `${parts[0]} · ${parts[1]} (${parts[2]} used) · APFS`;
        }
      }
    } catch {
      /* ignore */
    }
  }

  // GPUs — vendor-agnostic probe. Tries NVIDIA → AMD → Apple in order. All
  // failures are silent; we just end up with an empty gpuModels[] list.
  try {
    const probe = await probeGpus();
    snap.gpuVendor = probe.vendor;
    snap.driverVersion = probe.driverVersion;
    snap.cudaVersion = probe.cudaVersion;
    snap.rocmVersion = probe.rocmVersion;
    snap.gpuModels = probe.gpuModels;

    // Aggregate PCIe gen/width = the most-limiting slot. Listing the BEST
    // slot would lie about the throughput floor (some boards mix x16 + x8).
    // Apple/AMD probes don't currently expose PCIe info, so these will
    // stay null on those vendors until we add it.
    const gens = probe.gpuModels
      .map((g) => g.pcieGeneration)
      .filter((s): s is string => !!s)
      .map((s) => {
        const m = s.match(/Gen\s*(\d+)/i);
        return m ? { label: s, num: parseInt(m[1]!, 10) } : null;
      })
      .filter((x): x is { label: string; num: number } => !!x);
    if (gens.length > 0) {
      snap.gpuPcieGeneration = gens.reduce((a, b) =>
        a.num < b.num ? a : b,
      ).label;
    }

    const widths = probe.gpuModels
      .map((g) => g.pcieWidth)
      .filter((s): s is string => !!s)
      .map((s) => {
        const m = s.match(/x?(\d+)x?/i);
        return m ? { label: s, num: parseInt(m[1]!, 10) } : null;
      })
      .filter((x): x is { label: string; num: number } => !!x);
    if (widths.length > 0) {
      snap.gpuPcieWidth = widths.reduce((a, b) =>
        a.num < b.num ? a : b,
      ).label;
    }
  } catch {
    /* ignore — GPU section stays empty */
  }

  // Container runtime
  try {
    await fs.access("/.dockerenv");
    snap.containerRuntime = "docker";
  } catch {
    /* not in docker */
  }

  return snap;
}

async function safeExec(command: string): Promise<string | null> {
  try {
    const { stdout } = await execPromise(command, { timeout: 5000 });
    return stdout;
  } catch {
    return null;
  }
}

async function safeRead(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, "utf8");
  } catch {
    return null;
  }
}
