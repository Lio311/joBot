"use client";

import { useActionState } from "react";
import { NoticePage } from "@/components/notice-page";
import { resubscribeByToken, unsubscribeByToken } from "../subscribe/actions";

type State = { subscribed: boolean; changed: boolean; error?: string };

/**
 * The unsubscribe page's card. Nothing changes until the button is pressed: mail scanners pre-open
 * links, so a GET must stay read-only. After unsubscribing, offers Undo (confirmed addresses only).
 */
export function UnsubscribeFlow({ token, who, subscribed, canUndo }: { token: string; who: string; subscribed: boolean; canUndo: boolean }) {
  const [state, dispatch, pending] = useActionState<State, FormData>(
    async (prev, form) => {
      const unsub = form.get("intent") === "unsubscribe";
      const { ok } = await (unsub ? unsubscribeByToken(token) : resubscribeByToken(token));
      return ok ? { subscribed: !unsub, changed: true } : { ...prev, error: "That didn't work. Please try again." };
    },
    { subscribed, changed: false },
  );

  const address = <span className="font-medium text-fg">{who}</span>;
  const button = (intent: "unsubscribe" | "undo", label: string, busy: string, primary: boolean) => (
    <form action={dispatch}>
      <input type="hidden" name="intent" value={intent} />
      <button
        disabled={pending}
        className={`inline-flex h-10 items-center rounded-full px-4 text-[13px] font-semibold transition-[border-color,scale,opacity] duration-150 active:scale-[0.97] disabled:cursor-wait disabled:opacity-60 ${
          primary ? "bg-fg text-bg hover:opacity-90" : "border border-border bg-surface font-medium text-fg hover:border-border-strong"
        }`}
      >
        {pending ? busy : label}
      </button>
    </form>
  );
  const error = state.error && (
    <p role="alert" className="mt-3 text-[13px] text-[#dc2626] dark:text-[#f87171]">
      {state.error}
    </p>
  );

  if (state.subscribed && !state.changed) {
    return (
      <NoticePage tone="neutral" title="Unsubscribe from diraBot alerts?" actions={button("unsubscribe", "Unsubscribe", "Unsubscribing…", true)} secondary>
        {address} will stop getting new listings and price drops by email.
        {error}
      </NoticePage>
    );
  }
  if (state.subscribed) {
    return (
      <NoticePage tone="success" title="You're subscribed again">
        <span role="status">
          Alerts will keep reaching {address} after each run.
        </span>
      </NoticePage>
    );
  }
  return (
    <NoticePage tone="neutral" title="You're unsubscribed" actions={canUndo ? button("undo", "Undo", "Resubscribing…", false) : undefined}>
      <span role="status">{address} won&apos;t get diraBot alerts anymore.</span>
      {error}
    </NoticePage>
  );
}
