/**
 * Compact relative time string suitable for table cells and list rows.
 *
 *   < 1 m   → "just now"
 *   < 1 h   → "12m ago"
 *   < 24 h  → "5h ago"
 *   < 7 d   → "3d ago"
 *   < 30 d  → "2w ago"
 *   < 365 d → "Mar 14"
 *   else    → "Mar 14, 2024"
 */
export function formatRelativeShort(d: Date | null | undefined): string {
  if (!d) return "—";
  const now = Date.now();
  const ms = now - d.getTime();
  if (ms < 60_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    year: sameYear ? undefined : "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Long absolute timestamp suitable for tooltips and hero rows. */
export function formatAbsolute(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
