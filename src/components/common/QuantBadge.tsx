import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Map a quantization label to a chroma family. Uppercase comparison. */
function colorFor(quant: string): string {
  const q = quant.toUpperCase();
  if (q.startsWith("NVFP4") || q === "FP4") {
    return "border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-300";
  }
  if (q.startsWith("FP8")) {
    return "border-cyan-500/40 bg-cyan-500/15 text-cyan-300";
  }
  if (q === "AWQ" || q === "GPTQ") {
    return "border-amber-500/40 bg-amber-500/15 text-amber-300";
  }
  if (q.startsWith("Q8")) {
    return "border-sky-500/40 bg-sky-500/15 text-sky-300";
  }
  if (q.startsWith("Q4") || q.startsWith("Q5") || q.startsWith("Q6")) {
    return "border-orange-500/40 bg-orange-500/15 text-orange-300";
  }
  if (q === "BF16" || q === "FP16" || q === "FP32") {
    return "border-muted-foreground/30 bg-muted/40 text-muted-foreground";
  }
  if (q.startsWith("INT")) {
    return "border-slate-500/40 bg-slate-500/15 text-slate-300";
  }
  return "border-border bg-muted text-foreground/80";
}

interface QuantBadgeProps {
  quantization: string | null | undefined;
  className?: string;
}

export function QuantBadge({ quantization, className }: QuantBadgeProps) {
  if (!quantization) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "font-mono text-xs border-amber-500/30 text-amber-400/70",
          className,
        )}
      >
        unknown quant
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn("font-mono text-xs", colorFor(quantization), className)}
    >
      {quantization}
    </Badge>
  );
}
