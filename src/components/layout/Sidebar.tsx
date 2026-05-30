"use client";

import {
  Activity,
  GitCompare,
  Import,
  LayoutDashboard,
  ListChecks,
  Table,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { TierToggle } from "@/components/layout/TierToggle";
import type { ThemeMode } from "@/lib/tier/types";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/traces", label: "Traces", icon: Table },
  { href: "/compare", label: "Compare", icon: GitCompare },
  { href: "/profiles", label: "Profiles", icon: ListChecks },
  { href: "/import", label: "Import", icon: Import },
];

export function Sidebar({ initialTheme }: { initialTheme: ThemeMode }) {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:w-56 md:shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <Activity className="size-5 text-primary" />
        <span className="text-sm font-semibold tracking-tight">BenchTrace</span>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border px-3 py-3 space-y-3">
        <TierToggle />
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Theme
          </div>
          <ThemeToggle initial={initialTheme} />
        </div>
        <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/60">
          Local-first · SQLite
        </div>
      </div>
    </aside>
  );
}
