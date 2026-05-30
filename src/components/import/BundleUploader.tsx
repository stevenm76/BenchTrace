"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Folder,
  Trash2,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  classifyFilename,
  roleLabel,
  type BundleFile,
  type BundleFileRole,
} from "@/lib/import/bundle";
import { cn } from "@/lib/utils";

interface BundleUploaderProps {
  files: BundleFile[];
  onFilesChange: (files: BundleFile[]) => void;
}

const ROLE_BADGE: Record<BundleFileRole, string> = {
  benchmark_result:
    "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  launch_command:
    "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
  benchmark_command:
    "border-violet-500/40 bg-violet-500/15 text-violet-300",
  nvidia_smi: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  hardware_snapshot: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  server_log: "border-slate-500/40 bg-slate-500/15 text-slate-300",
  stdout: "border-slate-500/40 bg-slate-500/15 text-slate-300",
  stderr: "border-slate-500/40 bg-slate-500/15 text-slate-300",
  notes: "border-pink-500/40 bg-pink-500/15 text-pink-300",
  other: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

export function BundleUploader({
  files,
  onFilesChange,
}: BundleUploaderProps) {
  const [dragOver, setDragOver] = useState(false);

  async function ingestFiles(fileList: FileList | File[]) {
    const added: BundleFile[] = [];
    for (const f of Array.from(fileList)) {
      // Reject huge files outright — bundle imports are evidence, not bulk data.
      if (f.size > 10 * 1024 * 1024) {
        toast.error(`${f.name} is larger than 10 MB — skipped.`);
        continue;
      }
      try {
        const content = await f.text();
        added.push({ name: f.name, content, size: f.size });
      } catch (err) {
        console.error(err);
        toast.error(`Could not read ${f.name}`);
      }
    }
    if (added.length === 0) return;
    // Replace any existing file with the same name, then append the rest.
    const existing = files.filter(
      (e) => !added.some((a) => a.name === e.name),
    );
    onFilesChange([...existing, ...added]);
  }

  function removeFile(name: string) {
    onFilesChange(files.filter((f) => f.name !== name));
  }

  const roleCounts: Partial<Record<BundleFileRole, number>> = {};
  for (const f of files) {
    const role = classifyFilename(f.name);
    roleCounts[role] = (roleCounts[role] ?? 0) + 1;
  }

  const required: { role: BundleFileRole; label: string }[] = [
    { role: "benchmark_result", label: "benchmark_result.json" },
    { role: "launch_command", label: "launch_command.txt" },
    { role: "benchmark_command", label: "benchmark_command.txt" },
    { role: "nvidia_smi", label: "nvidia-smi.txt (optional)" },
  ];

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length > 0) {
            ingestFiles(e.dataTransfer.files);
          }
        }}
        className={cn(
          "rounded-md border-2 border-dashed px-6 py-8 text-center transition-colors",
          dragOver
            ? "border-primary bg-primary/5"
            : "border-border bg-card/30",
        )}
      >
        <Folder className="mx-auto size-7 text-muted-foreground/70" />
        <div className="mt-2 text-sm">
          Drop bundle files here, or
        </div>
        <div className="mt-2 flex justify-center gap-2">
          <Label htmlFor="bundle-files" className="cursor-pointer">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent">
              <Upload className="size-3.5" />
              Select files
            </span>
            <input
              id="bundle-files"
              type="file"
              multiple
              accept=".json,.txt,.log,.md,.out"
              onChange={(e) => {
                if (e.target.files) ingestFiles(e.target.files);
                e.target.value = "";
              }}
              className="hidden"
            />
          </Label>
          {files.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onFilesChange([])}
            >
              <Trash2 className="size-3.5 mr-1" />
              Clear all
            </Button>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-muted-foreground max-w-lg mx-auto">
          Accepted: <code className="font-mono">.json</code> ·{" "}
          <code className="font-mono">.txt</code> ·{" "}
          <code className="font-mono">.log</code> ·{" "}
          <code className="font-mono">.md</code>. Files are classified by
          filename — see the required panel below.
        </p>
      </div>

      {/* Expected files panel */}
      <div className="rounded-md border border-border bg-card/30 p-3 space-y-1.5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Expected files (classified by filename pattern)
        </div>
        <div className="space-y-1">
          {required.map((r) => {
            const present = (roleCounts[r.role] ?? 0) > 0;
            return (
              <div
                key={r.role}
                className="flex items-center gap-2 text-sm"
              >
                {present ? (
                  <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="size-3.5 text-amber-400/70 shrink-0" />
                )}
                <span className={present ? "" : "text-muted-foreground"}>
                  {r.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* File list */}
      {files.length > 0 ? (
        <div className="rounded-md border border-border bg-card/40 divide-y divide-border/60">
          {files.map((f) => {
            const role = classifyFilename(f.name);
            return (
              <div
                key={f.name}
                className="px-3 py-2 flex items-center gap-3 text-sm"
              >
                <FileText className="size-4 text-muted-foreground shrink-0" />
                <span className="font-mono text-xs flex-1 truncate">
                  {f.name}
                </span>
                <span className="font-mono text-xs text-muted-foreground shrink-0">
                  {prettySize(f.size)}
                </span>
                <Badge
                  variant="outline"
                  className={cn("font-mono text-xs", ROLE_BADGE[role])}
                >
                  {roleLabel(role)}
                </Badge>
                <button
                  onClick={() => removeFile(f.name)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${f.name}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
