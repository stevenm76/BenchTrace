"use client";

import { createContext, useCallback, useEffect, useMemo, useState } from "react";

import type { Tier } from "./types";

const STORAGE_KEY = "bt_tier";

export interface TierContextValue {
  tier: Tier;
  setTier: (next: Tier) => void;
}

export const TierContext = createContext<TierContextValue | null>(null);

export function TierProvider({
  initial,
  children,
}: {
  initial: Tier;
  children: React.ReactNode;
}) {
  const [tier, setTierState] = useState<Tier>(initial);

  // Sync localStorage on mount (cookie is the source of truth for SSR, but
  // localStorage avoids cookie-clear surprises and keeps within-session
  // changes responsive even when cookies are blocked).
  useEffect(() => {
    const local = localStorage.getItem(STORAGE_KEY);
    if (local && local !== tier && (local === "basic" || local === "intermediate" || local === "expert")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTierState(local);
      document.documentElement.dataset.tier = local;
    } else {
      localStorage.setItem(STORAGE_KEY, tier);
    }
    // We intentionally only sync once on mount; subsequent changes flow
    // through setTier below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTier = useCallback((next: Tier) => {
    setTierState(next);
    localStorage.setItem(STORAGE_KEY, next);
    document.cookie = `${STORAGE_KEY}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    document.documentElement.dataset.tier = next;
  }, []);

  const value = useMemo(() => ({ tier, setTier }), [tier, setTier]);
  return <TierContext.Provider value={value}>{children}</TierContext.Provider>;
}
