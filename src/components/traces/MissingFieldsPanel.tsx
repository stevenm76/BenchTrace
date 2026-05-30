"use client";

import { AlertTriangle, ChevronDown } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface MissingField {
  /** Display name shown to the user (e.g. "Peak VRAM"). */
  label: string;
  /** Why it matters or where it would come from. */
  reason?: string;
  /** Critical fields are listed as warnings, advisory ones are quieter. */
  severity: "critical" | "advisory";
}

interface MissingFieldsPanelProps {
  fields: MissingField[];
}

/**
 * Collapsible enumeration of fields that were *not captured* for this trace.
 * Critical fields are surfaced first; advisory ones are tucked into the
 * collapsed section. Missing data should always be visible, never silently
 * absent.
 */
export function MissingFieldsPanel({ fields }: MissingFieldsPanelProps) {
  const [open, setOpen] = useState(false);

  if (fields.length === 0) return null;

  const critical = fields.filter((f) => f.severity === "critical");
  const advisory = fields.filter((f) => f.severity === "advisory");

  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 text-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        <AlertTriangle className="size-4 text-amber-400 shrink-0" />
        <span className="flex-1 font-medium">
          {critical.length} critical
          {advisory.length > 0
            ? ` + ${advisory.length} advisory`
            : ""}{" "}
          field{fields.length === 1 ? "" : "s"} not captured
        </span>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="border-t border-amber-500/20 px-4 py-3 space-y-3">
          {critical.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs uppercase tracking-wider text-amber-300/80">
                Critical
              </div>
              <ul className="space-y-1">
                {critical.map((f) => (
                  <li key={f.label} className="flex items-baseline gap-2">
                    <Badge
                      variant="outline"
                      className="border-amber-500/40 text-amber-300 font-mono text-xs"
                    >
                      {f.label}
                    </Badge>
                    {f.reason ? (
                      <span className="text-xs text-muted-foreground">
                        {f.reason}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {advisory.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Advisory
              </div>
              <ul className="space-y-1">
                {advisory.map((f) => (
                  <li key={f.label} className="flex items-baseline gap-2">
                    <Badge
                      variant="outline"
                      className="font-mono text-xs text-muted-foreground"
                    >
                      {f.label}
                    </Badge>
                    {f.reason ? (
                      <span className="text-xs text-muted-foreground">
                        {f.reason}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
