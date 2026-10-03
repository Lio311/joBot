"use client";

import { startTransition, useEffect, useState } from "react";
import { devicePushStatus, subscribeDevice, testDevicePush, unsubscribeDevice } from "@/lib/push-actions";

function applicationKey(key: string) {
  const raw = atob(key.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(key.length / 4) * 4, "="));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function PushNotifications({ publicKey }: { publicKey: string | null }) {
  const [status, setStatus] = useState<"loading" | "unsupported" | "install" | "ready" | "denied">("loading");
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

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
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-card)] sm:p-6">
      <h2 className="text-[17px] font-semibold">התראות למכשיר</h2>
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
    </section>
  );
}
