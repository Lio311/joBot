// Nodemailer transport for the digest email.
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
      from: `joBot <${SMTP_USER}>`,
      mode: "smtp",
    };
  }
  if (allowLog || process.env.MAIL_LOG === "1") {
    return { transport: nodemailer.createTransport({ jsonTransport: true }), from: "joBot <dev@localhost>", mode: "log" };
  }
  return null;
}
