import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./logo";

type Tone = "success" | "neutral" | "warning";

const ICON: Record<Tone, ReactNode> = {
  success: <path d="m6.5 12.5 3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  neutral: (
    <>
      <rect x="4" y="6" width="16" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="m4.8 7.5 7.2 5.3 7.2-5.3" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </>
  ),
  warning: (
    <>
      <path d="M12 7.5v5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="16.5" r="1.2" fill="currentColor" />
    </>
  ),
};

const ICON_STYLE: Record<Tone, string> = {
  success: "bg-accent-soft text-accent",
  neutral: "bg-surface-2 text-muted",
  warning: "bg-[#fdf3e2] text-[#b45309] dark:bg-[#2b2111] dark:text-[#f0b45b]",
};

/** Small branded page for one-off outcomes (confirm, unsubscribe): logo, a card, a way back. */
export function NoticePage({
  tone,
  title,
  children,
  actions,
  secondary = false,
}: {
  tone: Tone;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  /** Render "Browse listings" as a quiet outline button, when `actions` holds the primary one. */
  secondary?: boolean;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border/80">
        <div className="mx-auto flex h-14 max-w-[1320px] items-center px-4 sm:px-6">
          <Link href="/" aria-label="diraBot home" className="transition-opacity hover:opacity-80">
            <Logo />
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-24 pt-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-[440px] rounded-2xl border border-border bg-surface p-7 shadow-[var(--shadow-card)] sm:p-8">
          <div className={`grid size-11 place-items-center rounded-full ${ICON_STYLE[tone]}`}>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden>
              {ICON[tone]}
            </svg>
          </div>
          <h1 className="mt-5 text-[22px] font-semibold leading-tight tracking-[-0.025em] text-balance">{title}</h1>
          <div className="mt-2 text-[14px] leading-relaxed text-muted">{children}</div>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            {actions}
            <Link
              href="/"
              className={`inline-flex h-10 items-center rounded-full px-4 text-[13px] transition-[border-color,scale,opacity] duration-150 active:scale-[0.97] ${
                secondary
                  ? "border border-border bg-surface font-medium text-fg hover:border-border-strong"
                  : "bg-fg font-semibold text-bg hover:opacity-90"
              }`}
            >
              Browse listings
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
