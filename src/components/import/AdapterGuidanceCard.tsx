"use client";

import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  FileJson,
  Lightbulb,
  Terminal,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { GUIDANCE } from "@/lib/import/guidance";

interface Props {
  adapterId: string;
  /** Called when the user clicks "Load example" — replaces the textarea contents. */
  onLoadExample: (text: string) => void;
  /** Called when the user clicks the "Switch to Manual" CTA on a stub adapter. */
  onSwitchToManual: () => void;
}

export function AdapterGuidanceCard({
  adapterId,
  onLoadExample,
  onSwitchToManual,
}: Props) {
  const g = GUIDANCE[adapterId];
  const [copied, setCopied] = useState(false);

  if (!g) return null;

  async function copyCommand() {
    if (!g.cliCommand) return;
    try {
      await navigator.clipboard.writeText(g.cliCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  // Stub adapter — redirect to Manual.
  if (g.isStub) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="size-4 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-medium text-amber-300">
              Parser not implemented yet
            </div>
            <p className="text-sm text-muted-foreground mt-1">{g.intro}</p>
          </div>
        </div>

        {g.tips?.length ? (
          <ul className="text-sm space-y-1.5 ml-6">
            {g.tips.map((tip, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <Lightbulb className="size-3.5 text-amber-400/70 shrink-0 mt-1" />
                <span className="text-muted-foreground">{tip}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex items-center gap-2 pl-6">
          <Button size="sm" onClick={onSwitchToManual}>
            <ChevronRight className="size-4 mr-1.5" />
            Switch to Manual
          </Button>
          <span className="text-xs text-muted-foreground">
            The Manual adapter accepts a hand-authored benchtrace.share.v1
            document.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-card/30 p-4 space-y-3">
      <p className="text-sm">{g.intro}</p>

      {g.cliCommand ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Terminal className="size-3.5" />
              Run this to produce the file
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={copyCommand}
            >
              {copied ? (
                <>
                  <Check className="size-3 mr-1" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="size-3 mr-1" />
                  Copy
                </>
              )}
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-md border border-border/60 bg-slate-950/60 px-3 py-2.5 text-xs font-mono whitespace-pre">
            {g.cliCommand}
          </pre>
          {g.outputHint ? (
            <div className="text-xs text-muted-foreground">{g.outputHint}</div>
          ) : null}
        </div>
      ) : g.outputHint ? (
        <div className="text-xs text-muted-foreground">{g.outputHint}</div>
      ) : null}

      {g.tips?.length ? (
        <ul className="space-y-1.5 pt-1">
          {g.tips.map((tip, i) => (
            <li key={i} className="flex items-baseline gap-2 text-xs">
              <Lightbulb className="size-3 text-amber-400/70 shrink-0 mt-0.5" />
              <span className="text-muted-foreground">{tip}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {g.examplePayload ? (
        <div className="flex items-center gap-2 pt-1 border-t border-border/40">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onLoadExample(g.examplePayload!)}
          >
            <FileJson className="size-3.5 mr-1.5" />
            Load example payload
          </Button>
          <span className="text-xs text-muted-foreground">
            Fills the textarea below with a known-good sample so you can
            parse + import in one click.
          </span>
        </div>
      ) : null}
    </div>
  );
}
