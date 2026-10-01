"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { addCity, removeCity, searchCities, type CitySuggestion } from "@/lib/city-actions";
import { MAX_CUSTOM_CITIES, PRIORITY_LABEL, type Priority } from "@/lib/config";
import type { CityView } from "@/lib/data";
import { Segmented } from "./controls";

const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];
const SHEET = "(max-width: 640px)";
const PASSCODE_KEY = "dirabot:passcode";
const SLOT_MS = 8 * 3600_000;

const noop = () => () => {};
/** True in the browser, false while server rendering (portals need `document`). */
const useIsClient = () => useSyncExternalStore(noop, () => true, () => false);

/** The scraper runs at 00:00, 08:00 and 16:00 UTC; the next slot in Israel time, e.g. "11:00". */
function nextRunLabel(now = Date.now()) {
  const next = (Math.floor(now / SLOT_MS) + 1) * SLOT_MS;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(next);
}

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
    // Storage blocked (private mode, sandboxed preview): the passcode just isn't remembered.
  }
}

/** "+ Add city" chip that opens the add/remove dialog. */
export function AddCityButton({ cities, passcodeRequired }: { cities: CityView[]; passcodeRequired: boolean }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const isClient = useIsClient();
  const close = useCallback(() => {
    setOpen(false);
    btnRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-border-strong px-3 text-[13px] font-medium text-muted outline-none transition-[background-color,border-color,color,transform] duration-150 ease-out hover:border-fg/40 hover:bg-surface hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.97]"
      >
        <svg viewBox="0 0 16 16" className="-ml-0.5 size-3.5" fill="none" aria-hidden>
          <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        Add city
      </button>
      {isClient &&
        createPortal(
          <AnimatePresence>
            {open && <AddCityDialog key="add-city" cities={cities} passcodeRequired={passcodeRequired} onClose={close} />}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

type FieldError = { msg: string; field?: "query" | "priority" | "passcode" };

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Centered dialog (bottom sheet at ≤ 640px). Rendered in a portal: the sticky filter bar's
 * backdrop-filter and the filters sheet's transform would otherwise trap `position: fixed`.
 */
function AddCityDialog({ cities, passcodeRequired, onClose }: { cities: CityView[]; passcodeRequired: boolean; onClose: () => void }) {
  const uid = useId();
  const reduce = useReducedMotion();
  const [isSheet] = useState(() => window.matchMedia(SHEET).matches);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CitySuggestion | null>(null);
  const [results, setResults] = useState<CitySuggestion[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [priority, setPriority] = useState<Priority>(3);
  const [passcode, setPasscode] = useState(() => (passcodeRequired ? readPasscode() : ""));
  const [error, setError] = useState<FieldError | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "add" or the key being removed
  const [searching, startSearch] = useTransition();
  const [, startMutation] = useTransition();
  const searchSeq = useRef(0);

  const custom = cities.filter((c) => c.custom);
  const full = custom.length >= MAX_CUSTOM_CITIES;
  const q = query.trim();

  // Lock page scroll and focus the input while open.
  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  // Escape closes the suggestions first, then the dialog. Captured on window so it doesn't
  // also reach the filters sheet (or popovers) underneath, which listen on document.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      if (listOpen) setListOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listOpen, onClose]);

  // Debounced CBS lookup; stale responses are dropped.
  useEffect(() => {
    if (!q || (selected && q === selected.he)) return;
    const t = setTimeout(() => {
      const seq = ++searchSeq.current;
      startSearch(async () => {
        const res = await searchCities(q);
        if (seq !== searchSeq.current) return;
        setResults(res.results);
        setSearchError(res.error ?? null);
        setActive(res.results.findIndex((r) => !r.tracked));
        setListOpen(true);
      });
    }, 180);
    return () => clearTimeout(t);
  }, [q, selected]);

  const onQuery = (v: string) => {
    setQuery(v);
    setError(null);
    setSuccess(null);
    if (selected && v.trim() !== selected.he) setSelected(null);
    if (!v.trim()) {
      searchSeq.current++;
      setResults([]);
      setListOpen(false);
    }
  };

  const pick = (s: CitySuggestion) => {
    if (s.tracked) return;
    setSelected(s);
    setQuery(s.he);
    setListOpen(false);
    setError(null);
  };

  const step = (dir: 1 | -1) => {
    if (!results.length) return;
    let i = active;
    for (let n = 0; n < results.length; n++) {
      i = (i + dir + results.length) % results.length;
      if (!results[i].tracked) break;
    }
    setActive(i);
  };

  const onInputKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!listOpen && results.length) setListOpen(true);
      else step(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter" && listOpen && results[active] && !results[active].tracked) {
      e.preventDefault();
      pick(results[active]);
    }
  };

  /** Keeps Tab inside the dialog. */
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

  const needPasscode = () => {
    if (passcodeRequired && !passcode.trim()) {
      setError({ msg: "Enter the passcode", field: "passcode" });
      return true;
    }
    return false;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setSuccess(null);
    if (!q) return setError({ msg: "Type a city name", field: "query" });
    if (needPasscode()) return;
    setError(null);
    setListOpen(false);
    setBusy("add");
    startMutation(async () => {
      const res = await addCity({ code: selected?.code, query: selected ? undefined : q, priority, passcode: passcodeRequired ? passcode : undefined });
      setBusy(null);
      if (!res.ok) {
        setError({ msg: res.error, field: res.field });
        return;
      }
      if (passcodeRequired) storePasscode(passcode);
      setSuccess(`${res.city.name} added — it'll be scanned on the next run at ${nextRunLabel()}.`);
      setQuery("");
      setSelected(null);
      setResults([]);
      inputRef.current?.focus({ preventScroll: true });
    });
  };

  const remove = (c: CityView) => {
    if (busy || needPasscode()) return;
    setError(null);
    setSuccess(null);
    setBusy(c.key);
    startMutation(async () => {
      const res = await removeCity({ key: c.key, passcode: passcodeRequired ? passcode : undefined });
      setBusy(null);
      if (!res.ok) setError({ msg: res.error, field: res.field });
      else {
        if (passcodeRequired) storePasscode(passcode);
        setSuccess(`${c.name} removed.`);
      }
    });
  };

  const listId = `${uid}-list`;
  const showList = listOpen && q.length > 0 && !(selected && q === selected.he);
  const fieldErr = (f: FieldError["field"]) =>
    error && error.field === f ? (
      <p id={`${uid}-${f}-err`} className="mt-1.5 text-[12px] font-medium text-danger">
        {error.msg}
      </p>
    ) : null;

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
          className="pointer-events-auto flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-[20px] border-t border-border bg-surface shadow-[0_-16px_48px_-16px_rgb(0_0_0/0.3)] min-[641px]:max-h-[min(640px,calc(100dvh-48px))] min-[641px]:max-w-[440px] min-[641px]:rounded-2xl min-[641px]:border min-[641px]:shadow-[var(--shadow-lift)]"
        >
          <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-4 pb-1 min-[641px]:pt-5">
            <div className="min-w-0">
              <h2 id={`${uid}-title`} className="text-[16px] font-semibold tracking-[-0.01em]">
                Add a city
              </h2>
              <p id={`${uid}-desc`} className="mt-0.5 text-[13px] leading-snug text-muted">
                Any Israeli city or town. It joins the next scrape on Yad2, OnMap, Homeless, Madlan and Facebook groups.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 -mt-1 grid size-9 shrink-0 place-items-center rounded-full text-muted outline-none transition-[background-color,color,transform] duration-150 hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.94]"
            >
              <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
                <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(20px+env(safe-area-inset-bottom))] min-[641px]:pb-5">
            <form onSubmit={submit} noValidate className="pt-3">
              <label htmlFor={`${uid}-q`} className="mb-1.5 block text-[13px] font-semibold">
                City
              </label>
              <div
                className={`relative flex h-10 items-center rounded-[10px] border bg-surface transition-colors focus-within:border-accent ${
                  error?.field === "query" ? "border-danger" : "border-border hover:border-border-strong"
                }`}
              >
                <svg className="pointer-events-none absolute left-3 size-3.5 text-faint" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.6" />
                  <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <input
                  ref={inputRef}
                  id={`${uid}-q`}
                  value={query}
                  onChange={(e) => onQuery(e.target.value)}
                  onKeyDown={onInputKey}
                  onFocus={() => results.length && !selected && setListOpen(true)}
                  onBlur={() => setListOpen(false)}
                  maxLength={60}
                  dir="auto"
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="go"
                  placeholder="e.g. רעננה or Ra'anana"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={showList}
                  aria-controls={listId}
                  aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
                  aria-invalid={error?.field === "query" || undefined}
                  aria-describedby={error?.field === "query" ? `${uid}-query-err` : undefined}
                  className="size-full min-w-0 bg-transparent pl-8 pr-9 text-[16px] outline-none placeholder:text-faint min-[641px]:text-[14px]"
                />
                <span className="pointer-events-none absolute right-3 grid size-4 place-items-center text-accent" aria-hidden>
                  {searching ? <Spinner /> : selected ? <CheckIcon /> : null}
                </span>
              </div>

              <AnimatePresence initial={false}>
                {showList && (
                  <motion.ul
                    key="list"
                    id={listId}
                    role="listbox"
                    aria-label="Matching settlements"
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
                    transition={{ duration: 0.16, ease: EASE }}
                    className="mt-1.5 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-[var(--shadow-card)]"
                  >
                    {results.map((r, i) => (
                      <li
                        key={r.code}
                        id={`${listId}-${i}`}
                        role="option"
                        aria-selected={i === active}
                        aria-disabled={r.tracked || undefined}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => !r.tracked && setActive(i)}
                        onClick={() => pick(r)}
                        className={`flex h-10 items-center justify-between gap-3 rounded-lg px-3 text-[14px] transition-colors duration-100 ${
                          r.tracked ? "cursor-default text-faint" : i === active ? "cursor-pointer bg-surface-2 text-fg" : "cursor-pointer text-fg"
                        }`}
                      >
                        <span className="min-w-0 truncate">
                          <bdi className="font-medium">{r.he}</bdi>
                          {r.name !== r.he && <span className="ml-2 text-[12px] text-muted">{r.name}</span>}
                        </span>
                        {r.tracked && <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.04em]">Tracked</span>}
                      </li>
                    ))}
                    {!results.length && (
                      <li role="option" aria-selected={false} aria-disabled className="px-3 py-2.5 text-[13px] text-muted">
                        {searchError ?? (searching ? "Searching…" : "No settlement by that name")}
                      </li>
                    )}
                  </motion.ul>
                )}
              </AnimatePresence>
              {fieldErr("query")}

              <div className="mt-5 mb-1.5 text-[13px] font-semibold" id={`${uid}-prio`}>
                Priority
              </div>
              <Segmented
                id={`${uid}-priority`}
                full
                label="Priority"
                value={priority}
                onChange={setPriority}
                options={([1, 2, 3, 4] as Priority[]).map((p) => ({
                  value: p,
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full" style={{ background: `var(--p${p})` }} />
                      {PRIORITY_LABEL[p]}
                    </span>
                  ),
                }))}
              />
              {fieldErr("priority")}

              {passcodeRequired && (
                <>
                  <label htmlFor={`${uid}-pass`} className="mt-5 mb-1.5 block text-[13px] font-semibold">
                    Passcode
                  </label>
                  <input
                    id={`${uid}-pass`}
                    type="password"
                    value={passcode}
                    onChange={(e) => {
                      setPasscode(e.target.value);
                      if (error?.field === "passcode") setError(null);
                    }}
                    maxLength={200}
                    autoComplete="off"
                    aria-invalid={error?.field === "passcode" || undefined}
                    aria-describedby={error?.field === "passcode" ? `${uid}-passcode-err` : undefined}
                    className={`h-10 w-full rounded-[10px] border bg-surface px-3 text-[16px] outline-none transition-colors focus:border-accent min-[641px]:text-[14px] ${
                      error?.field === "passcode" ? "border-danger" : "border-border hover:border-border-strong"
                    }`}
                  />
                  {fieldErr("passcode")}
                </>
              )}

              <div aria-live="polite" className="empty:hidden">
                {error && !error.field && <p className="mt-4 text-[13px] font-medium text-danger">{error.msg}</p>}
                <AnimatePresence initial={false}>
                  {success && (
                    <motion.p
                      key={success}
                      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2, ease: EASE }}
                      className="mt-4 flex items-start gap-2 rounded-xl bg-accent-soft px-3 py-2.5 text-[13px] font-medium text-accent"
                    >
                      <span className="mt-px shrink-0">
                        <CheckIcon />
                      </span>
                      {success}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>

              <button
                type="submit"
                disabled={busy === "add" || full}
                className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-fg px-4 text-[14px] font-semibold text-bg outline-none transition-[opacity,transform] duration-150 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
              >
                {busy === "add" && <Spinner />}
                {busy === "add" ? "Adding…" : full ? `Limit of ${MAX_CUSTOM_CITIES} added cities reached` : "Add city"}
              </button>
            </form>

            {custom.length > 0 && (
              <section className="mt-6 border-t border-border pt-4" aria-labelledby={`${uid}-added`}>
                <h3 id={`${uid}-added`} className="flex items-baseline justify-between text-[13px] font-semibold">
                  Added cities
                  <span className="text-[12px] font-normal text-faint tabular">
                    {custom.length} of {MAX_CUSTOM_CITIES}
                  </span>
                </h3>
                <ul className="mt-2">
                  <AnimatePresence initial={false}>
                    {custom.map((c) => (
                      <motion.li
                        key={c.key}
                        layout={!reduce}
                        initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                        transition={{ duration: 0.2, ease: EASE }}
                        className="overflow-hidden"
                      >
                        <div className="flex h-11 items-center gap-2.5">
                          <span className="size-1.5 shrink-0 rounded-full" style={{ background: `var(--p${c.priority})` }} />
                          <span className="min-w-0 flex-1 truncate text-[14px]">
                            <span className="font-medium">{c.name}</span>
                            <bdi className="ml-2 text-[13px] text-muted">{c.he}</bdi>
                          </span>
                          <span className="shrink-0 text-[12px] text-faint">{PRIORITY_LABEL[c.priority as Priority]}</span>
                          <button
                            type="button"
                            onClick={() => remove(c)}
                            disabled={!!busy}
                            aria-label={`Remove ${c.name}`}
                            className="-mr-2 grid size-9 shrink-0 place-items-center rounded-full text-muted outline-none transition-[background-color,color,transform] duration-150 hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.94] disabled:opacity-40"
                          >
                            {busy === c.key ? (
                              <Spinner />
                            ) : (
                              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden>
                                <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </section>
            )}
          </div>
        </motion.div>
      </div>
    </>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 animate-spin motion-reduce:animate-none" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden>
      <path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
