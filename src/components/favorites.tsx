"use client";

import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { ListingView } from "@/lib/data";
import { toggleStar, type ToggleStarResult } from "@/lib/favorite-actions";

/*
 * Favorites: the owner stars listings; stars live in the DB (listings.starred_at) so they follow
 * them across devices. Changing a star needs ADMIN_PASSCODE when one is set, asked for once and
 * remembered under the same key the add-city dialog uses.
 */

const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];
const SHEET = "(max-width: 640px)";
/** Shared with add-city.tsx so the owner enters the passcode once. */
const PASSCODE_KEY = "dirabot:passcode";

function readPasscode() {
  try {
    return localStorage.getItem(PASSCODE_KEY) ?? "";
  } catch {
    return "";
  }
}
function storePasscode(v: string) {
  try {
    localStorage.setItem(PASSCODE_KEY, v);
  } catch {
    // Storage blocked (private mode): the passcode just isn't remembered.
  }
}
function forgetPasscode() {
  try {
    localStorage.removeItem(PASSCODE_KEY);
  } catch {}
}

async function send(id: number, starred: boolean, passcode?: string): Promise<ToggleStarResult> {
  try {
    return await toggleStar(id, starred, passcode || undefined);
  } catch {
    return { ok: false, reason: "error" };
  }
}

/* ───────────────────────── State ───────────────────────── */

/** Optimistic stars (listing id → starredAt) waiting for the server; empty once it has answered. */
type Overrides = ReadonlyMap<number, string | null>;
const NONE: Overrides = new Map();

const OverridesContext = createContext<Overrides>(NONE);
const ToggleContext = createContext<((id: number, starred: boolean) => void) | null>(null);

type Ask = { id: number; starred: boolean; rejected: boolean };

const noop = () => () => {};
const useIsClient = () => useSyncExternalStore(noop, () => true, () => false);

export function FavoritesProvider({ passcodeRequired, children }: { passcodeRequired: boolean; children: ReactNode }) {
  // Applied only while the action is in flight; the revalidated page then carries the real value.
  // A failed action simply ends the transition, which rolls the star back.
  const [overrides, setOverride] = useOptimistic(NONE, (m: Overrides, u: { id: number; starredAt: string | null }) => new Map(m).set(u.id, u.starredAt));
  const [ask, setAsk] = useState<Ask | null>(null);
  const isClient = useIsClient();

  const toggle = useCallback(
    (id: number, starred: boolean) => {
      const saved = readPasscode();
      if (passcodeRequired && !saved) {
        setAsk({ id, starred, rejected: false });
        return;
      }
      startTransition(async () => {
        setOverride({ id, starredAt: starred ? new Date().toISOString() : null });
        const res = await send(id, starred, saved);
        if (!res.ok && res.reason === "passcode") {
          forgetPasscode();
          setAsk({ id, starred, rejected: !!saved });
        }
      });
    },
    [passcodeRequired, setOverride],
  );

  /** The dialog's submit: on success the page has already revalidated, so the star fills as it closes. */
  const submitPasscode = useCallback(
    async (passcode: string) => {
      if (!ask) return { ok: false, reason: "invalid" } as const;
      const res = await send(ask.id, ask.starred, passcode);
      if (res.ok) {
        storePasscode(passcode);
        setAsk(null);
      } else if (res.reason === "passcode") forgetPasscode();
      return res;
    },
    [ask],
  );
  const close = useCallback(() => setAsk(null), []);

  return (
    <ToggleContext value={toggle}>
      <OverridesContext value={overrides}>{children}</OverridesContext>
      {isClient &&
        createPortal(
          <AnimatePresence>{ask && <PasscodeDialog key="passcode" ask={ask} onSubmit={submitPasscode} onClose={close} />}</AnimatePresence>,
          document.body,
        )}
    </ToggleContext>
  );
}

/** The listings with in-flight star changes applied. */
export function useStarredListings(listings: ListingView[]) {
  const overrides = useContext(OverridesContext);
  return useMemo(() => {
    if (!overrides.size) return listings;
    return listings.map((l) => {
      const v = overrides.get(l.id);
      return v === undefined ? l : { ...l, starredAt: v };
    });
  }, [listings, overrides]);
}

/** `(id, starred) => void`, or null outside a FavoritesProvider. */
export const useStarToggle = () => useContext(ToggleContext);

/* ───────────────────────── UI ───────────────────────── */

export const STAR_PATH =
  "M8 1.9 9.86 5.66l4.15.6-3 2.93.71 4.13L8 11.37l-3.72 1.95.71-4.13-3-2.93 4.15-.6L8 1.9Z";

export function StarIcon({ filled, className = "size-4", edge = "var(--star-edge)" }: { filled: boolean; className?: string; edge?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden>
      <path
        d={STAR_PATH}
        fill={filled ? "var(--star)" : "transparent"}
        stroke={filled ? edge : "currentColor"}
        strokeWidth="1.4"
        strokeLinejoin="round"
        className="transition-[fill,stroke] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
      />
    </svg>
  );
}

/**
 * Round star toggle. Render it as a sibling of a listing link, never inside one.
 * `overlay` sits on a photo (dark glass); `plain` sits on the surface.
 */
export function StarButton({
  id,
  starred,
  variant = "plain",
  className = "",
}: {
  id: number;
  starred: boolean;
  variant?: "overlay" | "plain";
  className?: string;
}) {
  const toggle = useContext(ToggleContext);
  const reduce = useReducedMotion();
  const [scope, animate] = useAnimate<HTMLButtonElement>();
  const prev = useRef(starred);

  // Pop whenever the state flips (click, dialog success or rollback), not on mount.
  useEffect(() => {
    if (prev.current === starred) return;
    prev.current = starred;
    if (reduce || !scope.current) return;
    if (starred) {
      animate("[data-icon]", { scale: [0.35, 1] }, { type: "spring", stiffness: 520, damping: 12 });
      animate("[data-ring]", { scale: [0.55, 1.45], opacity: [0.9, 0] }, { duration: 0.5, ease: EASE });
    } else {
      animate("[data-icon]", { scale: [0.75, 1] }, { type: "spring", stiffness: 600, damping: 20 });
    }
  }, [starred, reduce, animate, scope]);

  if (!toggle) return null;
  const overlay = variant === "overlay";
  return (
    <button
      ref={scope}
      type="button"
      aria-pressed={starred}
      aria-label={starred ? "Unstar listing" : "Star listing"}
      title={starred ? "Starred" : "Star"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(id, !starred);
      }}
      className={`relative grid size-8 shrink-0 place-items-center rounded-full outline-none transition-[background-color,color,scale] duration-150 ease-out before:absolute before:-inset-1.5 before:content-[''] focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.94] ${
        overlay
          ? "bg-black/45 text-white backdrop-blur-md hover:bg-black/65"
          : `${starred ? "text-star-edge" : "text-faint"} hover:bg-border/70 hover:text-fg`
      } ${className}`}
    >
      <span data-ring aria-hidden className="pointer-events-none absolute inset-0 rounded-full border-2 border-star opacity-0" />
      <span data-icon className="grid place-items-center">
        <StarIcon filled={starred} edge={overlay ? "var(--star)" : undefined} />
      </span>
    </button>
  );
}

/** "Starred N" filter toggle: compact for the desktop bar, `full` for the mobile filters sheet. */
export function StarredFilter({ on, count, onChange, full = false }: { on: boolean; count: number; onChange: (on: boolean) => void; full?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border font-medium outline-none transition-[background-color,border-color,color,scale] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.97] ${
        full ? "h-11 w-full gap-2 rounded-xl px-3.5 text-[14px]" : "h-9 rounded-[10px] px-3 text-[13px]"
      } ${on ? "border-fg bg-fg text-bg" : "border-border bg-surface text-muted hover:border-border-strong hover:text-fg"}`}
    >
      <StarIcon filled={on} className="size-3.5" />
      {full ? "Starred only" : "Starred"}
      <span className={`tabular opacity-60 ${full ? "ml-auto" : ""}`}>{count}</span>
    </button>
  );
}

/* ───────────────────────── Passcode dialog ───────────────────────── */

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Centered dialog (bottom sheet at ≤ 640px), matching the add-city dialog. */
function PasscodeDialog({
  ask,
  onSubmit,
  onClose,
}: {
  ask: Ask;
  onSubmit: (passcode: string) => Promise<ToggleStarResult>;
  onClose: () => void;
}) {
  const uid = useId();
  const reduce = useReducedMotion();
  const [isSheet] = useState(() => window.matchMedia(SHEET).matches);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startSubmit] = useTransition();

  // Lock page scroll, focus the field, and hand focus back to whatever opened the dialog.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  // Captured on window so Escape doesn't also reach the filters sheet underneath.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const onPanelKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const passcode = value.trim();
    if (!passcode) {
      setError("Enter the passcode");
      inputRef.current?.focus();
      return;
    }
    setError(null);
    startSubmit(async () => {
      const res = await onSubmit(passcode);
      if (res.ok) return;
      setError(res.reason === "passcode" ? "That passcode isn't right" : "Couldn't save the star. Try again.");
      inputRef.current?.select();
    });
  };

  const verb = ask.starred ? "Star" : "Unstar";
  const motionProps = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : isSheet
      ? { initial: { y: "100%" }, animate: { y: 0 }, exit: { y: "100%" } }
      : { initial: { opacity: 0, scale: 0.97, y: 8 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0, scale: 0.97, y: 8 } };

  return (
    <>
      <motion.div
        aria-hidden
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2, ease: EASE }}
        className="fixed inset-0 z-[60] bg-black/40"
      />
      <div className="pointer-events-none fixed inset-0 z-[61] flex items-end justify-center min-[641px]:items-center min-[641px]:p-6">
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${uid}-title`}
          aria-describedby={`${uid}-desc`}
          onKeyDown={onPanelKey}
          {...motionProps}
          transition={{ duration: isSheet && !reduce ? 0.28 : 0.2, ease: EASE }}
          className="pointer-events-auto w-full overflow-hidden rounded-t-[20px] border-t border-border bg-surface shadow-[0_-16px_48px_-16px_rgb(0_0_0/0.3)] min-[641px]:max-w-[380px] min-[641px]:rounded-2xl min-[641px]:border min-[641px]:shadow-[var(--shadow-lift)]"
        >
          <form onSubmit={submit} noValidate className="px-5 pt-5 pb-[calc(20px+env(safe-area-inset-bottom))] min-[641px]:pb-5">
            <div className="flex items-start gap-3.5">
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-star-edge" aria-hidden>
                <StarIcon filled className="size-4" />
              </span>
              <div className="min-w-0">
                <h2 id={`${uid}-title`} className="text-[16px] font-semibold tracking-[-0.01em]">
                  Admin passcode
                </h2>
                <p id={`${uid}-desc`} className="mt-0.5 text-[13px] leading-snug text-muted">
                  {ask.rejected
                    ? "The saved passcode no longer works. Enter it again."
                    : "Stars sync across your devices, so changing them needs the passcode. It’s remembered on this device."}
                </p>
              </div>
            </div>

            <label htmlFor={`${uid}-pass`} className="sr-only">
              Passcode
            </label>
            <input
              ref={inputRef}
              id={`${uid}-pass`}
              type="password"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              maxLength={200}
              autoComplete="current-password"
              enterKeyHint="done"
              placeholder="Passcode"
              aria-invalid={!!error || undefined}
              aria-describedby={error ? `${uid}-err` : undefined}
              className={`mt-4 h-10 w-full rounded-[10px] border bg-surface px-3 text-[16px] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-faint focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] min-[641px]:text-[14px] ${
                error ? "border-danger" : "border-border hover:border-border-strong"
              }`}
            />
            <div aria-live="polite" className="empty:hidden">
              {error && (
                <p id={`${uid}-err`} className="mt-1.5 text-[12px] font-medium text-danger">
                  {error}
                </p>
              )}
            </div>

            <div className="mt-5 flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-11 shrink-0 rounded-xl px-3 text-[14px] font-medium text-fg underline-offset-4 outline-none transition-[color,scale] duration-150 hover:underline focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.97]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-fg px-4 text-[14px] font-semibold text-bg outline-none transition-[opacity,scale] duration-150 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.98] disabled:cursor-wait disabled:opacity-80"
              >
                {pending && (
                  <svg viewBox="0 0 16 16" className="size-3.5 animate-spin motion-reduce:animate-none" fill="none" aria-hidden>
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
                    <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                )}
                {pending ? "Checking…" : `${verb} listing`}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </>
  );
}
