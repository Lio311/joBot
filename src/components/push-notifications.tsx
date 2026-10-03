"use client";

import { startTransition, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { devicePushStatus, subscribeDevice, testDevicePush, unsubscribeDevice } from "@/lib/push-actions";

function applicationKey(key: string) {
  const raw = atob(key.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(key.length / 4) * 4, "="));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function PushNotifications({ publicKey }: { publicKey: string | null }) {
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState(16);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [status, setStatus] = useState<"loading" | "unsupported" | "install" | "ready" | "denied">("loading");
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    const panel = dialog.current;
    const button = trigger.current;
    panel?.showModal();
    const reposition = () => {
      const width = Math.min(360, window.innerWidth - 32);
      setLeft(Math.max(16, Math.min(button?.getBoundingClientRect().left ?? 16, window.innerWidth - width - 16)));
    };
    window.addEventListener("resize", reposition);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      panel?.close();
      window.removeEventListener("resize", reposition);
      document.body.style.overflow = previousOverflow;
      button?.focus();
    };
  }, [open]);

  useEffect(() => {
    let active = true;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    async function init() {
      if (ios && !standalone) { if (active) setStatus("install"); return; }
      if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (active) setStatus("unsupported"); return;
      }
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        const saved = sub ? await devicePushStatus(sub.endpoint) : false;
        if (active) {
          setRegistration(reg); setSubscription(sub); setEnabled(saved);
          setStatus(Notification.permission === "denied" ? "denied" : "ready");
        }
      } catch {
        if (active) { setStatus("ready"); setMessage("לא הצלחנו לטעון את מצב ההתראות. רענן את העמוד ונסה שוב."); }
      }
    }
    startTransition(() => { void init(); });
    return () => { active = false; };
  }, []);

  async function enable() {
    if (!registration || !publicKey) return;
    setBusy(true); setMessage("");
    let sub = subscription;
    try {
      // Request directly from the tap, before any unrelated asynchronous work (iOS requirement).
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "ready");
        setMessage("כדי לקבל התראות יש לאשר את הבקשה במכשיר."); return;
      }
      const key = applicationKey(publicKey);
      if (sub && sub.options.applicationServerKey &&
          Array.from(new Uint8Array(sub.options.applicationServerKey)).join() !== Array.from(key).join()) {
        const removed = await unsubscribeDevice(sub.endpoint);
        if (!removed.ok) throw new Error(removed.error);
        if (!(await sub.unsubscribe())) throw new Error("לא הצלחנו לעדכן את ההרשמה במכשיר.");
        sub = null; setSubscription(null); setEnabled(false);
      }
      sub ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      setSubscription(sub);
      const result = await subscribeDevice(sub.toJSON());
      if (!result.ok) throw new Error(result.error);
      setEnabled(true); setMessage("ההתראות פעילות במכשיר הזה. תקבל משרות חדשות מהסריקות הבאות.");
    } catch (error) {
      setMessage(error instanceof Error && /[א-ת]/.test(error.message) ? error.message : "לא הצלחנו להפעיל התראות. נסה שוב.");
    } finally { setBusy(false); }
  }

  async function disable() {
    if (!subscription) return;
    setBusy(true); setMessage("");
    try {
      // Remove server delivery first, so a browser unsubscribe failure cannot keep alerts active.
      const result = await unsubscribeDevice(subscription.endpoint);
      if (!result.ok) throw new Error(result.error);
      setEnabled(false);
      if (await subscription.unsubscribe()) setSubscription(null);
      setMessage("ההתראות כבויות במכשיר הזה.");
    } catch { setMessage("לא הצלחנו לכבות את ההתראות. נסה שוב."); }
    finally { setBusy(false); }
  }

  async function test() {
    if (!subscription) return;
    setBusy(true); setMessage("");
    try {
      const result = await testDevicePush(subscription.endpoint);
      setMessage(result.ok ? "התראת בדיקה נשלחה למכשיר." : result.error ?? "שליחת הבדיקה נכשלה.");
    } catch { setMessage("שליחת הבדיקה נכשלה. נסה שוב."); }
    finally { setBusy(false); }
  }

  const button = "min-h-11 rounded-xl border border-border px-4 text-[14px] font-medium disabled:opacity-50";
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={enabled ? "התראות · פעילות במכשיר הזה" : "התראות"}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="התראות"
        onClick={() => {
          const bounds = trigger.current?.getBoundingClientRect();
          const width = Math.min(360, window.innerWidth - 32);
          setLeft(Math.max(16, Math.min((bounds?.left ?? 16), window.innerWidth - width - 16)));
          setOpen(true);
        }}
        className="relative flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors hover:text-fg active:scale-[0.97]"
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 21h4" />
        </svg>
        {enabled && <span className="absolute end-2 top-2 size-2 rounded-full bg-accent ring-2 ring-surface" />}
      </button>
      {open && createPortal(
        <dialog
          ref={dialog}
          aria-labelledby={titleId}
          onClose={() => setOpen(false)}
          onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}
          style={{ left, top: 64, right: "auto", bottom: "auto" }}
          className="fixed m-0 max-h-[calc(100dvh-80px)] w-[min(360px,calc(100vw-32px))] overflow-y-auto rounded-2xl border border-border bg-surface p-0 text-fg shadow-[var(--shadow-lift)] backdrop:bg-black/25"
        >
        <div className="p-5" dir="rtl">
          <div className="flex items-center justify-between gap-3">
            <h2 id={titleId} className="text-[17px] font-semibold">התראות</h2>
            <button type="button" aria-label="סגור התראות" onClick={() => dialog.current?.close()} className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>
      <p className="mt-1 text-[13px] text-muted">התראה אחרי סריקה עם משרות חדשות שעוברות את סף ההתאמה שלך, גם כשהאתר סגור. ההפעלה נפרדת לכל מכשיר.</p>
      <div className="mt-4 space-y-3">
        {status === "loading" && <p className="text-sm text-muted">בודק תמיכה בהתראות…</p>}
        {status === "install" && <p className="text-sm text-muted">באייפון ובאייפד (iOS 16.4 ומעלה): פתח ב־Safari, לחץ על שיתוף ← הוסף למסך הבית, ואז פתח את joBot מהסמל החדש והפעל התראות כאן.</p>}
        {status === "unsupported" && <p className="text-sm text-muted">הדפדפן הזה לא תומך בהתראות כאן. נסה לפתוח את האתר ב־Chrome באנדרואיד, או ממסך הבית באייפון.</p>}
        {status === "denied" && <p className="text-sm text-muted">ההתראות חסומות. אפשר אותן בהגדרות ההתראות של המכשיר או בהגדרות האתר בדפדפן, ואז רענן.</p>}
        {!publicKey && <p className="text-sm text-muted">התראות למובייל עדיין לא הוגדרו בשרת.</p>}
        <div className="flex flex-wrap gap-2">
          {publicKey && status === "ready" && !enabled && <button type="button" disabled={busy || !registration} onClick={() => startTransition(() => { void enable(); })} className={`${button} bg-fg text-bg`}>{busy ? "מפעיל…" : "הפעל התראות במכשיר הזה"}</button>}
          {enabled && subscription && <>
            <button type="button" disabled={busy} onClick={() => startTransition(() => { void disable(); })} className={button}>כבה התראות</button>
            {publicKey && status === "ready" && <button type="button" disabled={busy} onClick={() => startTransition(() => { void test(); })} className={button}>שלח התראת בדיקה</button>}
          </>}
        </div>
        <p role="status" aria-live="polite" className="text-sm text-muted">{message || (enabled ? "פעיל במכשיר הזה" : "")}</p>
      </div>
        </div>
        </dialog>, document.body
      )}
    </>
  );
}
