"use client";

import { forwardRef } from "react";

import type { ShareCardData } from "@/lib/share/card-data";
import type { VerificationLevel } from "@/lib/db/schema";

interface ShareCardProps {
  data: ShareCardData;
}

const VERIFICATION_STYLE: Record<
  VerificationLevel,
  { color: string; label: string }
> = {
  strong: { color: "#34d399", label: "STRONG" },
  medium: { color: "#60a5fa", label: "MEDIUM" },
  weak: { color: "#94a3b8", label: "WEAK" },
  suspicious: { color: "#f87171", label: "SUSPICIOUS" },
};

/**
 * Polished visual summary suitable for posting on Reddit / Discord / Slack /
 * GitHub. Inline styles only so html-to-image can serialize without depending
 * on the page's stylesheet.
 */
export const ShareCard = forwardRef<HTMLDivElement, ShareCardProps>(
  function ShareCard({ data }, ref) {
    const v = VERIFICATION_STYLE[data.verification];
    return (
      <div
        ref={ref}
        style={{
          width: 720,
          padding: 32,
          background:
            "radial-gradient(circle at top left, #1e293b 0%, #0f172a 60%)",
          color: "#f8fafc",
          fontFamily:
            "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 24,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "0.2em",
              color: "#94a3b8",
            }}
          >
            BENCHTRACE
          </div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.15em",
              padding: "4px 10px",
              borderRadius: 999,
              color: v.color,
              border: `1px solid ${v.color}33`,
              background: `${v.color}1a`,
            }}
          >
            {v.label}
          </div>
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 24,
            fontWeight: 600,
            lineHeight: 1.25,
            marginBottom: 6,
          }}
        >
          {data.title}
        </div>
        <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 24 }}>
          {data.subtitle}
        </div>

        {/* Stat grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12,
            marginBottom: 24,
          }}
        >
          {data.results.slice(0, 6).map((r) => (
            <div
              key={r.label}
              style={{
                padding: "14px 16px",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 10,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.1em",
                  color: "#94a3b8",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                {r.label}
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontFamily:
                    "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
                  fontWeight: 500,
                }}
              >
                {r.value}
              </div>
            </div>
          ))}
        </div>

        {/* Context lines */}
        <div
          style={{
            display: "grid",
            gap: 4,
            fontSize: 13,
            color: "#cbd5e1",
            marginBottom: 12,
          }}
        >
          <div>
            <span style={{ color: "#64748b" }}>Model · </span>
            {data.modelLine}
          </div>
          <div>
            <span style={{ color: "#64748b" }}>Hardware · </span>
            {data.hardwareLine}
          </div>
          <div>
            <span style={{ color: "#64748b" }}>Workload · </span>
            {data.workloadLine}
          </div>
        </div>

        {data.warnings.length > 0 ? (
          <div
            style={{
              marginTop: 14,
              padding: "8px 12px",
              background: "rgba(251,191,36,0.08)",
              border: "1px solid rgba(251,191,36,0.3)",
              borderRadius: 8,
              fontSize: 12,
              color: "#fcd34d",
            }}
          >
            ⚠ {data.warnings.join(" · ")}
          </div>
        ) : null}

        {/* Footer */}
        <div
          style={{
            marginTop: 24,
            paddingTop: 14,
            borderTop: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "#64748b",
            fontFamily:
              "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
          }}
        >
          <span>benchtrace.share.v1</span>
          {data.fingerprint ? <span>fp · {data.fingerprint}</span> : <span>—</span>}
        </div>
      </div>
    );
  },
);
