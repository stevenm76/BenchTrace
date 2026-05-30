"use client";

import { toPng } from "html-to-image";
import JSZip from "jszip";
import { Check, Copy, Download, Share2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { RedactionPreview } from "@/components/share/RedactionPreview";
import { ShareCard } from "@/components/share/ShareCard";
import type { ShareCardData } from "@/lib/share/card-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { ReproJsonV1 } from "@/lib/schemas/repro-json";

interface ShareModalProps {
  traceId: string;
  traceName: string;
  card: ShareCardData;
  /** When redaction is disabled. */
  rawJson: ReproJsonV1;
  rawJsonRedactions: { label: string; count: number }[];
  rawMarkdown: string;
  rawMarkdownRedactions: { label: string; count: number }[];
}

export function ShareModal({
  traceId,
  traceName,
  card,
  rawJson,
  rawJsonRedactions,
  rawMarkdown,
  rawMarkdownRedactions,
}: ShareModalProps) {
  const [open, setOpen] = useState(false);
  const [redact, setRedact] = useState(true);
  const [redactLocalPaths, setRedactLocalPaths] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // The server-rendered JSON/Markdown was pre-built with redact=true and
  // redactLocalPaths=false. Other combinations require fetching from API.
  const needsServerFetch = !redact || redactLocalPaths;

  const [serverJson, setServerJson] = useState<{
    json: ReproJsonV1;
    redactions: { label: string; count: number }[];
  } | null>(null);
  const [serverMarkdown, setServerMarkdown] = useState<{
    markdown: string;
    redactions: { label: string; count: number }[];
  } | null>(null);

  async function ensureServerFetched() {
    if (!needsServerFetch) return;
    if (serverJson && serverMarkdown) return;
    const qs = new URLSearchParams({
      redact: redact ? "1" : "0",
      paths: redactLocalPaths ? "1" : "0",
    });
    const [jsonRes, mdRes] = await Promise.all([
      fetch(`/api/export/${traceId}/json?${qs}`),
      fetch(`/api/export/${traceId}/markdown?${qs}`),
    ]);
    const jsonBody = await jsonRes.json();
    const mdBody = await mdRes.json();
    setServerJson({
      json: jsonBody.json,
      redactions: jsonBody.redactions ?? [],
    });
    setServerMarkdown({
      markdown: mdBody.markdown,
      redactions: mdBody.redactions ?? [],
    });
  }

  const activeJson = needsServerFetch && serverJson ? serverJson.json : rawJson;
  const activeJsonRedactions =
    needsServerFetch && serverJson ? serverJson.redactions : rawJsonRedactions;
  const activeMarkdown =
    needsServerFetch && serverMarkdown ? serverMarkdown.markdown : rawMarkdown;
  const activeMarkdownRedactions =
    needsServerFetch && serverMarkdown
      ? serverMarkdown.redactions
      : rawMarkdownRedactions;

  const jsonString = useMemo(
    () => JSON.stringify(activeJson, null, 2),
    [activeJson],
  );

  const [copied, setCopied] = useState<"json" | "md" | null>(null);
  async function copy(content: string, kind: "json" | "md") {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1200);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  }

  async function downloadCardPng() {
    if (!cardRef.current) return;
    try {
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 2,
        backgroundColor: "#0f172a",
        cacheBust: true,
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${slug(traceName)}.png`;
      a.click();
      toast.success("Share card downloaded");
    } catch (err) {
      toast.error("Card export failed");
      console.error(err);
    }
  }

  async function downloadBundle() {
    try {
      const zip = new JSZip();
      zip.file("benchtrace.json", jsonString);
      zip.file("share-summary.md", activeMarkdown);
      if (cardRef.current) {
        const dataUrl = await toPng(cardRef.current, {
          pixelRatio: 2,
          backgroundColor: "#0f172a",
        });
        const base64 = dataUrl.split(",")[1]!;
        zip.file("share-card.png", base64, { base64: true });
      }
      // Placeholder structure for raw/redacted dirs (raw artifacts not stored
      // in this MVP; Stage 6 import will start saving them).
      zip.folder("raw")?.file(
        "README.txt",
        "Raw benchmark artifacts (stdout, server logs, nvidia-smi) will be packaged here once Stage 6 imports them.\n",
      );
      zip.folder("redacted")?.file(
        "launch_command.txt",
        activeJson.loader.launch_command ?? "# not captured\n",
      );
      zip.folder("redacted")?.file(
        "benchmark_command.txt",
        activeJson.benchmark.command ?? "# not captured\n",
      );

      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${slug(traceName)}.benchtrace.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Evidence bundle downloaded");
    } catch (err) {
      toast.error("Bundle export failed");
      console.error(err);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) ensureServerFetched();
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Share2 className="size-4 mr-1.5" />
            Share
          </Button>
        }
      />
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Share / Export</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-4 py-2 border-y border-border/40">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={redact}
              onCheckedChange={(v) => {
                setRedact(!!v);
                setServerJson(null);
                setServerMarkdown(null);
                // Refetch on next render.
                setTimeout(() => {
                  if (open) ensureServerFetched();
                }, 0);
              }}
            />
            <span>Redact secrets & home paths</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={redactLocalPaths}
              onCheckedChange={(v) => {
                setRedactLocalPaths(!!v);
                setServerJson(null);
                setServerMarkdown(null);
                setTimeout(() => {
                  if (open) ensureServerFetched();
                }, 0);
              }}
            />
            <span>Also redact local model paths</span>
          </label>
        </div>

        <Tabs defaultValue="card" className="w-full">
          <TabsList>
            <TabsTrigger value="card">Card</TabsTrigger>
            <TabsTrigger value="markdown">Markdown</TabsTrigger>
            <TabsTrigger value="json">Repro JSON</TabsTrigger>
            <TabsTrigger value="bundle">Evidence bundle</TabsTrigger>
          </TabsList>

          <TabsContent value="card" className="space-y-3 mt-3">
            <div className="overflow-x-auto rounded-md border border-border bg-slate-950 p-4 flex justify-center">
              <ShareCard ref={cardRef} data={card} />
            </div>
            <div className="flex justify-end">
              <Button onClick={downloadCardPng}>
                <Download className="size-4 mr-1.5" />
                Download PNG
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="markdown" className="space-y-3 mt-3">
            <RedactionPreview totals={activeMarkdownRedactions} />
            <pre className="max-h-80 overflow-auto rounded-md border border-border bg-card/50 px-3 py-2 text-xs font-mono whitespace-pre-wrap">
              {activeMarkdown}
            </pre>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => copy(activeMarkdown, "md")}
              >
                {copied === "md" ? (
                  <>
                    <Check className="size-4 mr-1.5" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="size-4 mr-1.5" />
                    Copy
                  </>
                )}
              </Button>
              <Button
                onClick={() =>
                  download(
                    activeMarkdown,
                    `${slug(traceName)}.md`,
                    "text/markdown",
                  )
                }
              >
                <Download className="size-4 mr-1.5" />
                Download .md
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="json" className="space-y-3 mt-3">
            <div className="flex items-center justify-between">
              <RedactionPreview totals={activeJsonRedactions} />
              <Badge variant="outline" className="font-mono text-xs">
                {activeJson.schema_version}
              </Badge>
            </div>
            <pre className="max-h-80 overflow-auto rounded-md border border-border bg-card/50 px-3 py-2 text-xs font-mono">
              {jsonString}
            </pre>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => copy(jsonString, "json")}>
                {copied === "json" ? (
                  <>
                    <Check className="size-4 mr-1.5" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="size-4 mr-1.5" />
                    Copy
                  </>
                )}
              </Button>
              <Button
                onClick={() =>
                  download(
                    jsonString,
                    `${slug(traceName)}.benchtrace.json`,
                    "application/json",
                  )
                }
              >
                <Download className="size-4 mr-1.5" />
                Download .json
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="bundle" className="space-y-3 mt-3">
            <div className="rounded-md border border-border bg-card/40 px-4 py-3 text-sm space-y-2">
              <div className="font-medium">Includes</div>
              <ul className="space-y-1 text-xs text-muted-foreground font-mono">
                <li>benchtrace.json — full Repro JSON</li>
                <li>share-summary.md — Markdown summary</li>
                <li>share-card.png — visual card</li>
                <li>raw/ — raw artifacts (when imported in Stage 6)</li>
                <li>redacted/launch_command.txt, benchmark_command.txt</li>
              </ul>
            </div>
            <div className="flex justify-end">
              <Button onClick={downloadBundle}>
                <Download className="size-4 mr-1.5" />
                Download .zip
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        {/* Off-screen card used for PNG capture on tabs other than Card. */}
        <div
          style={{
            position: "absolute",
            left: "-99999px",
            top: 0,
            pointerEvents: "none",
          }}
          aria-hidden
        >
          <ShareCard ref={cardRef} data={card} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
