/**
 * Sensitive-pattern redaction. Runs over commands, environment variables,
 * and free-form text before any export. Each rule has a stable label so the
 * UI can show "n items redacted: <breakdown>" without revealing the values.
 */

export interface RedactionRule {
  label: string;
  pattern: RegExp;
  replacement: string | ((match: string) => string);
}

export interface RedactionSummary {
  /** Items redacted, grouped by label. */
  counts: { label: string; count: number }[];
  /** Total number of redactions across all rules. */
  total: number;
}

export const DEFAULT_RULES: RedactionRule[] = [
  {
    label: "Hugging Face token",
    pattern: /\bhf_[A-Za-z0-9]{20,}/g,
    replacement: "<hf_token>",
  },
  {
    label: "OpenAI-style API key",
    pattern: /\bsk-[A-Za-z0-9_-]{20,}/g,
    replacement: "<api_key>",
  },
  {
    label: "Generic Bearer token",
    pattern: /\bBearer\s+[A-Za-z0-9._\-]{16,}/g,
    replacement: "Bearer <token>",
  },
  {
    pattern: /\/home\/[^/\s"']+/g,
    replacement: "~",
    label: "Home directory path (linux)",
  },
  {
    pattern: /\/Users\/[^/\s"']+/gi,
    replacement: "~",
    label: "Home directory path (macos)",
  },
  {
    // /root, /root/, /root/<anything> — covers docker-as-root containers.
    // KNOWN LIMITATION: URL paths that include /root as a segment
    // (e.g. http://example.com/root/api) also match and become garbled
    // (http://example.com~/api). BenchTrace's domain is model server
    // endpoints (/v1/...), so this is rare in practice. If false-positives
    // become an issue, constrain to filesystem contexts via (?<=^|[\s=])
    // lookbehind. See audit M6 follow-up.
    pattern: /\/root(?=$|\/|[\s"'])/g,
    replacement: "~",
    label: "Home directory path (root)",
  },
  {
    // /srv/<x>, /srv/<x>/... — Linux service paths that may contain
    // user-style subdirs in container deployments.
    pattern: /\/srv\/[^/\s"']+/g,
    replacement: "~",
    label: "Service directory path (srv)",
  },
  {
    // /opt/<x>, /opt/<x>/... — third-party install roots that often
    // include vendor/user names.
    pattern: /\/opt\/[^/\s"']+/g,
    replacement: "~",
    label: "Service directory path (opt)",
  },
  {
    pattern: /C:\\Users\\[^\\\s"']+/gi,
    replacement: "~",
    label: "Home directory path (windows)",
  },
  {
    label: "Environment secret",
    pattern: /\b([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|PASSWD)[A-Z0-9_]*)=(\S+)/g,
    replacement: (m: string) => {
      const [name] = m.split("=");
      return `${name}=<redacted>`;
    },
  },
  {
    label: "IP address",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: "<ip_address>",
  },
];

const PATH_RULE: RedactionRule = {
  label: "Local model path",
  pattern: /(~|<local_path>)\/(?:[^/\s"']+\/)+[^/\s"']+\.(?:gguf|safetensors|bin|pt|pth)/gi,
  replacement: "<local_model_path>",
};

export interface RedactOptions {
  /** Also redact absolute local model paths. */
  redactLocalPaths?: boolean;
  /** Append additional one-off rules. */
  extraRules?: RedactionRule[];
}

export function redactText(
  input: string | null | undefined,
  options: RedactOptions = {},
): { text: string; counts: Record<string, number> } {
  if (!input) return { text: "", counts: {} };
  let text = input;
  const counts: Record<string, number> = {};

  const rules = [
    ...DEFAULT_RULES,
    ...(options.redactLocalPaths ? [PATH_RULE] : []),
    ...(options.extraRules ?? []),
  ];

  for (const rule of rules) {
    let matchCount = 0;
    if (typeof rule.replacement === "function") {
      const fn = rule.replacement;
      text = text.replace(rule.pattern, (match) => {
        matchCount += 1;
        return fn(match);
      });
    } else {
      const replacement = rule.replacement;
      text = text.replace(rule.pattern, () => {
        matchCount += 1;
        return replacement;
      });
    }
    if (matchCount > 0) {
      counts[rule.label] = (counts[rule.label] ?? 0) + matchCount;
    }
  }

  return { text, counts };
}

/** Redact a key/value map. Returns the redacted values + per-rule counts. */
export function redactEnv(
  env: Record<string, string> | null | undefined,
  options: RedactOptions = {},
): { env: Record<string, string>; counts: Record<string, number> } {
  if (!env) return { env: {}, counts: {} };
  const out: Record<string, string> = {};
  const totalCounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(env)) {
    // Treat key=value as if it were a single string so the env-secret rule
    // picks up SECRETS=foo and renames foo→<redacted>.
    const combined = `${k}=${v}`;
    const { text, counts } = redactText(combined, options);
    const idx = text.indexOf("=");
    out[k] = idx >= 0 ? text.slice(idx + 1) : v;
    for (const [label, n] of Object.entries(counts)) {
      totalCounts[label] = (totalCounts[label] ?? 0) + n;
    }
  }
  return { env: out, counts: totalCounts };
}

export function summarize(counts: Record<string, number>): RedactionSummary {
  const entries = Object.entries(counts);
  const list = entries.map(([label, count]) => ({ label, count }));
  return {
    counts: list.sort((a, b) => b.count - a.count),
    total: list.reduce((a, b) => a + b.count, 0),
  };
}
