const TZ = "Asia/Jerusalem";

/** "לפני 3 שעות" — `now` comes from the server so server and client render the same text. */
export function relativeTime(iso: string | null | undefined, now: number): string {
  if (!iso) return "—";
  const diff = Math.max(0, now - new Date(iso).getTime());
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "עכשיו";
  if (m < 60) return `לפני ${m} דק׳`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? "לפני שעה" : `לפני ${h} שעות`;
  const d = Math.floor(h / 24);
  if (d === 1) return "אתמול";
  if (d < 30) return `לפני ${d} ימים`;
  return new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "short", timeZone: TZ });
}

export const clockTime = (iso: string) => new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: TZ });

export const isFresh = (iso: string, now: number, hours = 24) => now - new Date(iso).getTime() < hours * 3_600_000;

/** Score → tone used by the ring and chips. */
export function scoreTone(score: number | null) {
  if (score == null) return { label: "—", ring: "var(--border-strong)", text: "text-faint" };
  if (score >= 80) return { label: "התאמה גבוהה", ring: "var(--accent)", text: "text-accent" };
  if (score >= 65) return { label: "התאמה טובה", ring: "var(--p2)", text: "text-[color:var(--p2)]" };
  if (score >= 45) return { label: "התאמה חלקית", ring: "var(--rise)", text: "text-[color:var(--rise)]" };
  return { label: "התאמה נמוכה", ring: "var(--faint)", text: "text-faint" };
}

export const WORK_MODEL_LABEL: Record<string, string> = { remote: "מהבית", hybrid: "היברידי", onsite: "מהמשרד" };
