"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";

/** Free-text list editor: type and press Enter (or comma) to add; click × to remove. Suggestions are one tap away. */
export function TagInput({
  value,
  onChange,
  placeholder,
  suggestions = [],
  max = 40,
  ltr = false,
  validate,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  suggestions?: readonly string[];
  max?: number;
  /** Content is mostly English (titles, technologies, URLs). */
  ltr?: boolean;
  /** Returns an error message for an invalid entry. */
  validate?: (s: string) => string | null;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const lower = value.map((v) => v.toLowerCase());

  const add = (raw: string) => {
    const items = raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const next = [...value];
    for (const s of items) {
      const bad = validate?.(s);
      if (bad) {
        setError(bad);
        return;
      }
      if (!next.some((v) => v.toLowerCase() === s.toLowerCase()) && next.length < max) next.push(s);
    }
    setError(null);
    onChange(next);
    setDraft("");
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === ",") && draft.trim()) {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  const shownSuggestions = useMemo(() => {
    const d = draft.trim().toLowerCase();
    return suggestions.filter((s) => !lower.includes(s.toLowerCase()) && (!d || s.toLowerCase().includes(d))).slice(0, d ? 8 : 12);
  }, [suggestions, lower, draft]);

  return (
    <div>
      <div
        className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface p-1.5 transition-colors focus-within:border-accent"
        onClick={() => document.getElementById(id)?.focus()}
      >
        {value.map((v) => (
          <span key={v} dir="auto" className="inline-flex h-7 max-w-full items-center gap-1 rounded-lg bg-surface-2 ps-2.5 pe-1 text-[13px] font-medium text-fg">
            <span className="truncate">{v}</span>
            <button
              type="button"
              aria-label={`הסר ${v}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((x) => x !== v));
              }}
              className="flex size-5 items-center justify-center rounded-md text-muted hover:bg-border hover:text-fg"
            >
              <svg viewBox="0 0 12 12" className="size-2.5" fill="none" aria-hidden>
                <path d="m3 3 6 6m0-6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          dir={ltr ? "ltr" : "auto"}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={onKey}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={value.length ? "" : placeholder}
          className="h-7 min-w-[8rem] flex-1 bg-transparent px-1.5 text-[14px] outline-none placeholder:text-faint"
        />
      </div>
      {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
      {shownSuggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {shownSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              dir="auto"
              onClick={() => add(s)}
              className="h-7 rounded-lg border border-dashed border-border-strong px-2.5 text-[12px] font-medium text-muted transition-colors hover:border-accent hover:text-accent"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
