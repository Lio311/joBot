export const ils = (n: number | null | undefined) =>
  n == null ? "—" : `₪${n.toLocaleString("en-US")}`;

/** "₪3.45M" — compact form for tight spots like chips and stats. */
export const ilsShort = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (n >= 1_000_000) return `₪${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2).replace(/0$/, "")}M`;
  if (n >= 1_000) return `₪${Math.round(n / 1_000)}K`;
  return `₪${n}`;
};

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const diff = Math.max(0, now - new Date(iso).getTime());
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Jerusalem" });
}

export const isFresh = (iso: string, hours = 24, now = Date.now()) =>
  now - new Date(iso).getTime() < hours * 3_600_000;
