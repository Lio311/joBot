import { CITIES, cityName, PRIORITY_LABEL, SOURCES, type City, type Priority, type SourceKey } from "../../src/lib/config";
import type { Listing } from "../../src/db/schema";
import { getMailer } from "../../src/lib/mailer";
import type { PriceChange } from "./store";

const MAX_ROWS = 40;

const PRIORITY_STYLE: Record<Priority, { bg: string; fg: string }> = {
  1: { bg: "#e8f5ee", fg: "#0b6b3a" },
  2: { bg: "#e9f0fd", fg: "#1f4fb4" },
  3: { bg: "#f3effc", fg: "#5b3aa8" },
  4: { bg: "#f1f1ef", fg: "#57534e" },
};

const ils = (n: number | null) => (n == null ? "—" : `₪${n.toLocaleString("en-US")}`);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function row(l: Listing, cities: readonly City[], note?: string) {
  const p = PRIORITY_STYLE[l.priority as Priority];
  const place = [l.neighborhood, l.street].filter(Boolean).join(", ");
  const facts = [l.rooms ? `${l.rooms} rooms` : null, l.sqm ? `${l.sqm} m²` : null, l.floor != null ? `floor ${l.floor}` : null]
    .filter(Boolean)
    .join(" · ");
  return `
  <tr><td style="padding:14px 0;border-bottom:1px solid #ecebe8">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:top">
        <span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${p.bg};color:${p.fg};font-size:11px;font-weight:600;letter-spacing:.02em">${PRIORITY_LABEL[l.priority as Priority]} · ${esc(cityName(l.city, cities))}</span>
        <span style="font-size:11px;color:#8a8780;margin-left:6px">${SOURCES[l.source as SourceKey]?.name ?? l.source}</span>
        <div style="font-size:18px;font-weight:650;color:#1c1b19;margin-top:6px;font-variant-numeric:tabular-nums">${ils(l.price)}${note ? ` <span style="font-size:12px;font-weight:500;color:#0b6b3a">${note}</span>` : ""}</div>
        <div style="font-size:13px;color:#57534e;margin-top:2px">${facts}</div>
        ${place ? `<div dir="rtl" style="font-size:13px;color:#57534e;margin-top:2px;text-align:left">${esc(place)}</div>` : ""}
      </td>
      <td style="vertical-align:middle;text-align:right;width:90px">
        <a href="${esc(l.url)}" style="display:inline-block;padding:8px 14px;border-radius:8px;background:#1c1b19;color:#fff;font-size:13px;text-decoration:none">Open</a>
      </td>
    </tr></table>
  </td></tr>`;
}

/** Price increases: one compact line each, below the main list. */
function riseRow(c: PriceChange, cities: readonly City[]) {
  const l = c.listing;
  const place = [cityName(l.city, cities), l.neighborhood, l.street].filter(Boolean).join(", ");
  return `
  <tr><td style="padding:8px 0;border-bottom:1px solid #f1f0ed;font-size:13px;color:#57534e">
    <a href="${esc(l.url)}" style="color:#1c1b19;text-decoration:none;font-weight:600;font-variant-numeric:tabular-nums">${ils(l.price)}</a>
    <span style="color:#b45309;font-weight:500"> ↑ from ${ils(c.from)}</span>
    <span dir="auto" style="color:#8a8780"> · ${esc(place)}</span>
  </td></tr>`;
}

export function renderEmail(
  fresh: Listing[],
  drops: PriceChange[],
  runWarnings: string[],
  /** Subscriber copies get an unsubscribe footer; the owner's copy (NOTIFY_TO) doesn't. */
  opts: { unsubscribeUrl?: string; cities?: readonly City[]; rises?: PriceChange[] } = {},
) {
  const rises = opts.rises ?? [];
  const cities = opts.cities ?? CITIES;
  const sorted = [...fresh].sort((a, b) => a.priority - b.priority || (a.price ?? 0) - (b.price ?? 0));
  const shown = sorted.slice(0, MAX_ROWS);
  const dashboard = process.env.DASHBOARD_URL ?? "";

  const counts = ([1, 2, 3, 4] as Priority[])
    .map((p) => [p, fresh.filter((l) => l.priority === p).length] as const)
    .filter(([, n]) => n > 0)
    .map(([p, n]) => `${n} ${PRIORITY_LABEL[p].toLowerCase()}`)
    .join(" · ");

  const html = `<!doctype html><html><body style="margin:0;background:#f7f6f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;border:1px solid #ecebe8">
      <tr><td style="padding:28px 28px 8px">
        <div style="font-size:15px;font-weight:700;color:#1c1b19;letter-spacing:-.01em">dira<span style="color:#0f766e">Bot</span></div>
        <div style="font-size:24px;font-weight:650;color:#1c1b19;margin-top:18px;letter-spacing:-.02em">${fresh.length} new listing${fresh.length === 1 ? "" : "s"}${drops.length ? `, ${drops.length} price drop${drops.length === 1 ? "" : "s"}` : ""}${rises.length ? `, ${rises.length} increase${rises.length === 1 ? "" : "s"}` : ""}</div>
        <div style="font-size:13px;color:#8a8780;margin-top:4px">${counts || "No new listings this round"}</div>
      </td></tr>
      <tr><td style="padding:0 28px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${drops.map((d) => row(d.listing, cities, `↓ from ${ils(d.from)}`)).join("")}
          ${shown.map((l) => row(l, cities)).join("")}
        </table>
        ${sorted.length > MAX_ROWS ? `<p style="font-size:13px;color:#57534e;margin:16px 0 0">+${sorted.length - MAX_ROWS} more on the dashboard.</p>` : ""}
        ${
          rises.length
            ? `<div style="font-size:12px;font-weight:600;color:#8a8780;letter-spacing:.04em;text-transform:uppercase;margin:24px 0 2px">Price increases</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rises.slice(0, MAX_ROWS).map((c) => riseRow(c, cities)).join("")}</table>`
            : ""
        }
      </td></tr>
      <tr><td style="padding:24px 28px 28px">
        ${dashboard ? `<a href="${esc(dashboard)}" style="font-size:13px;color:#0f766e;text-decoration:none;font-weight:600">Open dashboard →</a>` : ""}
        ${runWarnings.length ? `<div style="font-size:11px;color:#a8a29e;margin-top:14px">Run notes: ${esc(runWarnings.slice(0, 6).join(" · "))}</div>` : ""}
        ${opts.unsubscribeUrl ? `<div style="font-size:11px;color:#a8a29e;margin-top:18px;line-height:1.5">You're getting this because you subscribed to diraBot alerts. <a href="${esc(opts.unsubscribeUrl)}" style="color:#8a8780;text-decoration:underline">Unsubscribe</a></div>` : ""}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  const top = sorted[0];
  const subject = fresh.length
    ? `diraBot · ${fresh.length} new${top ? ` · top: ${cityName(top.city, cities)} ${ils(top.price)}` : ""}`
    : drops.length
      ? `diraBot · ${drops.length} price drop${drops.length === 1 ? "" : "s"}${rises.length ? `, ${rises.length} increase${rises.length === 1 ? "" : "s"}` : ""}`
      : `diraBot · ${rises.length} price increase${rises.length === 1 ? "" : "s"}`;
  return { subject, html };
}

/** The owner's digest: one message to NOTIFY_TO (comma-separated), as it has always been. */
export async function sendEmail(subject: string, html: string) {
  const mailer = getMailer();
  if (!mailer) throw new Error("SMTP_USER / SMTP_PASS not set");
  const to = process.env.NOTIFY_TO ?? process.env.SMTP_USER ?? "owner@localhost";
  await mailer.transport.sendMail({ from: mailer.from, to, subject, html });
  if (mailer.mode === "log") console.log(`[mail:log] owner digest → ${to}: ${subject}`);
}
