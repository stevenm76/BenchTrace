import { ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";

interface Props {
  totals: { label: string; count: number }[];
}

export function RedactionPreview({ totals }: Props) {
  const total = totals.reduce((a, b) => a + b.count, 0);
  if (total === 0) {
    return (
      <div className="text-xs text-muted-foreground flex items-center gap-1.5 px-1">
        <ShieldCheck className="size-3.5 text-emerald-400" />
        Nothing matched redaction rules.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 space-y-1.5">
      <div className="text-xs flex items-center gap-1.5 text-emerald-300">
        <ShieldCheck className="size-3.5" />
        Redacted <span className="font-mono">{total}</span> item
        {total === 1 ? "" : "s"}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {totals.map((t) => (
          <Badge key={t.label} variant="outline" className="text-xs">
            {t.label} · <span className="font-mono ml-1">{t.count}</span>
          </Badge>
        ))}
      </div>
    </div>
  );
}
