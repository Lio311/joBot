"use client";

import { AnimatePresence, motion } from "motion/react";
import { memo, useState } from "react";
import type { JobStatus } from "@/db/schema";
import { sourceName, SOURCES, type SourceKey } from "@/lib/config";
import type { JobView } from "@/lib/data";
import { isFresh, relativeTime, scoreTone, WORK_MODEL_LABEL } from "@/lib/format";

export function ScoreRing({ score, size = 48 }: { score: number | null; size?: number }) {
  const tone = scoreTone(score);
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : score / 100;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={tone.label}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth="4" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone.ring}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          className="transition-[stroke-dasharray] duration-500 ease-out"
        />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center text-[15px] font-semibold tabular ${tone.text}`}>{score ?? "–"}</span>
    </div>
  );
}

const ACTIONS: { status: JobStatus; label: string; icon: React.ReactNode }[] = [
  {
    status: "saved",
    label: "שמור",
    icon: <path d="M5 3.5h10a.5.5 0 0 1 .5.5v12.3a.3.3 0 0 1-.48.24L10 13l-5.02 3.54a.3.3 0 0 1-.48-.24V4a.5.5 0 0 1 .5-.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />,
  },
  {
    status: "applied",
    label: "הגשתי",
    icon: <path d="m4.5 10.5 3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
  },
  {
    status: "hidden",
    label: "לא רלוונטי",
    icon: <path d="m5.5 5.5 9 9m0-9-9 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />,
  },
];

export const STATUS_LABEL: Record<JobStatus, string> = {
  new: "חדשה",
  saved: "שמורה",
  applied: "הגשתי",
  interview: "בראיון",
  rejected: "נדחתה",
  hidden: "לא רלוונטי",
};

function JobCardImpl({ job, now, onStatus }: { job: JobView; now: number; onStatus: (id: number, s: JobStatus) => void }) {
  const [open, setOpen] = useState(false);
  const m = job.match;
  const facts = [job.company, job.location, job.workModel ? WORK_MODEL_LABEL[job.workModel] : null, job.employmentType].filter(Boolean);
  const fresh = isFresh(job.firstSeenAt, now);
  const color = SOURCES[job.source as SourceKey]?.color ?? "var(--faint)";

  return (
    <article
      className={`group rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-card)] transition-[box-shadow,transform,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:shadow-[var(--shadow-lift)] sm:p-5 ${
        job.status === "hidden" || job.status === "rejected" ? "opacity-60" : ""
      }`}
    >
      <div className="flex gap-4">
        <ScoreRing score={job.score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <a href={job.url} target="_blank" rel="noopener noreferrer" className="min-w-0 text-[16px] font-semibold leading-snug tracking-[-0.01em] text-fg hover:underline sm:text-[17px]">
              <bdi>{job.title}</bdi>
            </a>
            {fresh && job.status === "new" && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">חדש</span>}
            {job.status !== "new" && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted">{STATUS_LABEL[job.status]}</span>}
          </div>
          {facts.length > 0 && (
            <p className="mt-1 line-clamp-1 text-[13px] text-muted">
              {facts.map((f, i) => (
                <span key={i}>
                  {i > 0 && <span className="mx-1.5 text-faint">·</span>}
                  <bdi>{f}</bdi>
                </span>
              ))}
            </p>
          )}
          {m?.reason && (
            <p className="mt-2.5 flex items-start gap-1.5 text-[14px] leading-relaxed text-fg">
              {m.by === "ai" && (
                <span title="נוקד על ידי AI מול קורות החיים" className="mt-[3px] shrink-0 rounded-md bg-surface-2 px-1.5 py-px text-[10px] font-semibold tracking-wide text-muted" dir="ltr">
                  AI
                </span>
              )}
              <span dir="auto">{m.reason}</span>
            </p>
          )}
          {(m?.matched.length || m?.missing.length) ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5" dir="ltr">
              {m.matched.slice(0, 6).map((s) => (
                <span key={`m-${s}`} className="rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-medium text-accent">
                  ✓ {s}
                </span>
              ))}
              {m.missing.slice(0, 4).map((s) => (
                <span key={`x-${s}`} className="rounded-full border border-dashed border-border-strong px-2 py-0.5 text-[12px] text-muted">
                  {s}
                </span>
              ))}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-faint">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full" style={{ background: color }} />
              {sourceName(job.source)}
              {job.alsoOn.length > 0 && <span>· גם ב-{job.alsoOn.map(sourceName).join(", ")}</span>}
            </span>
            <span>{relativeTime(job.postedAt ?? job.firstSeenAt, now)}</span>
            {job.description && (
              <button type="button" onClick={() => setOpen((o) => !o)} className="font-medium text-muted hover:text-fg" aria-expanded={open}>
                {open ? "הסתר תיאור" : "תיאור המשרה"}
              </button>
            )}
            <div className="ms-auto flex items-center gap-1">
              {ACTIONS.map((a) => {
                const on = job.status === a.status;
                return (
                  <button
                    key={a.status}
                    type="button"
                    onClick={() => onStatus(job.id, on ? "new" : a.status)}
                    aria-pressed={on}
                    title={a.label}
                    className={`inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-medium transition-[background-color,color,transform] active:scale-[0.95] ${
                      on ? "bg-fg text-bg" : "text-muted hover:bg-surface-2 hover:text-fg"
                    }`}
                  >
                    <svg viewBox="0 0 20 20" fill="none" className="size-4" aria-hidden>
                      {a.icon}
                    </svg>
                    <span className="hidden sm:inline">{a.label}</span>
                  </button>
                );
              })}
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1 rounded-lg bg-fg px-3 text-[12px] font-semibold text-bg transition-transform active:scale-[0.96]"
              >
                למשרה
                <svg viewBox="0 0 16 16" className="size-3.5 transition-transform group-hover:-translate-x-0.5 group-hover:-translate-y-0.5" fill="none" aria-hidden>
                  <path d="M11 5 5 11M11 5H6.5M11 5v4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" transform="scale(-1,1) translate(-16,0)" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && job.description && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            <p dir="auto" className="mt-4 max-h-80 overflow-y-auto whitespace-pre-line rounded-xl bg-surface-2 p-4 text-[13px] leading-relaxed text-muted">
              {job.description}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}

export const JobCard = memo(JobCardImpl);
