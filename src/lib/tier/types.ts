/**
 * Pure types + sync helpers for the tier system. No Next.js server imports
 * here, so this module is safe to import from both server and client
 * components. Cookie reading lives in cookie.ts (server-only).
 */

export type Tier = "basic" | "intermediate" | "expert";
export type ThemeMode = "light" | "dark" | "system";

export const VALID_TIERS: readonly Tier[] = ["basic", "intermediate", "expert"] as const;
export const VALID_THEMES: readonly ThemeMode[] = ["light", "dark", "system"] as const;

export const DEFAULT_TIER: Tier = "basic";
export const DEFAULT_THEME: ThemeMode = "light";

export const TIER_RANK: Record<Tier, number> = { basic: 0, intermediate: 1, expert: 2 };

export function tierAtLeast(current: Tier, min: Tier): boolean {
  return TIER_RANK[current] >= TIER_RANK[min];
}
