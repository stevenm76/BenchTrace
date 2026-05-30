"use client";

import { Check, ChevronDown, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CommandBlockProps {
  title: string;
  command: string | null | undefined;
  /** Collapsed by default. Long commands stay folded. */
  defaultOpen?: boolean;
}

export function CommandBlock({
  title,
  command,
  defaultOpen = false,
}: CommandBlockProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  return (
    <div className="rounded-md border border-border bg-card/40 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium hover:text-foreground transition-colors"
        >
          <ChevronDown
            className={cn(
              "size-3.5 text-muted-foreground transition-transform",
              open ? "rotate-0" : "-rotate-90",
            )}
          />
          {title}
        </button>
        {command ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={copy}
          >
            {copied ? (
              <>
                <Check className="size-3 mr-1" /> Copied
              </>
            ) : (
              <>
                <Copy className="size-3 mr-1" /> Copy
              </>
            )}
          </Button>
        ) : null}
      </div>
      {open ? (
        <pre className="px-3 py-3 text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap break-all">
          {command ?? (
            <span className="text-amber-400/70">not captured</span>
          )}
        </pre>
      ) : null}
    </div>
  );
}
