import { ECDH } from "node:crypto";
import webpush from "web-push";
import type { pushSubscriptions } from "../db/schema";

export function pushConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

// Subscription endpoints are used for outbound requests: only known push services are allowed.
export function validPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    const host = url.hostname;
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && !url.port && (
      host === "fcm.googleapis.com" || host === "android.googleapis.com" ||
      host === "updates.push.services.mozilla.com" || host === "web.push.apple.com" ||
      host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com")
    );
  } catch { return false; }
}

export function parsePushSubscription(value: unknown): webpush.PushSubscription {
  if (!value || typeof value !== "object") throw new Error("invalid subscription");
  const sub = value as Partial<webpush.PushSubscription>;
  if (!validPushEndpoint(sub.endpoint) || !sub.keys) throw new Error("invalid endpoint");
  const { p256dh, auth } = sub.keys;
  if (typeof p256dh !== "string" || typeof auth !== "string" ||
      !/^[A-Za-z0-9_-]{87}=?$/.test(p256dh) || !/^[A-Za-z0-9_-]{22}(==)?$/.test(auth)) {
    throw new Error("invalid keys");
  }
  const publicKey = Buffer.from(p256dh, "base64url");
  if (publicKey.length !== 65 || Buffer.from(auth, "base64url").length !== 16) throw new Error("invalid keys");
  ECDH.convertKey(publicKey, "prime256v1"); // Reject points outside the curve.
  return { endpoint: sub.endpoint, keys: { p256dh, auth } };
}

export async function sendDevicePush(
  sub: typeof pushSubscriptions.$inferSelect,
  payload: { title: string; body: string; tag?: string },
): Promise<"sent" | "expired"> {
  if (!pushConfigured()) throw new Error("push is not configured");
  // Validate persisted endpoints too, before making any network request.
  const subscription = parsePushSubscription({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } });
  try {
    await webpush.sendNotification(subscription, JSON.stringify({ ...payload, url: "/" }), {
      vapidDetails: {
        subject: process.env.VAPID_SUBJECT!,
        publicKey: process.env.VAPID_PUBLIC_KEY!,
        privateKey: process.env.VAPID_PRIVATE_KEY!,
      },
      TTL: 86400,
      timeout: 10000,
    });
    return "sent";
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      return "expired";
    }
    // Do not log endpoints, keys, or provider response bodies.
    throw new Error(`push delivery failed${status ? ` (${status})` : ""}`);
  }
}
