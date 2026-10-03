import { and, desc, eq, gte, isNull, notExists, sql } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { jobs, pushDeliveries, pushSubscriptions } from "../../src/db/schema";
import { aiConfigured } from "../../src/lib/ai";
import { pushConfigured, sendDevicePush } from "../../src/lib/push";

/** Retry failed devices independently; never reuse email's notifiedAt. */
export async function pushPass(db: ReturnType<typeof getDb>, minScore: number, log: (message: string) => void) {
  if (!pushConfigured()) return log("push: skipped (VAPID not configured)");
  const devices = await db.select().from(pushSubscriptions);
  for (const device of devices) {
    try {
      const since = new Date(Math.max(device.createdAt.getTime(), Date.now() - 7 * 864e5));
      const fresh = await db.select().from(jobs).where(and(
        isNull(jobs.duplicateOf), eq(jobs.status, "new"), gte(jobs.firstSeenAt, since), gte(jobs.score, minScore),
        ...(aiConfigured() ? [eq(jobs.aiScored, true)] : []),
        notExists(db.select({ one: sql`1` }).from(pushDeliveries).where(and(
          eq(pushDeliveries.subscriptionId, device.id), eq(pushDeliveries.jobId, jobs.id),
        ))),
      )).orderBy(desc(jobs.score), desc(jobs.firstSeenAt)).limit(200);
      if (!fresh.length) continue;
      const top = fresh[0];
      const result = await sendDevicePush(device, {
        title: `joBot · ${fresh.length === 1 ? "משרה חדשה שמתאימה לך" : `${fresh.length} משרות חדשות שמתאימות לך`}`,
        body: `${top.title}${top.company ? ` · ${top.company}` : ""} · התאמה ${top.score}%`.slice(0, 220),
        tag: `jobot-jobs-${device.id}-${top.id}`,
      });
      if (result === "expired") {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, device.id));
        log(`push: device ${device.id} expired, removed`); continue;
      }
      await db.insert(pushDeliveries).values(fresh.map((job) => ({ subscriptionId: device.id, jobId: job.id }))).onConflictDoNothing();
      log(`push: ${fresh.length} jobs sent to device ${device.id}`);
    } catch (error) {
      log(`push: device ${device.id} failed (${(error as Error).message})`);
    }
  }
}
