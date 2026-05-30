"use client";

import { Laptop, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Mode = "light" | "dark" | "system";

const STORAGE_KEY = "bt_theme";

function applyMode(mode: Mode) {
  const html = document.documentElement;
  const wantDark =
    mode === "dark" ||
    (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  html.classList.toggle("dark", wantDark);
}

function setCookie(mode: Mode) {
  document.cookie = `${STORAGE_KEY}=${mode}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export function ThemeToggle({ initial }: { initial: Mode }) {
  const [mode, setMode] = useState<Mode>(initial);

  useEffect(() => {
    // Re-apply on system-preference change while in system mode.
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyMode("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  const pick = (next: Mode) => {
    setMode(next);
    localStorage.setItem(STORAGE_KEY, next);
    setCookie(next);
    applyMode(next);
  };

  const opts: { value: Mode; icon: typeof Sun; label: string }[] = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "system", icon: Laptop, label: "System" },
    { value: "dark", icon: Moon, label: "Dark" },
  ];

  return (
    <div
      role="group"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5"
    >
      {opts.map((o) => {
        const Icon = o.icon;
        const active = mode === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            aria-label={o.label}
            title={o.label}
            onClick={() => pick(o.value)}
            className={
              "inline-flex items-center justify-center rounded px-1.5 py-1 transition-colors " +
              (active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent")
            }
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
