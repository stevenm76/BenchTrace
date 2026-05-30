import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface MetricSectionProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function MetricSection({
  title,
  description,
  action,
  children,
  className,
}: MetricSectionProps) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground/80">
            {title}
          </h2>
          {description ? (
            <p className="text-xs text-muted-foreground mt-0.5">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      <div>{children}</div>
    </section>
  );
}

/**
 * Two-column key/value row used inside data sections (Hardware, Model, etc.).
 */
export function DataRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 py-1.5 text-sm border-b border-border/40 last:border-0",
        className,
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-mono text-xs">{children}</span>
    </div>
  );
}

/**
 * A compact "stat card" used for high-level metrics.
 */
export function StatCard({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card/60 px-4 py-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-xl font-mono tabular-nums">{children}</div>
      {hint ? (
        <div className="mt-1 text-xs text-muted-foreground font-mono">
          {hint}
        </div>
      ) : null}
    </div>
  );
}
