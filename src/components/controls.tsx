"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/** Segmented control with a sliding thumb shared across options via layoutId (`id` must be unique per rendered instance). */
export function Segmented<T extends string | number>({
  id,
  value,
  options,
  onChange,
  full,
  label,
}: {
  id: string;
  value: T;
  options: { value: T; label: ReactNode; ariaLabel?: string }[];
  onChange: (v: T) => void;
  /** Stretch to the container width with equal-width options. */
  full?: boolean;
  label?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`relative h-9 shrink-0 items-center rounded-[10px] bg-surface-2 p-[3px] ${full ? "flex w-full" : "inline-flex"}`}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.ariaLabel}
            onClick={() => onChange(o.value)}
            className={`relative z-0 inline-flex h-full items-center justify-center whitespace-nowrap rounded-[7px] text-[13px] font-medium transition-colors duration-150 active:scale-[0.97] ${
              full ? "flex-1 px-2" : "px-3"
            } ${active ? "text-fg" : "text-muted hover:text-fg"}`}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 -z-10 rounded-[7px] bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_var(--border)]"
                transition={{ type: "spring", duration: 0.32, bounce: 0.12 }}
              />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
  dotColor,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  dotColor?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-medium transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.96] ${
        active
          ? "border-fg bg-fg text-bg"
          : "border-border bg-surface text-muted hover:border-border-strong hover:text-fg"
      }`}
    >
      {dotColor && <span className="size-1.5 rounded-full" style={{ background: dotColor }} />}
      {children}
    </button>
  );
}

/** Compact multi-select: a labelled group of pressable options (e.g. Rooms 4 · 4.5 · 5). */
export function ToggleGroup<T extends string | number>({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: T[];
  options: { value: T; label: ReactNode }[];
  onChange: (v: T[]) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex h-9 shrink-0 items-center gap-0.5 rounded-[10px] border border-border bg-surface p-[3px]">
      <span className="ps-2 pe-1 text-[13px] font-medium text-muted">{label}</span>
      {options.map((o) => {
        const on = values.includes(o.value);
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(options.filter((x) => (x.value === o.value ? !on : values.includes(x.value))).map((x) => x.value))}
            className={`h-full min-w-8 rounded-[7px] px-2 text-[13px] font-medium tabular transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.96] ${
              on ? "bg-fg text-bg" : "text-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Labeled select. On fine pointers it opens a custom listbox anchored under the trigger
 * (the native macOS menu pops up over the control instead); touch devices keep the
 * native picker, which is the better experience there.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  className = "",
  align = "start",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
  className?: string;
  /** Which edge of the trigger the menu lines up with. */
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const openMenu = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const choose = (i: number) => {
    const o = options[i];
    if (o) onChange(o.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    const last = options.length - 1;
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive((i) => Math.min(last, i + 1)),
      ArrowUp: () => setActive((i) => Math.max(0, i - 1)),
      Home: () => setActive(0),
      End: () => setActive(last),
      Enter: () => choose(active),
      " ": () => choose(active),
      Escape: () => setOpen(false),
      Tab: () => setOpen(false),
    };
    const run = keys[e.key];
    if (!run) return;
    if (e.key !== "Tab") e.preventDefault();
    run();
  };

  return (
    <div
      ref={rootRef}
      className={`relative inline-flex h-9 min-w-0 shrink-0 items-center rounded-[10px] border bg-surface ps-3 pe-8 text-[13px] font-medium text-fg transition-colors hover:border-border-strong focus-within:border-accent ${
        open ? "border-border-strong" : "border-border"
      } ${className}`}
    >
      <span className="me-1.5 shrink-0 text-muted">{label}</span>
      <span className="pointer-events-none min-w-0 truncate">{current?.label}</span>
      <svg
        className={`pointer-events-none absolute end-2.5 size-3.5 text-muted transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ${open ? "rotate-180" : ""}`}
        viewBox="0 0 16 16"
        fill="none"
      >
        <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      {/* Touch: native picker. */}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="absolute inset-0 cursor-pointer opacity-0 pointer-fine:hidden"
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {/* Mouse/trackpad: custom listbox under the trigger. */}
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={`${label}: ${current?.label ?? ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className="absolute inset-0 hidden cursor-pointer rounded-[10px] outline-none pointer-fine:block"
      />
      <AnimatePresence>
        {open && (
          <motion.ul
            id={listId}
            role="listbox"
            aria-label={label}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
            style={{ transformOrigin: "top" }}
            className={`absolute top-[calc(100%+6px)] z-50 min-w-full max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface p-1 shadow-[var(--shadow-lift)] ${
              align === "end" ? "end-0" : "start-0"
            }`}
          >
            {options.map((o, i) => {
              const selected = o.value === value;
              return (
                <li
                  key={o.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={selected}
                  onPointerEnter={() => setActive(i)}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => choose(i)}
                  className={`flex h-8 cursor-pointer items-center justify-between gap-4 whitespace-nowrap rounded-lg px-2.5 text-[13px] ${
                    i === active ? "bg-surface-2 text-fg" : "text-muted"
                  } ${selected ? "font-semibold text-fg" : "font-medium"}`}
                >
                  {o.label}
                  {selected && (
                    <svg className="size-3.5 text-accent" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-2 text-[13px] font-medium text-muted transition-[color,scale] duration-150 hover:text-fg active:scale-[0.97]"
    >
      {/* Track: 30×18 with 2px padding, so the 14px knob travels exactly 12px. */}
      <span
        className={`flex h-[18px] w-[30px] shrink-0 items-center rounded-full p-[2px] transition-colors duration-200 ease-out ${on ? "bg-accent" : "bg-border-strong"}`}
      >
        <span
          className={`size-[14px] shrink-0 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.2)] transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ${
            on ? "translate-x-[12px] rtl:-translate-x-[12px]" : "translate-x-0"
          }`}
        />
      </span>
      <span className={`whitespace-nowrap ${on ? "text-fg" : ""}`}>{children}</span>
    </button>
  );
}
