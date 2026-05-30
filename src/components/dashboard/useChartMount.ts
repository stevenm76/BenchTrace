"use client";

import { useEffect, useState } from "react";

/**
 * Recharts' ResponsiveContainer queries clientWidth/Height of its parent on
 * first render. During SSR + the initial pre-hydration paint there is no
 * layout, so it logs "width(-1) height(-1)" warnings and the chart never
 * draws. Gate chart rendering on a useEffect to skip the SSR pass.
 */
export function useChartMount() {
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);
  return mounted;
}
