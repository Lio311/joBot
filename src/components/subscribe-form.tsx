"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useActionState, useId, useState } from "react";
import { subscribeFromForm } from "@/app/subscribe/actions";

const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];

/** "Get alerts by email": a compact double opt-in sign-up card for the dashboard hero. */
export function SubscribeForm() {
  // Bumping the key starts a fresh form ("Use another address").
  const [round, setRound] = useState(0);
  return (
    <section
      aria-labelledby="subscribe-title"
      className="mt-3 flex flex-col gap-4 rounded-2xl border border-border bg-surface px-5 py-4 shadow-[var(--shadow-card)] md:flex-row md:items-center md:justify-between md:gap-8"
    >
      <div className="flex min-w-0 items-start gap-3.5">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden>
          <svg viewBox="0 0 16 16" className="size-4" fill="none">
            <path
              d="M4 6.6a4 4 0 0 1 8 0v2.2l1.1 2a.5.5 0 0 1-.44.74H3.34a.5.5 0 0 1-.44-.74l1.1-2V6.6Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path d="M6.6 13.6a1.5 1.5 0 0 0 2.8 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
        <div className="min-w-0">
          <h2 id="subscribe-title" className="text-[14px] font-semibold tracking-[-0.01em]">
            Get alerts by email
          </h2>
          <p className="mt-0.5 text-[13px] leading-snug text-muted">New listings and price changes after each run. Unsubscribe in one click.</p>
        </div>
      </div>
      <SubscribeBody key={round} onReset={() => setRound((r) => r + 1)} />
    </section>
  );
}

function SubscribeBody({ onReset }: { onReset: () => void }) {
  const [state, action, pending] = useActionState(subscribeFromForm, null);
  const [email, setEmail] = useState("");
  const reduce = useReducedMotion();
  const inputId = useId();
  const msgId = useId();

  const done = state?.status === "ok";
  const problem = state && state.status !== "ok" ? state : null;
  const motionProps = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    exit: reduce ? { opacity: 0 } : { opacity: 0, y: -4 },
    transition: { duration: 0.2, ease: EASE },
  };

  return (
    <div className="w-full md:w-[400px] md:shrink-0">
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.div key="done" {...motionProps} role="status" className="flex min-h-10 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-accent-fg" aria-hidden>
                <svg viewBox="0 0 16 16" className="size-3.5" fill="none">
                  <path d="m4 8.5 2.6 2.6L12 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold">Check your inbox to confirm</p>
                <p className="truncate text-[12px] text-muted">
                  We sent a link to <span className="text-fg">{email.trim().toLowerCase()}</span>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onReset}
              className="shrink-0 rounded-md text-[12px] font-medium text-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
            >
              Change
            </button>
          </motion.div>
        ) : (
          <motion.form key="form" {...motionProps} action={action} noValidate>
            <div className="flex gap-2">
              <label htmlFor={inputId} className="sr-only">
                Email address
              </label>
              <input
                id={inputId}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="send"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={problem?.status === "invalid" || undefined}
                aria-describedby={problem ? msgId : undefined}
                // 16px on phones so iOS doesn't zoom the page on focus.
                className={`h-10 min-w-0 flex-1 rounded-[10px] border bg-bg px-3 text-[16px] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-faint focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] sm:text-[14px] ${
                  problem?.status === "invalid" ? "border-[#dc2626]/60" : "border-border hover:border-border-strong"
                }`}
              />
              {/* Honeypot: hidden from people and assistive tech; bots that fill every field get a silent no-op. */}
              <div aria-hidden className="absolute -left-[9999px] size-px overflow-hidden">
                <input name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
              </div>
              <button
                type="submit"
                disabled={pending}
                className="relative inline-flex h-10 shrink-0 items-center justify-center rounded-[10px] bg-fg px-4 text-[13px] font-semibold text-bg transition-[scale,opacity] duration-150 hover:opacity-90 active:scale-[0.97] disabled:cursor-wait disabled:opacity-80"
              >
                <span className={pending ? "invisible" : ""}>Subscribe</span>
                {pending && (
                  <span className="absolute inset-0 grid place-items-center" aria-label="Subscribing">
                    <svg viewBox="0 0 16 16" className="size-4 animate-spin" fill="none" aria-hidden>
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
                      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </span>
                )}
              </button>
            </div>
            <AnimatePresence initial={false}>
              {problem && (
                <motion.p
                  key={problem.message}
                  id={msgId}
                  role="alert"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18, ease: EASE }}
                  className={`overflow-hidden pt-2 text-[12px] ${
                    problem.status === "unavailable" ? "text-muted" : "text-[#dc2626] dark:text-[#f87171]"
                  }`}
                >
                  {problem.message}
                </motion.p>
              )}
            </AnimatePresence>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
