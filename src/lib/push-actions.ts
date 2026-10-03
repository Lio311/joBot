"use server";

import { eq } from "drizzle-orm";
import { requireAuth } from "./auth";
import { getDb } from "../db/client";
import { pushSubscriptions } from "../db/schema";
import { parsePushSubscription, pushConfigured, sendDevicePush, validPushEndpoint } from "./push";

export async function devicePushStatus(endpoint: string) {
  await requireAuth();
  if (!validPushEndpoint(endpoint)) return false;
  const rows = await getDb().select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  return rows.length > 0;
}

export async function subscribeDevice(value: unknown) {
  await requireAuth();
  try {
    if (!pushConfigured()) return { ok: false, error: "התראות עדיין לא הוגדרו בשרת." };
    const sub = parsePushSubscription(value);
    await getDb().insert(pushSubscriptions).values({ endpoint: sub.endpoint, ...sub.keys })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: sub.keys });
    return { ok: true };
  } catch {
    return { ok: false, error: "לא הצלחנו לשמור את ההרשמה. נסה שוב." };
  }
}

export async function unsubscribeDevice(endpoint: string) {
  await requireAuth();
  try {
    if (!validPushEndpoint(endpoint)) return { ok: false, error: "הרשמה לא תקינה." };
    await getDb().delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    return { ok: true };
  } catch {
    return { ok: false, error: "לא הצלחנו לכבות את ההתראות. נסה שוב." };
  }
}

export async function testDevicePush(endpoint: string) {
  await requireAuth();
  try {
    if (!validPushEndpoint(endpoint)) return { ok: false, error: "הרשמה לא תקינה." };
    const [sub] = await getDb().select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    if (!sub) return { ok: false, error: "יש להפעיל התראות במכשיר הזה תחילה." };
    const result = await sendDevicePush(sub, { title: "joBot · התראות פעילות", body: "כאן יופיעו משרות חדשות שמתאימות לך.", tag: "jobot-test" });
    if (result === "expired") await getDb().delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
    return result === "sent" ? { ok: true } : { ok: false, error: "ההרשמה פגה. כבה והפעל שוב את ההתראות." };
  } catch {
    return { ok: false, error: "שליחת הבדיקה נכשלה. נסה שוב מאוחר יותר." };
  }
}
