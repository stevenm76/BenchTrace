import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STYLES: Record<string, { label: string; className: string }> = {
  vllm: {
    label: "vLLM",
    className:
      "border-violet-500/40 bg-violet-500/15 text-violet-300 hover:bg-violet-500/20",
  },
  sglang: {
    label: "SGLang",
    className:
      "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/20",
  },
  llamacpp: {
    label: "llama.cpp",
    className:
      "border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/20",
  },
  ollama: {
    label: "Ollama",
    className:
      "border-cyan-500/40 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/20",
  },
  generic_openai: {
    label: "OpenAI-compat",
    className:
      "border-slate-500/40 bg-slate-500/15 text-slate-300 hover:bg-slate-500/20",
  },
  other: {
    label: "Other",
    className:
      "border-muted-foreground/30 bg-muted text-muted-foreground",
  },
};

interface EngineBadgeProps {
  engine: string;
  version?: string | null;
  className?: string;
}

export function EngineBadge({ engine, version, className }: EngineBadgeProps) {
  const style = STYLES[engine] ?? STYLES.other!;
  return (
    <Badge
      variant="outline"
      className={cn("font-mono text-xs gap-1", style.className, className)}
    >
      <span>{style.label}</span>
      {version ? <span className="opacity-70">{version}</span> : null}
    </Badge>
  );
}
