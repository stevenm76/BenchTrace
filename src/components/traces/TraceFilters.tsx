"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { tierAtLeast } from "@/lib/tier/types";
import { useTier } from "@/lib/tier/useTier";
import {
  buildTraceQuery,
  parseTraceFilters,
} from "@/lib/traces/url-filters";
import { cn } from "@/lib/utils";

import type { TraceListFilters } from "@/lib/db/queries/traces";
import type { EngineType, VerificationLevel } from "@/lib/db/schema";

interface TraceFiltersProps {
  dimensions: {
    engineTypes: string[];
    quantizations: string[];
    tensorParallelSizes: number[];
    kvCacheDtypes: string[];
  };
}

const VERIFICATION_OPTIONS: VerificationLevel[] = [
  "strong",
  "medium",
  "weak",
  "suspicious",
];

export function TraceFilters({ dimensions }: TraceFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const { tier } = useTier();
  const showAdvanced = tierAtLeast(tier, "intermediate");

  const initial = parseTraceFilters(
    Object.fromEntries(searchParams.entries()),
  );

  const [search, setSearch] = useState(initial.search ?? "");

  // Debounced text search update.
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((initial.search ?? "") === search) return;
      const next = parseTraceFilters(
        Object.fromEntries(searchParams.entries()),
      );
      const q = buildTraceQuery({
        ...next,
        search: search || undefined,
      });
      startTransition(() => {
        router.replace(q ? `${pathname}?${q}` : pathname);
      });
    }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function toggleArray<T extends string>(
    key: keyof TraceListFilters,
    value: T,
  ) {
    const current = parseTraceFilters(
      Object.fromEntries(searchParams.entries()),
    );
    const existing = (current[key] as T[] | undefined) ?? [];
    const has = existing.includes(value);
    const next = {
      ...current,
      [key]: has ? existing.filter((v) => v !== value) : [...existing, value],
    } as TraceListFilters;
    const q = buildTraceQuery(next);
    startTransition(() => {
      router.replace(q ? `${pathname}?${q}` : pathname);
    });
  }

  function setNumber(
    key: keyof TraceListFilters,
    value: number | undefined,
  ) {
    const current = parseTraceFilters(
      Object.fromEntries(searchParams.entries()),
    );
    const next = { ...current, [key]: value } as TraceListFilters;
    const q = buildTraceQuery(next);
    startTransition(() => {
      router.replace(q ? `${pathname}?${q}` : pathname);
    });
  }

  function setString(key: keyof TraceListFilters, value: string | undefined) {
    setNumber(key as keyof TraceListFilters, undefined);
    const current = parseTraceFilters(
      Object.fromEntries(searchParams.entries()),
    );
    const next = { ...current, [key]: value || undefined } as TraceListFilters;
    const q = buildTraceQuery(next);
    startTransition(() => {
      router.replace(q ? `${pathname}?${q}` : pathname);
    });
  }

  function clearAll() {
    setSearch("");
    startTransition(() => {
      router.replace(pathname);
    });
  }

  const filtersActive =
    Boolean(initial.engineTypes?.length) ||
    Boolean(initial.quantizations?.length) ||
    Boolean(initial.verificationLevels?.length) ||
    initial.contextLengthMin != null ||
    initial.outputTpsMin != null ||
    initial.tensorParallelSize != null ||
    Boolean(initial.kvCacheDtype) ||
    Boolean(initial.search);

  return (
    <aside className="w-64 shrink-0 border-r border-border bg-card/30 px-4 py-5 space-y-5 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Filters
        </h2>
        {filtersActive ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={clearAll}
          >
            <X className="size-3 mr-1" />
            Clear
          </Button>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="search" className="text-xs text-muted-foreground">
          Search
        </Label>
        <div className="relative">
          <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="search"
            placeholder="trace or model…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      {showAdvanced ? (
        <>
          <Separator />

          <FilterGroup
            title="Engine"
            options={dimensions.engineTypes}
            selected={initial.engineTypes ?? []}
            onToggle={(v) =>
              toggleArray<EngineType>("engineTypes", v as EngineType)
            }
          />

          <FilterGroup
            title="Quantization"
            options={dimensions.quantizations}
            selected={initial.quantizations ?? []}
            onToggle={(v) => toggleArray("quantizations", v)}
          />

          <FilterGroup
            title="Verification"
            options={VERIFICATION_OPTIONS}
            selected={initial.verificationLevels ?? []}
            onToggle={(v) =>
              toggleArray<VerificationLevel>(
                "verificationLevels",
                v as VerificationLevel,
              )
            }
          />

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Tensor parallel size
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {dimensions.tensorParallelSizes.map((tp) => {
                const active = initial.tensorParallelSize === tp;
                return (
                  <Button
                    key={tp}
                    size="sm"
                    variant={active ? "default" : "outline"}
                    className="h-7 px-2 text-xs font-mono"
                    onClick={() =>
                      setNumber("tensorParallelSize", active ? undefined : tp)
                    }
                  >
                    TP={tp}
                  </Button>
                );
              })}
            </div>
          </div>

          {dimensions.kvCacheDtypes.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                KV cache dtype
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {dimensions.kvCacheDtypes.map((kv) => {
                  const active = initial.kvCacheDtype === kv;
                  return (
                    <Button
                      key={kv}
                      size="sm"
                      variant={active ? "default" : "outline"}
                      className="h-7 px-2 text-xs font-mono"
                      onClick={() =>
                        setString("kvCacheDtype", active ? undefined : kv)
                      }
                    >
                      {kv}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="min-tps" className="text-xs text-muted-foreground">
              Min output tok/s
            </Label>
            <Input
              id="min-tps"
              type="number"
              inputMode="decimal"
              placeholder="e.g. 100"
              defaultValue={initial.outputTpsMin ?? ""}
              onBlur={(e) => {
                const v = e.target.value.trim();
                setNumber("outputTpsMin", v ? Number(v) : undefined);
              }}
              className="h-8 text-sm font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="min-ctx" className="text-xs text-muted-foreground">
              Min context length
            </Label>
            <Input
              id="min-ctx"
              type="number"
              placeholder="e.g. 16384"
              defaultValue={initial.contextLengthMin ?? ""}
              onBlur={(e) => {
                const v = e.target.value.trim();
                setNumber("contextLengthMin", v ? Number(v) : undefined);
              }}
              className="h-8 text-sm font-mono"
            />
          </div>
        </>
      ) : null}
    </aside>
  );
}

function FilterGroup({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{title}</Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <Badge
              key={opt}
              variant={active ? "default" : "outline"}
              className={cn(
                "cursor-pointer select-none font-mono text-xs",
                active ? "" : "hover:bg-accent",
              )}
              onClick={() => onToggle(opt)}
            >
              {opt}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}
