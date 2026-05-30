import {
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { VerificationLevel } from "@/lib/db/schema";

const LEVELS: Record<
  VerificationLevel,
  { label: string; className: string; icon: typeof ShieldCheck }
> = {
  strong: {
    label: "Strong",
    className:
      "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
    icon: ShieldCheck,
  },
  medium: {
    label: "Medium",
    className:
      "border-sky-500/40 bg-sky-500/15 text-sky-300",
    icon: CheckCircle2,
  },
  weak: {
    label: "Weak",
    className:
      "border-muted-foreground/30 bg-muted text-muted-foreground",
    icon: ShieldQuestion,
  },
  suspicious: {
    label: "Suspicious",
    className:
      "border-destructive/50 bg-destructive/15 text-red-300",
    icon: ShieldAlert,
  },
};

interface VerificationBadgeProps {
  level: VerificationLevel;
  /** Render compact (no icon). */
  compact?: boolean;
  className?: string;
}

export function VerificationBadge({
  level,
  compact = false,
  className,
}: VerificationBadgeProps) {
  const entry = LEVELS[level];
  const Icon = entry.icon;
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 text-xs font-medium uppercase tracking-wide", entry.className, className)}
    >
      {compact ? null : <Icon className="size-3" />}
      {entry.label}
    </Badge>
  );
}
