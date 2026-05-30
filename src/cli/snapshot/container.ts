/**
 * Detect a docker container serving the model on the target port, then pull
 * its image, launch command, and environment so the trace records WHAT the
 * server was actually configured with — instead of leaving 14 loader-config
 * fields blank waiting for the user to remember to pass --launch-command-file.
 *
 * Strategy:
 *   1. Parse the base-url to get host:port.
 *   2. `docker ps` listing containers + their port bindings.
 *   3. For each container, see if any host port mapping matches the target.
 *   4. `docker inspect` the match, normalize Cmd into a single command line,
 *      parse out the vLLM/sglang/llama.cpp flags we recognize.
 *
 * Everything is best-effort. Returns null when no container matches, when
 * docker isn't on PATH, or when the user is running a non-docker server. The
 * caller logs an info line and proceeds.
 */

import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";

const execPromise = promisify(execCb);

export interface ContainerProbe {
  containerName: string;
  containerId: string;
  image: string;
  cmd: string[];
  /** Reconstructed shell-style command line, useful as launch_command. */
  launchCommand: string;
  /** Container env vars (Config.Env), parsed into key/value. */
  environment: Record<string, string>;
  /** Parsed vLLM/sglang-style loader settings (best-effort). */
  loader: ParsedLoaderArgs;
}

export interface ParsedLoaderArgs {
  tensorParallelSize: number | null;
  pipelineParallelSize: number | null;
  dataParallelSize: number | null;
  kvCacheDtype: string | null;
  maxModelLen: number | null;
  gpuMemoryUtilization: number | null;
  speculativeDecoding: boolean | null;
  draftModel: string | null;
  mtpEnabled: boolean | null;
  chunkedPrefill: boolean | null;
  prefixCaching: boolean | null;
  cpuOffload: boolean | null;
  /** Any flag we didn't model explicitly, kept verbatim for visibility. */
  extraArgs: string[];
}

export async function probeContainer(
  baseUrl: string,
): Promise<ContainerProbe | null> {
  const targetPort = parsePort(baseUrl);
  if (targetPort == null) return null;

  // List containers in JSON form to avoid screen-scraping table output.
  const psOut = await safe(
    `docker ps --no-trunc --format '{{json .}}'`,
  );
  if (!psOut) return null;

  type DockerPsRow = {
    ID: string;
    Names: string;
    Image: string;
    Ports: string;
  };

  const rows: DockerPsRow[] = psOut
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as DockerPsRow;
      } catch {
        return null;
      }
    })
    .filter((r): r is DockerPsRow => r != null);

  // Find a container with a host-port mapping that matches our target.
  // "Ports" looks like one of:
  //   "0.0.0.0:8001->8000/tcp, :::8001->8000/tcp"     (Linux)
  //   "0.0.0.0:8001->8000/tcp, [::]:8001->8000/tcp"   (Windows)
  //   "127.0.0.1:8001->8000/tcp"                       (loopback bind)
  // Strip everything before each "->" arrow, grab the host port that came
  // just before, and compare numerically. Robust to bracketed IPv6.
  const match = rows.find((r) => {
    for (const segment of r.Ports.split(/,\s*/)) {
      // Take the chunk to the left of "->". The last numeric run in that
      // chunk is the host port — works regardless of IPv4/IPv6 prefix.
      const arrow = segment.indexOf("->");
      if (arrow < 0) continue;
      const host = segment.slice(0, arrow);
      const portMatches = host.match(/(\d+)/g);
      if (!portMatches) continue;
      const lastPort = parseInt(portMatches[portMatches.length - 1]!, 10);
      if (lastPort === targetPort) return true;
    }
    return false;
  });
  if (!match) return null;

  // Inspect the match for Cmd + Env + Image. Use the container id to be
  // resilient to names containing characters that confuse the shell.
  const inspectOut = await safe(`docker inspect ${match.ID}`);
  if (!inspectOut) return null;
  let inspect: unknown;
  try {
    inspect = JSON.parse(inspectOut);
  } catch {
    return null;
  }
  const first = Array.isArray(inspect) ? inspect[0] : inspect;
  if (!first || typeof first !== "object") return null;

  const info = first as {
    Name?: string;
    Config?: {
      Cmd?: string[] | null;
      Entrypoint?: string[] | null;
      Env?: string[] | null;
      Image?: string;
    };
  };

  const cmd = [...(info.Config?.Entrypoint ?? []), ...(info.Config?.Cmd ?? [])];
  const launchCommand = cmd.length > 0 ? quoteCommand(cmd) : "";
  const environment: Record<string, string> = {};
  for (const e of info.Config?.Env ?? []) {
    const eq = e.indexOf("=");
    if (eq > 0) environment[e.slice(0, eq)] = e.slice(eq + 1);
  }
  const loader = parseLoaderArgs(cmd);

  return {
    containerName: (info.Name ?? match.Names).replace(/^\//, ""),
    containerId: match.ID,
    image: info.Config?.Image ?? match.Image,
    cmd,
    launchCommand,
    environment,
    loader,
  };
}

/**
 * Read a file from inside a running container — used as a fallback for
 * model-config when the path the server reports doesn't exist on the host
 * (the common case when the user runs vLLM in docker and BenchTrace on the
 * host without sharing the HF cache mount).
 *
 * Returns null on any failure (no docker, container gone, file missing,
 * timeout). Never throws.
 */
export async function readFileViaContainer(
  containerId: string,
  pathInside: string,
): Promise<string | null> {
  // `docker exec` with cat — works for any text file, no need to install
  // anything inside the container. Hard ceiling at 32 MB so a runaway path
  // can't drain memory.
  const result = await safe(
    `docker exec ${containerId} cat ${shellEscape(pathInside)}`,
  );
  return result;
}

function shellEscape(p: string): string {
  // Single-quote the path so spaces or shell metacharacters in the model
  // path don't blow up the exec. Single quotes inside the path are escaped
  // by closing-and-reopening (POSIX sh idiom).
  return `'${p.replace(/'/g, "'\\''")}'`;
}

/**
 * Parse vLLM-style argv into structured loader fields. Recognizes the most
 * common knobs; anything else is preserved verbatim in extraArgs for
 * downstream display.
 */
export function parseLoaderArgs(argv: string[]): ParsedLoaderArgs {
  const out: ParsedLoaderArgs = {
    tensorParallelSize: null,
    pipelineParallelSize: null,
    dataParallelSize: null,
    kvCacheDtype: null,
    maxModelLen: null,
    gpuMemoryUtilization: null,
    speculativeDecoding: null,
    draftModel: null,
    mtpEnabled: null,
    chunkedPrefill: null,
    prefixCaching: null,
    cpuOffload: null,
    extraArgs: [],
  };

  // Walk argv, pairing flag with value when needed.
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    // Handle `--flag=value` shape uniformly.
    const eq = a.indexOf("=");
    const flag = eq > 0 ? a.slice(0, eq) : a;
    const inlineVal = eq > 0 ? a.slice(eq + 1) : null;
    const next = (): string | null => {
      if (inlineVal != null) return inlineVal;
      const v = argv[i + 1];
      if (v == null || v.startsWith("--")) return null;
      i++;
      return v;
    };

    switch (flag) {
      case "--tensor-parallel-size":
      case "-tp":
        out.tensorParallelSize = toInt(next());
        break;
      case "--pipeline-parallel-size":
      case "-pp":
        out.pipelineParallelSize = toInt(next());
        break;
      case "--data-parallel-size":
      case "-dp":
        out.dataParallelSize = toInt(next());
        break;
      case "--kv-cache-dtype":
        out.kvCacheDtype = next();
        break;
      case "--max-model-len":
        out.maxModelLen = toInt(next());
        break;
      case "--gpu-memory-utilization":
        out.gpuMemoryUtilization = toFloat(next());
        break;
      case "--speculative-config":
      case "--speculative-model":
      case "--num-speculative-tokens": {
        out.speculativeDecoding = true;
        const v = next();
        // vLLM's --speculative-config is JSON. Try to pull a draft model.
        if (v) {
          if (v.startsWith("{")) {
            try {
              const obj = JSON.parse(v) as Record<string, unknown>;
              if (typeof obj.model === "string") out.draftModel = obj.model;
              if (obj.method === "mtp" || obj.method === "MTP") out.mtpEnabled = true;
            } catch {
              /* leave nulls */
            }
          } else if (flag === "--speculative-model") {
            out.draftModel = v;
          }
        }
        break;
      }
      case "--mtp":
      case "--enable-mtp":
      case "--multi-token-prediction":
        out.mtpEnabled = true;
        // No value to consume — boolean flag.
        break;
      case "--enable-chunked-prefill":
        out.chunkedPrefill = true;
        break;
      case "--no-enable-chunked-prefill":
        out.chunkedPrefill = false;
        break;
      case "--enable-prefix-caching":
        out.prefixCaching = true;
        break;
      case "--no-enable-prefix-caching":
        out.prefixCaching = false;
        break;
      case "--cpu-offload-gb":
        out.cpuOffload = toFloat(next()) != null;
        break;
      default:
        // Keep the original flag (and its value if we ate one).
        if (flag.startsWith("--")) {
          out.extraArgs.push(a);
        }
        break;
    }
  }

  return out;
}

function quoteCommand(parts: string[]): string {
  return parts
    .map((p) => (/\s|["'`$]/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p))
    .join(" ");
}

function parsePort(baseUrl: string): number | null {
  try {
    const u = new URL(baseUrl);
    if (u.port) return parseInt(u.port, 10);
    if (u.protocol === "https:") return 443;
    if (u.protocol === "http:") return 80;
    return null;
  } catch {
    return null;
  }
}

function toInt(v: string | null): number | null {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function toFloat(v: string | null): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

async function safe(command: string): Promise<string | null> {
  try {
    const { stdout } = await execPromise(command, { timeout: 5000 });
    return stdout;
  } catch {
    return null;
  }
}
