"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="mt-5 space-y-3">
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="text-[13px] font-medium text-muted">קוד גישה</span>
        <input
          name="passcode"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          dir="ltr"
          style={{ textAlign: "right" }}
          className="mt-1.5 h-11 w-full rounded-xl border border-border bg-bg px-3 text-[15px] outline-none transition-colors focus:border-accent"
        />
      </label>
      {state?.error && <p className="text-[13px] text-danger">{state.error}</p>}
      <button
        disabled={pending}
        className="h-11 w-full rounded-xl bg-fg text-[14px] font-semibold text-bg transition-[opacity,transform] active:scale-[0.98] disabled:opacity-60"
      >
        {pending ? "בודק…" : "כניסה"}
      </button>
    </form>
  );
}
