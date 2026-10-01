import { eq } from "drizzle-orm";
import type { getDb } from "../../src/db/client";
import { subscribers, type Listing } from "../../src/db/schema";
import { getMailer, sleep, subscriptionLinks, unsubscribeHeaders } from "../../src/lib/mailer";
import type { City } from "../../src/lib/config";
import { renderEmail } from "./email";
import type { PriceChange } from "./store";

type Db = ReturnType<typeof getDb>;

/** Gap between messages; Gmail throttles bursts and caps daily volume. */
const DELAY_MS = Number(process.env.SUBSCRIBER_DELAY_MS ?? 1500);

/**
 * Sends the digest to every active subscriber, one message each (no shared To/Cc), each with its own
 * unsubscribe footer and List-Unsubscribe headers. Sequential with a small delay. Never throws:
 * the owner's digest already went out, so a subscriber failure must not block marking listings notified.
 */
export async function sendToSubscribers(
  db: Db,
  fresh: Listing[],
  drops: PriceChange[],
  log: (...m: unknown[]) => void,
  cities?: readonly City[],
  rises: PriceChange[] = [],
) {
  try {
    const active = await db.select().from(subscribers).where(eq(subscribers.status, "active"));
    if (!active.length) return;

    const base = process.env.DASHBOARD_URL;
    if (!base) {
      log(`subscribers: ${active.length} active but DASHBOARD_URL is not set (needed for unsubscribe links); skipped`);
      return;
    }
    const mailer = getMailer({ pool: true });
    if (!mailer) {
      log("subscribers: SMTP not configured; skipped");
      return;
    }

    // The owner's addresses already got their copy.
    const owner = new Set((process.env.NOTIFY_TO ?? process.env.SMTP_USER ?? "").split(",").map((a) => a.trim().toLowerCase()));
    let sent = 0;
    let failed = 0;
    for (const s of active) {
      if (owner.has(s.email)) continue;
      const keep = (l: Listing) => s.minPriority == null || l.priority <= s.minPriority;
      const theirFresh = fresh.filter(keep);
      const theirDrops = drops.filter((d) => keep(d.listing));
      const theirRises = rises.filter((d) => keep(d.listing));
      if (!theirFresh.length && !theirDrops.length && !theirRises.length) continue;

      const links = subscriptionLinks(base, s.token);
      const { subject, html } = renderEmail(theirFresh, theirDrops, [], { unsubscribeUrl: links.unsubscribe, cities, rises: theirRises });
      if (sent + failed > 0) await sleep(DELAY_MS);
      try {
        await mailer.transport.sendMail({ from: mailer.from, to: s.email, subject, html, headers: unsubscribeHeaders(links.oneClick) });
        sent++;
        if (mailer.mode === "log") log(`[mail:log] subscriber digest → ${s.email}: ${subject} · unsubscribe ${links.unsubscribe} · one-click ${links.oneClick}`);
      } catch (e) {
        failed++;
        log(`subscribers: send to #${s.id} failed: ${(e as Error).message}`);
      }
    }
    mailer.transport.close();
    log(`subscribers: ${sent} sent${failed ? `, ${failed} failed` : ""}`);
  } catch (e) {
    log(`subscribers: not sent: ${(e as Error).message}`);
  }
}
