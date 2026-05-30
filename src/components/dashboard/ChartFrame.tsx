import type { ReactNode } from "react";

interface ChartFrameProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  height?: number;
}

/**
 * Card wrapper around a single dashboard chart. Server-component-safe
 * (the inner chart child component is responsible for its own 'use client').
 */
export function ChartFrame({
  title,
  description,
  action,
  children,
  height = 280,
}: ChartFrameProps) {
  return (
    <div className="rounded-lg border border-border bg-card/50 overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-border/60">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? (
            <p className="text-xs text-muted-foreground mt-0.5">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="px-2 py-3" style={{ height }}>
        {children}
      </div>
    </div>
  );
}
