import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-border bg-card/30 px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <Icon className="mx-auto size-8 text-muted-foreground/70" />
      ) : null}
      <h3 className="mt-3 text-sm font-medium">{title}</h3>
      {description ? (
        <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
