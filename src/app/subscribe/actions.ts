"use server";

import { headers } from "next/headers";
import { requestSubscription, resubscribe, unsubscribe, type SubscribeResult } from "@/lib/subscriptions";

/** Where links in emails point: DASHBOARD_URL, then Vercel's production domain, then the request's host. */
async function baseUrl() {
  if (process.env.DASHBOARD_URL) return process.env.DASHBOARD_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/** Starts a double opt-in sign-up. The response never reveals whether the address was already known. */
export async function subscribe(email: string, minPriority?: number | null): Promise<SubscribeResult> {
  const priority = typeof minPriority === "number" && Number.isInteger(minPriority) && minPriority >= 1 && minPriority <= 4 ? minPriority : null;
  return requestSubscription(email, await baseUrl(), priority);
}

/** useActionState wrapper for the dashboard form. `website` is a honeypot that people never see. */
export async function subscribeFromForm(_prev: SubscribeResult | null, form: FormData): Promise<SubscribeResult> {
  if (form.get("website")) return { status: "ok" };
  return subscribe(String(form.get("email") ?? ""));
}

/** The unsubscribe page's button. Opening the page alone changes nothing. */
export async function unsubscribeByToken(token: string): Promise<{ ok: boolean }> {
  const { outcome } = await unsubscribe(token);
  return { ok: outcome !== "invalid" };
}

/** "Undo" on the unsubscribe page. */
export async function resubscribeByToken(token: string): Promise<{ ok: boolean }> {
  const { outcome } = await resubscribe(token);
  return { ok: outcome === "resubscribed" };
}
