// Nodemailer transport shared by the scraper (digest) and the dashboard (confirmation emails).
// No "server-only" here: the scraper imports this from plain Node.

import nodemailer, { type Transporter } from "nodemailer";

export interface Mailer {
  transport: Transporter;
  from: string;
  /** "log" prints messages to the console instead of sending them (local development). */
  mode: "smtp" | "log";
}

export const smtpConfigured = () => !!(process.env.SMTP_USER && process.env.SMTP_PASS);

/**
 * Gmail SMTP when SMTP_USER / SMTP_PASS are set. Otherwise, if `allowLog` (or MAIL_LOG=1),
 * a JSON transport whose messages the caller logs; else null, meaning email isn't available.
 */
export function getMailer({ allowLog = false, pool = false }: { allowLog?: boolean; pool?: boolean } = {}): Mailer | null {
  const { SMTP_USER, SMTP_PASS } = process.env;
  if (SMTP_USER && SMTP_PASS) {
    const options = {
      host: process.env.SMTP_HOST ?? "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT ?? 465),
      secure: true,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    };
    return {
      transport: pool ? nodemailer.createTransport({ ...options, pool: true, maxConnections: 1 }) : nodemailer.createTransport(options),
      from: `diraBot <${SMTP_USER}>`,
      mode: "smtp",
    };
  }
  if (allowLog || process.env.MAIL_LOG === "1") {
    return { transport: nodemailer.createTransport({ jsonTransport: true }), from: "diraBot <dev@localhost>", mode: "log" };
  }
  return null;
}

/** RFC 8058 one-click unsubscribe headers: mail clients POST to `url`. */
export function unsubscribeHeaders(url: string) {
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

/** Links that land in emails: the confirm and unsubscribe pages, and the one-click POST endpoint. */
export function subscriptionLinks(baseUrl: string, token: string) {
  const base = baseUrl.replace(/\/+$/, "");
  const t = encodeURIComponent(token);
  return {
    confirm: `${base}/subscribe/confirm?token=${t}`,
    unsubscribe: `${base}/unsubscribe?token=${t}`,
    oneClick: `${base}/unsubscribe/one-click?token=${t}`,
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
