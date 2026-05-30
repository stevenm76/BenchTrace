/**
 * Background GPU telemetry sampler. Polls `nvidia-smi --query-gpu=…` at a
 * fixed interval and yields per-sweep-level aggregates (avg, peak) for:
 *   utilization.gpu  →  gpu_utilization_avg / peak  (%)
 *   memory.used       →  peak_vram_gb  (sum across GPUs, GB)
 *   power.draw        →  power_draw_watts_avg / peak  (W)
 *   temperature.gpu   →  gpu_temperature_avg / peak  (°C)
 *
 * Best-effort: if nvidia-smi is missing or fails, all fields stay null and
 * the benchmark is unaffected.
 */

import { spawn, type ChildProcess } from "node:child_process";

interface RawSample {
  /** Wall-clock ms since process start. */
  t: number;
  /** Per-GPU values, in the order nvidia-smi reported them. */
  gpus: {
    utilizationPct: number | null;
    memoryUsedGb: number | null;
    powerW: number | null;
    temperatureC: number | null;
  }[];
}

export interface TelemetryAggregate {
  gpuUtilizationAvg: number | null;
  gpuUtilizationPeak: number | null;
  peakVramGb: number | null;
  averageVramGb: number | null;
  powerDrawWattsAvg: number | null;
  powerDrawWattsPeak: number | null;
  gpuTemperatureAvg: number | null;
  gpuTemperaturePeak: number | null;
  sampleCount: number;
}

const QUERY_FIELDS =
  "index,utilization.gpu,memory.used,power.draw,temperature.gpu";

export class TelemetrySampler {
  private samples: RawSample[] = [];
  private proc: ChildProcess | null = null;
  private buf = "";
  private startMs = 0;
  private ok = false;

  /** Start nvidia-smi --query-gpu in CSV streaming mode. */
  start(intervalMs = 1000): void {
    this.samples = [];
    this.startMs = performance.now();
    try {
      this.proc = spawn(
        "nvidia-smi",
        [
          `--query-gpu=${QUERY_FIELDS}`,
          "--format=csv,noheader,nounits",
          "-lms",
          String(intervalMs),
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch {
      this.proc = null;
      return;
    }
    this.ok = true;
    if (this.proc.stdout) {
      this.proc.stdout.setEncoding("utf8");
      this.proc.stdout.on("data", (chunk: string) => {
        this.buf += chunk;
        let nl: number;
        while ((nl = this.buf.indexOf("\n")) !== -1) {
          const line = this.buf.slice(0, nl).trim();
          this.buf = this.buf.slice(nl + 1);
          if (line.length > 0) this.absorbLine(line);
        }
      });
    }
    this.proc.on("error", () => {
      this.ok = false;
    });
  }

  /** Forget samples collected so far — used between sweep levels. */
  reset(): void {
    this.samples = [];
  }

  /** Aggregate the samples collected since the last reset(). */
  snapshot(): TelemetryAggregate {
    const out: TelemetryAggregate = {
      gpuUtilizationAvg: null,
      gpuUtilizationPeak: null,
      peakVramGb: null,
      averageVramGb: null,
      powerDrawWattsAvg: null,
      powerDrawWattsPeak: null,
      gpuTemperatureAvg: null,
      gpuTemperaturePeak: null,
      sampleCount: this.samples.length,
    };
    if (this.samples.length === 0) return out;

    // Per-sample we sum across GPUs (for VRAM + power; you care about
    // the host total) but average across GPUs for utilization + temperature.
    const utilSeries: number[] = [];
    const tempSeries: number[] = [];
    const vramSeries: number[] = [];
    const powerSeries: number[] = [];

    for (const s of this.samples) {
      const utils = s.gpus.map((g) => g.utilizationPct).filter((v): v is number => v != null);
      if (utils.length > 0) utilSeries.push(utils.reduce((a, b) => a + b, 0) / utils.length);

      const temps = s.gpus.map((g) => g.temperatureC).filter((v): v is number => v != null);
      if (temps.length > 0) tempSeries.push(temps.reduce((a, b) => a + b, 0) / temps.length);

      const vrams = s.gpus.map((g) => g.memoryUsedGb).filter((v): v is number => v != null);
      if (vrams.length > 0) vramSeries.push(vrams.reduce((a, b) => a + b, 0));

      const pows = s.gpus.map((g) => g.powerW).filter((v): v is number => v != null);
      if (pows.length > 0) powerSeries.push(pows.reduce((a, b) => a + b, 0));
    }

    if (utilSeries.length) {
      out.gpuUtilizationAvg = utilSeries.reduce((a, b) => a + b, 0) / utilSeries.length;
      out.gpuUtilizationPeak = Math.max(...utilSeries);
    }
    if (tempSeries.length) {
      out.gpuTemperatureAvg = tempSeries.reduce((a, b) => a + b, 0) / tempSeries.length;
      out.gpuTemperaturePeak = Math.max(...tempSeries);
    }
    if (vramSeries.length) {
      out.peakVramGb = Math.max(...vramSeries);
      out.averageVramGb = vramSeries.reduce((a, b) => a + b, 0) / vramSeries.length;
    }
    if (powerSeries.length) {
      out.powerDrawWattsAvg = powerSeries.reduce((a, b) => a + b, 0) / powerSeries.length;
      out.powerDrawWattsPeak = Math.max(...powerSeries);
    }
    return out;
  }

  /** Stop the underlying nvidia-smi process. Safe to call multiple times. */
  stop(): void {
    if (this.proc) {
      try {
        this.proc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      this.proc = null;
    }
  }

  isOk(): boolean {
    return this.ok;
  }

  private absorbLine(line: string): void {
    // CSV line: "0, 87, 28432, 254.3, 71"
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 5) return;
    const [, util, memMib, powW, temp] = parts;
    const t = performance.now() - this.startMs;
    const sample: RawSample = { t, gpus: [] };
    // Single line is one GPU; nvidia-smi --query-gpu prints one line per GPU.
    sample.gpus.push({
      utilizationPct: parseNum(util),
      memoryUsedGb: parseNum(memMib) != null ? parseNum(memMib)! / 1024 : null,
      powerW: parseNum(powW),
      temperatureC: parseNum(temp),
    });

    // Group consecutive GPU lines that share the same wall-clock window into
    // one sample. nvidia-smi -lms 1000 emits all GPUs back-to-back per tick.
    const last = this.samples[this.samples.length - 1];
    if (last && t - last.t < 200) {
      last.gpus.push(...sample.gpus);
    } else {
      this.samples.push(sample);
    }
  }
}

function parseNum(s: string | undefined): number | null {
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Helper: derive tokens_per_watt given an output_tps + avg power. */
export function tokensPerWatt(
  outputTokensPerSecond: number | null,
  powerDrawWattsAvg: number | null,
): number | null {
  if (
    outputTokensPerSecond == null ||
    powerDrawWattsAvg == null ||
    powerDrawWattsAvg <= 0
  ) {
    return null;
  }
  return outputTokensPerSecond / powerDrawWattsAvg;
}
