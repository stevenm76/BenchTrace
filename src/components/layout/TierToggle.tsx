"use client";

import { useTier } from "@/lib/tier/useTier";
import type { Tier } from "@/lib/tier/types";

const OPTIONS: { value: Tier; label: string; hint: string }[] = [
  { value: "basic", label: "Basic", hint: "10-second triage" },
  { value: "intermediate", label: "Intermediate", hint: "Comparing models" },
  { value: "expert", label: "Expert", hint: "Telemetry + raw artifacts" },
];

export function TierToggle() {
  const { tier, setTier } = useTier();
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-1">
        Detail
      </div>
      <div
        role="group"
        aria-label="Detail level"
        className="flex flex-col gap-0.5"
      >
        {OPTIONS.map((o) => {
          const active = tier === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              title={o.hint}
              onClick={() => setTier(o.value)}
              className={
                "group relative w-full text-left rounded-md px-2 py-1.5 text-xs transition-colors " +
                (active
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground")
              }
            >
              <div className="flex items-center justify-between">
                <span>{o.label}</span>
                {active ? (
                  <span className="inline-block size-1.5 rounded-full bg-primary" />
                ) : null}
              </div>
              <div className="text-[10px] text-muted-foreground/80 mt-0.5 group-hover:text-muted-foreground">
                {o.hint}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
