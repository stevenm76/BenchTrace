"use client";

import type { Tier } from "./types";
import { tierAtLeast } from "./types";
import { useTier } from "./useTier";

/**
 * Renders children only when the current tier is at least `min`.
 *
 * <TierGate min="intermediate">…</TierGate>
 *   → shown for Intermediate + Expert; hidden for Basic.
 */
export function TierGate({
  min,
  fallback = null,
  children,
}: {
  min: Tier;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { tier } = useTier();
  return <>{tierAtLeast(tier, min) ? children : fallback}</>;
}
