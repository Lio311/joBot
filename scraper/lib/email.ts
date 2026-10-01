import type { Job } from "../../src/db/schema";
import { sourceName } from "../../src/lib/config";
import { getMailer } from "../../src/lib/mailer";

const MAX_ROWS = 30;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Score pill colours: strong / good / partial. */
function tone(score: number) {
  if (score >= 80) return { bg: "#e6f4ef", fg: "#0b6b4f" };
  if (score >= 65) return { bg: "#e9f0fd", fg: "#1f4fb4" };
  return { bg: "#f3f1ec", fg: "#57534e" };
}

function row(j: Job) {
  const t = tone(j.score ?? 0);
  const facts = [j.company, j.location, j.workModel === "remote" ? "מהבית" : j.workModel === "hybrid" ? "היברידי" : null].filter(Boolean).join(" · ");
  const chips = (j.match?.matched ?? []).slice(0, 4).map((m) => `<span style="display:inline-block;margin:4px 4px 0 0;padding:2px 8px;border-radius:999px;background:#f3f1ec;color:#57534e;font-size:11px">${esc(m)}</span>`).join("");
  return `
  <tr><td style="padding:16px 0;border-bottom:1px solid #ecebe8">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:top;width:52px">
        <div style="width:44px;height:44px;border-radius:12px;background:${t.bg};color:${t.fg};font-size:16px;font-weight:700;text-align:center;line-height:44px;font-variant-numeric:tabular-nums">${j.score ?? "–"}</div>
      </td>
      <td style="vertical-align:top;padding:0 12px">
        <div dir="auto" style="font-size:16px;font-weight:650;color:#1c1b19;line-height:1.35">${esc(j.title)}</div>
        <div dir="auto" style="font-size:13px;color:#57534e;margin-top:3px">${esc(facts)}</div>
        ${j.match?.reason ? `<div dir="rtl" style="font-size:13px;color:#1c1b19;margin-top:6px;text-align:right">${esc(j.match.reason)}</div>` : ""}
        ${chips ? `<div dir="rtl" style="text-align:right">${chips}</div>` : ""}
        <div style="font-size:11px;color:#a19c93;margin-top:6px">${esc(sourceName(j.source))}</div>
      </td>
      <td style="vertical-align:middle;width:84px;text-align:left">
        <a href="${esc(j.url)}" style="display:inline-block;padding:8px 14px;border-radius:8px;background:#1c1b19;color:#fff;font-size:13px;text-decoration:none">למשרה</a>
      </td>
    </tr></table>
  </td></tr>`;
}

export function renderEmail(fresh: Job[], runNotes: string[]) {
  const sorted = [...fresh].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const shown = sorted.slice(0, MAX_ROWS);
  const dashboard = process.env.DASHBOARD_URL ?? "";
  const strong = fresh.filter((j) => (j.score ?? 0) >= 80).length;

  const html = `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;background:#f7f6f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Heebo,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" dir="rtl" style="max-width:600px;width:100%;background:#fff;border-radius:16px;border:1px solid #ecebe8">
      <tr><td style="padding:28px 28px 8px;text-align:right">
        <div dir="ltr" style="font-size:15px;font-weight:700;color:#1c1b19;letter-spacing:-.01em;text-align:right">jo<span style="color:#0f766e">Bot</span></div>
        <div style="font-size:24px;font-weight:650;color:#1c1b19;margin-top:18px;letter-spacing:-.02em">${fresh.length === 1 ? "משרה חדשה אחת" : `${fresh.length} משרות חדשות`} שמתאימות לך</div>
        <div style="font-size:13px;color:#8a8780;margin-top:4px">${strong ? `${strong} עם התאמה גבוהה (80+) · ` : ""}ממוינות לפי ציון התאמה</div>
      </td></tr>
      <tr><td style="padding:0 28px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl">${shown.map(row).join("")}</table>
        ${sorted.length > MAX_ROWS ? `<p style="font-size:13px;color:#57534e;margin:16px 0 0">ועוד ${sorted.length - MAX_ROWS} בדשבורד.</p>` : ""}
      </td></tr>
      <tr><td style="padding:24px 28px 28px;text-align:right">
        ${dashboard ? `<a href="${esc(dashboard)}" style="font-size:13px;color:#0f766e;text-decoration:none;font-weight:600">לכל המשרות בדשבורד ←</a>` : ""}
        ${runNotes.length ? `<div dir="ltr" style="font-size:11px;color:#a8a29e;margin-top:14px;text-align:left">Run notes: ${esc(runNotes.slice(0, 6).join(" · "))}</div>` : ""}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  const top = sorted[0];
  const subject = `joBot · ${fresh.length} משרות חדשות${top ? ` · הכי מתאימה: ${top.title}${top.company ? ` @ ${top.company}` : ""} (${top.score})` : ""}`;
  return { subject, html };
}

export async function sendEmail(subject: string, html: string) {
  const mailer = getMailer();
  if (!mailer) throw new Error("SMTP_USER / SMTP_PASS not set");
  const to = process.env.NOTIFY_TO ?? process.env.SMTP_USER ?? "owner@localhost";
  const info = await mailer.transport.sendMail({ from: mailer.from, to, subject, html });
  if (mailer.mode === "log") console.log(`[mail:log] → ${to}: ${subject} (${String(info.message ?? "").length} bytes)`);
}
