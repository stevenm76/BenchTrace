/**
 * Server-only cookie readers for tier + theme. Used in
 * src/app/layout.tsx to set <html data-tier="..."> + dark class
 * before hydration, so the page never flashes.
 *
 * Types and sync helpers live in ./types.ts so client components can use
 * them without dragging next/headers into the client bundle.
 */
import { cookies } from "next/headers";

import {
  DEFAULT_THEME,
  DEFAULT_TIER,
  VALID_THEMES,
  VALID_TIERS,
  type ThemeMode,
  type Tier,
} from "./types";

// Re-export so existing callers that did `import { Tier } from "@/lib/tier/cookie"`
// continue to work without churn.
export {
  DEFAULT_THEME,
  DEFAULT_TIER,
  TIER_RANK,
  VALID_THEMES,
  VALID_TIERS,
  tierAtLeast,
  type ThemeMode,
  type Tier,
} from "./types";

const TIER_COOKIE = "bt_tier";
const THEME_COOKIE = "bt_theme";

export async function readTier(): Promise<Tier> {
  const c = await cookies();
  const v = c.get(TIER_COOKIE)?.value;
  return (VALID_TIERS as readonly string[]).includes(v ?? "") ? (v as Tier) : DEFAULT_TIER;
}

export async function readTheme(): Promise<ThemeMode> {
  const c = await cookies();
  const v = c.get(THEME_COOKIE)?.value;
  return (VALID_THEMES as readonly string[]).includes(v ?? "") ? (v as ThemeMode) : DEFAULT_THEME;
}
