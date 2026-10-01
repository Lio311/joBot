import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { subscribers } from "@/db/schema";
import { getMailer, subscriptionLinks, type Mailer } from "@/lib/mailer";

/** Don't resend a confirmation to the same address more often than this. */
const RESEND_AFTER_MS = 10 * 60_000;
/** Ceiling on confirmation emails across all addresses, to protect the Gmail quota from scripted sign-ups. */
const MAX_CONFIRMS_PER_HOUR = 40;

export type SubscribeResult =
  | { status: "ok" }
  | { status: "invalid"; message: string }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

const UNAVAILABLE: SubscribeResult = { status: "unavailable", message: "Email alerts aren't available yet. Check back soon." };

/** Trimmed + lowercased address, or null when it doesn't look like one. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254) return null;
  // Pragmatic check: one @, no spaces, a dotted domain with a 2+ letter TLD.
  if (!/^[^\s@"<>()[\]\\,;:]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(email)) return null;
  if (email.split("@")[0].length > 64) return null;
  return email;
}

const newToken = () => randomBytes(24).toString("base64url");

/** True for Postgres "relation does not exist", i.e. the migration hasn't been applied yet. */
const missingTable = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "42P01" || err?.cause?.code === "42P01";
};

/**
 * Double opt-in sign-up. Responds the same way whether or not the address is already known:
 * a confirmation goes out for new, pending or unsubscribed addresses (at most once per 10 minutes),
 * and nothing is sent for active ones.
 */
export async function requestSubscription(rawEmail: unknown, baseUrl: string, minPriority: number | null = null): Promise<SubscribeResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { status: "invalid", message: "Enter a valid email address." };

  // Production without SMTP: say so instead of failing. Locally, messages are logged to the console.
  const mailer = getMailer({ allowLog: process.env.NODE_ENV !== "production" });
  if (!mailer) return UNAVAILABLE;

  try {
    const db = getDb();
    const hourAgo = new Date(Date.now() - 3_600_000);
    const [{ recent }] = await db
      .select({ recent: sql<number>`count(*)::int` })
      .from(subscribers)
      .where(gt(subscribers.confirmSentAt, hourAgo));
    if (recent >= MAX_CONFIRMS_PER_HOUR) return { status: "error", message: "Lots of sign-ups right now. Please try again in a few minutes." };

    const now = new Date();
    // New address: insert. Known address: claim the right to send atomically, so two quick submits send once.
    let [row] = await db
      .insert(subscribers)
      .values({ email, token: newToken(), status: "pending", minPriority, confirmSentAt: now })
      .onConflictDoNothing({ target: subscribers.email })
      .returning({ id: subscribers.id, token: subscribers.token });
    if (!row) {
      const cutoff = new Date(now.getTime() - RESEND_AFTER_MS);
      [row] = await db
        .update(subscribers)
        .set({ status: "pending", minPriority, confirmSentAt: now })
        .where(
          and(
            eq(subscribers.email, email),
            ne(subscribers.status, "active"),
            or(isNull(subscribers.confirmSentAt), lt(subscribers.confirmSentAt, cutoff)),
          ),
        )
        .returning({ id: subscribers.id, token: subscribers.token });
    }
    // Active, or asked again within 10 minutes: same answer, no email.
    if (!row) return { status: "ok" };

    try {
      await sendConfirmation(mailer, email, subscriptionLinks(baseUrl, row.token).confirm);
    } catch (e) {
      console.error("subscribe: confirmation email failed", (e as Error).message);
      // Let them retry right away rather than wait out the rate limit.
      await db.update(subscribers).set({ confirmSentAt: null }).where(eq(subscribers.id, row.id));
      return { status: "error", message: "We couldn't send the confirmation email. Please try again later." };
    }
    return { status: "ok" };
  } catch (e) {
    if (missingTable(e)) return UNAVAILABLE;
    console.error("subscribe failed", e);
    return { status: "error", message: "Something went wrong. Please try again." };
  }
}

export type TokenOutcome = "confirmed" | "already-active" | "unsubscribed" | "already-unsubscribed" | "resubscribed" | "invalid";

const validToken = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(t);

async function byToken(token: unknown) {
  if (!validToken(token)) return null;
  const [s] = await getDb().select().from(subscribers).where(eq(subscribers.token, token)).limit(1);
  return s ?? null;
}

/** Read-only lookup for the /unsubscribe page, which must not change anything on GET (link scanners pre-open links). */
export async function subscriptionByToken(token: unknown) {
  const s = await byToken(token);
  return s ? { email: s.email, status: s.status, confirmed: !!s.confirmedAt } : null;
}

/** /subscribe/confirm: pending → active. An unsubscribed address has to sign up again. */
export async function confirmSubscription(token: unknown): Promise<{ outcome: TokenOutcome; email?: string }> {
  const s = await byToken(token);
  if (!s) return { outcome: "invalid" };
  if (s.status === "active") return { outcome: "already-active", email: s.email };
  if (s.status === "unsubscribed") return { outcome: "already-unsubscribed", email: s.email };
  await getDb()
    .update(subscribers)
    .set({ status: "active", confirmedAt: new Date(), unsubscribedAt: null })
    .where(and(eq(subscribers.id, s.id), eq(subscribers.status, "pending")));
  return { outcome: "confirmed", email: s.email };
}

/** The /unsubscribe page's button and the List-Unsubscribe one-click POST. Idempotent. */
export async function unsubscribe(token: unknown): Promise<{ outcome: TokenOutcome; email?: string }> {
  const s = await byToken(token);
  if (!s) return { outcome: "invalid" };
  if (s.status === "unsubscribed") return { outcome: "already-unsubscribed", email: s.email };
  await getDb().update(subscribers).set({ status: "unsubscribed", unsubscribedAt: new Date() }).where(eq(subscribers.id, s.id));
  return { outcome: "unsubscribed", email: s.email };
}

/** "Undo" on the unsubscribe page. Holding the token proves the mailbox, so no new confirmation is needed. */
export async function resubscribe(token: unknown): Promise<{ outcome: TokenOutcome }> {
  const s = await byToken(token);
  if (!s || !s.confirmedAt) return { outcome: "invalid" };
  await getDb().update(subscribers).set({ status: "active", unsubscribedAt: null }).where(eq(subscribers.id, s.id));
  return { outcome: "resubscribed" };
}

/** Partially hides an address for display: "li***@gmail.com". */
export function maskEmail(email: string) {
  const [user, domain] = email.split("@");
  return `${user.slice(0, Math.min(2, Math.max(1, user.length - 1)))}***@${domain}`;
}

async function sendConfirmation(mailer: Mailer, to: string, link: string) {
  const subject = "Confirm your diraBot alerts";
  const html = `<!doctype html><html><body style="margin:0;background:#f7f6f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#fff;border-radius:16px;border:1px solid #ecebe8">
      <tr><td style="padding:28px">
        <div style="font-size:15px;font-weight:700;color:#1c1b19;letter-spacing:-.01em">dira<span style="color:#0f766e">Bot</span></div>
        <div style="font-size:22px;font-weight:650;color:#1c1b19;margin-top:18px;letter-spacing:-.02em">Confirm your email</div>
        <p style="font-size:14px;line-height:1.55;color:#57534e;margin:8px 0 0">Tap the button to start getting new 4–5 room listings by email, at most every 8 hours when something new turns up.</p>
        <p style="margin:22px 0 0"><a href="${link.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" style="display:inline-block;padding:11px 18px;border-radius:10px;background:#1c1b19;color:#fff;font-size:14px;font-weight:600;text-decoration:none">Confirm subscription</a></p>
        <p style="font-size:12px;line-height:1.5;color:#a8a29e;margin:22px 0 0">If you didn't ask for this, ignore this email and nothing will be sent.</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
  const text = `Confirm your diraBot alerts:\n${link}\n\nIf you didn't ask for this, ignore this email and nothing will be sent.`;
  await mailer.transport.sendMail({ from: mailer.from, to, subject, html, text });
  if (mailer.mode === "log") console.log(`[mail:log] confirmation → ${to}: ${link}`);
}
