"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { SOURCES, type SourceKey } from "@/lib/config";
import type { ListingView } from "@/lib/data";
import { ils, ilsShort, relativeTime } from "@/lib/format";
import type { PriceEntry } from "@/lib/price-history";

const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];
const WIDTH = 288;
const GUTTER = 16;

type Dir = "down" | "up" | "flat";
const dirOf = (n: number): Dir => (n < 0 ? "down" : n > 0 ? "up" : "flat");

const TONE: Record<Dir, CSSProperties> = {
  down: { color: "var(--drop)", background: "var(--drop-soft)" },
  up: { color: "var(--rise)", background: "var(--rise-soft)" },
  flat: { color: "var(--muted)", background: "var(--surface-2)" },
};
const ARROW: Record<Dir, string> = { down: "↓", up: "↑", flat: "↔" };

const sourceName = (s: string) => SOURCES[s as SourceKey]?.name ?? s;

const fmtDate = (iso: string, now: number) => {
  const d = new Date(iso);
  const sameYear = d.getUTCFullYear() === new Date(now).getUTCFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "Asia/Jerusalem" });
};

/** "Was ₪3.9M · changed 3d ago": the badge's tooltip and the map popup's line. */
export function priceChangeHint(l: Pick<ListingView, "price" | "priceChange" | "priceChangedAt" | "source">, now: number) {
  if (l.priceChange == null || l.price == null) return null;
  const was = `Was ${ilsShort(l.price - l.priceChange)}`;
  return l.priceChangedAt ? `${was} · changed ${relativeTime(l.priceChangedAt, now)}` : `${was} · per ${sourceName(l.source)}`;
}

/**
 * Compact "↓ ₪120K" / "↑ ₪50K" badge for a listing whose price changed (vs the first known price).
 * A button: click (tap) toggles the history popover, hovering with a mouse previews it.
 * Must not be rendered inside a link; cards place it as a positioned sibling.
 */
export function PriceChangeBadge({
  l,
  now,
  size = "md",
  className = "",
}: {
  l: ListingView;
  now: number;
  size?: "sm" | "md";
  className?: string;
}) {
  const [open, setOpen] = useState<false | "hover" | "pinned">(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const popId = useId();

  const schedule = useCallback((fn: () => void, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, ms);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const close = useCallback((refocus = false) => {
    window.clearTimeout(timer.current);
    setOpen(false);
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !popRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(true);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  if (l.priceChange == null || l.price == null) return null;
  const dir = dirOf(l.priceChange);
  const amount = dir === "flat" ? "₪0" : ilsShort(Math.abs(l.priceChange));
  const hint = priceChangeHint(l, now)!;
  const label = dir === "flat" ? "Price changed" : `Price ${dir === "down" ? "dropped" : "rose"} ${amount}`;

  const hoverable = (e: ReactPointerEvent) => e.pointerType === "mouse";
  const leave = (e: ReactPointerEvent) => {
    if (hoverable(e) && open !== "pinned") schedule(() => setOpen((o) => (o === "hover" ? false : o)), 160);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={open ? undefined : hint}
        aria-label={`${label}. ${hint}. Price history`}
        aria-expanded={!!open}
        aria-haspopup="dialog"
        aria-controls={open ? popId : undefined}
        onClick={() => {
          window.clearTimeout(timer.current);
          setOpen((o) => (o === "pinned" ? false : "pinned"));
        }}
        onPointerEnter={(e) => {
          if (hoverable(e) && !open) schedule(() => setOpen((o) => o || "hover"), 140);
          else if (hoverable(e)) window.clearTimeout(timer.current);
        }}
        onPointerLeave={leave}
        style={TONE[dir]}
        className={`inline-flex shrink-0 cursor-pointer items-center gap-0.5 whitespace-nowrap font-semibold tabular outline-none transition-[scale,filter,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:brightness-[0.97] focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.97] ${
          size === "sm" ? "h-5 rounded-md px-1.5 text-[11px]" : "h-[22px] rounded-full px-2 text-[11px] shadow-[0_1px_2px_rgb(0_0_0/0.12)]"
        } ${open ? "ring-1 ring-current/30" : ""} ${className}`}
      >
        <span aria-hidden>{ARROW[dir]}</span> {amount}
      </button>
      <PricePopover
        id={popId}
        open={!!open}
        anchor={triggerRef}
        popRef={popRef}
        onPointerEnter={() => window.clearTimeout(timer.current)}
        onPointerLeave={leave}
      >
        <PriceHistoryPanel l={l} now={now} />
      </PricePopover>
    </>
  );
}

/** Fixed-position popover in a portal (cards sit in transformed, clipped containers). Follows its anchor on scroll. */
function PricePopover({
  id,
  open,
  anchor,
  popRef,
  children,
  onPointerEnter,
  onPointerLeave,
}: {
  id: string;
  open: boolean;
  anchor: RefObject<HTMLElement | null>;
  popRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  onPointerEnter: () => void;
  onPointerLeave: (e: ReactPointerEvent) => void;
}) {
  const reduce = useReducedMotion();
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean; originX: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      if (!a) return;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const width = Math.min(WIDTH, vw - GUTTER * 2);
      const height = popRef.current?.offsetHeight ?? 260;
      const left = Math.max(GUTTER, Math.min(a.left + a.width / 2 - width / 2, vw - width - GUTTER));
      const below = a.bottom + 8;
      const above = below + height > vh - GUTTER && a.top - 8 - height > GUTTER;
      setPos({ top: above ? a.top - 8 - height : below, left, above, originX: a.left + a.width / 2 - left });
    };
    place();
    // A second pass once the panel has its real height.
    const raf = requestAnimationFrame(place);
    window.addEventListener("scroll", place, { capture: true, passive: true });
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", place, { capture: true });
      window.removeEventListener("resize", place);
    };
  }, [open, anchor, popRef]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence onExitComplete={() => setPos(null)}>
      {open && (
        <motion.div
          ref={popRef}
          id={id}
          role="dialog"
          aria-label="Price history"
          onPointerEnter={(e) => e.pointerType === "mouse" && onPointerEnter()}
          onPointerLeave={onPointerLeave}
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: pos?.above ? 4 : -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: pos?.above ? 4 : -4 }}
          transition={{ duration: 0.18, ease: EASE }}
          style={{
            top: pos?.top ?? -9999,
            left: pos?.left ?? 0,
            width: `min(${WIDTH}px, calc(100vw - ${GUTTER * 2}px))`,
            transformOrigin: `${pos?.originX ?? WIDTH / 2}px ${pos?.above ? "100%" : "0"}`,
            visibility: pos ? "visible" : "hidden",
          }}
          className="fixed z-[60] rounded-2xl border border-border bg-surface p-3.5 text-fg shadow-[var(--shadow-lift)]"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function PriceHistoryPanel({ l, now }: { l: ListingView; now: number }) {
  const points = l.priceHistory;
  const change = l.priceChange ?? 0;
  const first = (l.price ?? 0) - change;
  const pct = first ? (change / first) * 100 : 0;
  const dir = dirOf(change);
  const site = sourceName(l.source);
  const rows = points.map((p, i) => ({ p, delta: i > 0 ? p.price - points[i - 1].price : null })).reverse();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold">Price history</h3>
        <span className="text-[12px] font-semibold tabular" style={{ color: TONE[dir].color }}>
          {ARROW[dir]} {ilsShort(Math.abs(change))}
          {dir !== "flat" && <span className="ml-1 font-medium opacity-80">({Math.abs(pct).toFixed(pct && Math.abs(pct) < 1 ? 1 : 0)}%)</span>}
        </span>
      </div>
      <Sparkline points={points} />
      <ol className="-mx-1 flex max-h-[220px] flex-col overflow-y-auto overscroll-contain">
        {rows.map(({ p, delta }, i) => (
          <li key={`${p.at}-${p.price}`} className={`flex items-center justify-between gap-3 rounded-lg px-1 py-1.5 ${i === 0 ? "" : "border-t border-border"}`}>
            <span className="min-w-0 text-[12px] leading-tight">
              <span className={`block ${i === 0 ? "font-medium text-fg" : "text-muted"}`}>
                {p.undated ? "Earlier" : fmtDate(p.at, now)}
                {i === 0 && <span className="ml-1 font-normal text-faint">· now</span>}
              </span>
              {p.source === "site" && <span className="block text-[11px] text-faint">per {site}</span>}
            </span>
            <span className="flex shrink-0 items-baseline gap-2 tabular">
              <span className={`text-[13px] ${i === 0 ? "font-semibold" : "text-fg/80"}`}>{ils(p.price)}</span>
              <span className="w-[54px] text-right text-[11px] font-semibold" style={{ color: delta == null ? "var(--faint)" : TONE[dirOf(delta)].color }}>
                {delta == null ? "first" : `${ARROW[dirOf(delta)]} ${ilsShort(Math.abs(delta))}`}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Step line: the price holds until the next change. One dot per change; the line runs on to "now". */
function Sparkline({ points }: { points: PriceEntry[] }) {
  const W = 260;
  const H = 52;
  const PAD = 6;
  if (points.length < 2) return null;
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  // Evenly spaced: undated site entries have no real position on a time axis.
  const step = (W - PAD * 2) / (points.length - 0.4);
  const x = (i: number) => PAD + i * step;
  const y = (v: number) => PAD + (1 - (v - min) / span) * (H - PAD * 2);
  let d = `M${x(0)},${y(prices[0])}`;
  for (let i = 1; i < points.length; i++) d += `H${x(i)}V${y(prices[i])}`;
  d += `H${W - PAD}`;
  const area = `${d}V${H}H${x(0)}Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" aria-hidden>
      <path d={area} fill="var(--accent)" opacity="0.08" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) =>
        i === 0 ? (
          <circle key={i} cx={x(i)} cy={y(p.price)} r="2.5" fill="var(--surface)" stroke="var(--accent)" strokeWidth="1.5" />
        ) : (
          <circle key={i} cx={x(i)} cy={y(p.price)} r={i === points.length - 1 ? 3.5 : 2.75} fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" />
        ),
      )}
    </svg>
  );
}
