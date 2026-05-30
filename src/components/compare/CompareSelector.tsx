"use client";

import { Plus, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { EngineBadge } from "@/components/common/EngineBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeShort } from "@/lib/format/time";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface AvailableTrace {
  id: string;
  name: string;
  engine: string;
  quantization: string | null;
  contextLength: number | null;
  when: Date | null;
}

interface CompareSelectorProps {
  selectedIds: string[];
  selectedTraces: { id: string; name: string; engine: string }[];
  available: AvailableTrace[];
}

export function CompareSelector({
  selectedIds,
  selectedTraces,
  available,
}: CompareSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);

  function setIds(ids: string[]) {
    const next = new URLSearchParams(sp);
    if (ids.length) next.set("ids", ids.join(","));
    else next.delete("ids");
    router.replace(next.toString() ? `${pathname}?${next}` : pathname);
  }

  function add(id: string) {
    if (selectedIds.includes(id)) return;
    setIds([...selectedIds, id]);
    setOpen(false);
  }

  function remove(id: string) {
    setIds(selectedIds.filter((x) => x !== id));
  }

  return (
    <div className="rounded-lg border border-border bg-card/40 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Comparing
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {selectedTraces.length} trace
          {selectedTraces.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {selectedTraces.map((t) => (
          <div
            key={t.id}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1"
          >
            <EngineBadge engine={t.engine} />
            <span className="text-xs max-w-xs truncate">{t.name}</span>
            <button
              onClick={() => remove(t.id)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Remove"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button variant="outline" size="sm" className="h-8">
                <Plus className="size-3.5 mr-1" />
                Add trace
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add a trace to compare</DialogTitle>
            </DialogHeader>
            <div className="max-h-96 overflow-y-auto divide-y divide-border/60">
              {available
                .filter((t) => !selectedIds.includes(t.id))
                .map((t) => (
                  <button
                    key={t.id}
                    onClick={() => add(t.id)}
                    className="w-full text-left px-2 py-2.5 hover:bg-accent rounded-sm"
                  >
                    <div className="flex items-center gap-2">
                      <EngineBadge engine={t.engine} />
                      {t.quantization ? (
                        <Badge
                          variant="outline"
                          className="font-mono text-xs"
                        >
                          {t.quantization}
                        </Badge>
                      ) : null}
                      {t.contextLength ? (
                        <Badge
                          variant="outline"
                          className="font-mono text-xs"
                        >
                          {(t.contextLength / 1024).toFixed(0)}k
                        </Badge>
                      ) : null}
                      <span className="ml-auto font-mono text-xs text-muted-foreground">
                        {formatRelativeShort(t.when)}
                      </span>
                    </div>
                    <div className="text-sm mt-1">{t.name}</div>
                  </button>
                ))}
              {available.filter((t) => !selectedIds.includes(t.id)).length === 0 ? (
                <div className="px-2 py-6 text-sm text-muted-foreground text-center">
                  No more traces available.
                </div>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
