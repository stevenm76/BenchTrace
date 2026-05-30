/**
 * Probe an OpenAI-compatible server for the metadata we'd otherwise have to
 * guess. Used at the start of a sweep to populate model fields (context
 * length, model path) and engine version.
 *
 * Best-effort everywhere — never throws, never blocks the benchmark.
 */

export interface ProbeResult {
  /** vLLM-style `/version` endpoint string, or null. */
  engineVersion: string | null;
  /** `/v1/models` data[0].max_model_len if available. */
  claimedContextLength: number | null;
  /** `/v1/models` data[0].root — usually the on-disk HF cache path. */
  modelRepoOrPath: string | null;
  /** `/v1/models` data[0].owned_by — sometimes set by the loader. */
  modelProvider: string | null;
}

const EMPTY: ProbeResult = {
  engineVersion: null,
  claimedContextLength: null,
  modelRepoOrPath: null,
  modelProvider: null,
};

interface ModelsListEntry {
  id: string;
  max_model_len?: number;
  owned_by?: string;
  root?: string;
}

interface ModelsListResponse {
  data?: ModelsListEntry[];
}

export async function probeServer(
  baseUrl: string,
  modelName: string,
  apiKey: string | null,
): Promise<ProbeResult> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const fetchJson = async (path: string, timeoutMs = 4000): Promise<unknown> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
        headers,
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };

  const out: ProbeResult = { ...EMPTY };

  // /v1/models → context length + root + owned_by for the requested model
  const models = (await fetchJson("/v1/models")) as ModelsListResponse | null;
  if (models?.data) {
    const entry = models.data.find((m) => m.id === modelName) ?? models.data[0];
    if (entry) {
      if (typeof entry.max_model_len === "number") {
        out.claimedContextLength = entry.max_model_len;
      }
      if (typeof entry.root === "string") out.modelRepoOrPath = entry.root;
      if (typeof entry.owned_by === "string") {
        out.modelProvider = entry.owned_by;
      }
    }
  }

  // vLLM exposes /version (text or JSON depending on version). Try both
  // common shapes.
  const ver = (await fetchJson("/version", 2000)) as
    | { version?: string }
    | string
    | null;
  if (typeof ver === "string") {
    out.engineVersion = ver.trim() || null;
  } else if (ver && typeof ver.version === "string") {
    out.engineVersion = ver.version;
  }

  return out;
}
