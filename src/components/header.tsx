"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { RunView } from "@/lib/data";
import { sourceName } from "@/lib/config";
import { relativeTime } from "@/lib/format";
import { Logo } from "./logo";

const STATUS: Record<string, { label: string; dot: string }> = {
  ok: { label: "תקין", dot: "var(--accent)" },
  skipped: { label: "דילוג", dot: "var(--faint)" },
  paused: { label: "מושהה", dot: "var(--faint)" },
  blocked: { label: "חסום", dot: "var(--rise)" },
  error: { label: "שגיאה", dot: "var(--danger)" },
  running: { label: "רץ", dot: "var(--p2)" },
};

const EXTRA: Record<string, string> = { ai: "ניקוד AI", profile: "פרופיל" };

export function Header({ runs, now }: { runs?: RunView[]; now: number }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" aria-label="joBot">
          <Logo />
        </Link>
        <nav className="ms-2 flex items-center gap-1 text-[14px] font-medium">
          {[
            { href: "/", label: "משרות" },
            { href: "/profile", label: "האיפיון שלי" },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 transition-colors ${path === l.href ? "bg-surface-2 text-fg" : "text-muted hover:text-fg"}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ms-auto">{runs && <StatusPill runs={runs} now={now} />}</div>
      </div>
    </header>
  );
}

function StatusPill({ runs, now }: { runs: RunView[]; now: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const scrapers = runs.filter((r) => !EXTRA[r.source]);
  const last = runs.map((r) => r.finishedAt).filter(Boolean).sort().at(-1) ?? null;
  const healthy = scrapers.filter((r) => r.status === "ok" || r.status === "skipped" || r.status === "paused").length;
  const bad = scrapers.length - healthy;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-surface px-3 text-[12px] font-medium text-muted transition-colors hover:text-fg"
      >
        <span className="size-1.5 rounded-full" style={{ background: !runs.length ? "var(--faint)" : bad ? "var(--rise)" : "var(--accent)" }} />
        {last ? (
          <span>
            עודכן {relativeTime(last, now)}
            <span className="hidden sm:inline">
              {" "}
              · <span className="tabular">{healthy}/{scrapers.length}</span> מקורות
            </span>
          </span>
        ) : (
          "עוד לא רץ"
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
            style={{ transformOrigin: "top left" }}
            className="absolute end-0 top-[calc(100%+8px)] z-50 w-[min(340px,calc(100vw-32px))] rounded-2xl border border-border bg-surface p-2 shadow-[var(--shadow-lift)]"
          >
            <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">ריצה אחרונה לכל מקור</p>
            {runs.length === 0 && <p className="px-2 py-2 text-[13px] text-muted">הסורק עוד לא רץ. אחרי מילוי האיפיון הוא ירוץ לפי הלוח.</p>}
            {runs.map((r) => {
              const s = STATUS[r.status] ?? STATUS.error;
              return (
                <div key={r.source} className="rounded-lg px-2 py-1.5 hover:bg-surface-2">
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: s.dot }} />
                    <span className="font-medium text-fg">{EXTRA[r.source] ?? sourceName(r.source)}</span>
                    <span className="text-faint">{s.label}</span>
                    <span className="ms-auto tabular text-[12px] text-muted">
                      {r.status === "ok" ? `${r.inserted} חדשות` : ""} · {relativeTime(r.finishedAt, now)}
                    </span>
                  </div>
                  {r.message && r.status !== "ok" && (
                    <p dir="auto" className="ms-3.5 mt-0.5 line-clamp-2 text-[11px] text-faint">
                      {r.message}
                    </p>
                  )}
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
