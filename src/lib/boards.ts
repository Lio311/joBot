import type { AtsKind } from "@/db/schema";

/** Maps an ATS URL to the company board it belongs to. */
export function boardOf(url: string): { ats: AtsKind; slug: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const parts = u.pathname.split("/").filter(Boolean);
  if (u.hostname.endsWith("comeet.com") && parts[0] === "jobs" && parts[1] && /^[0-9A-F]{2}\.[0-9A-F]{3}$/i.test(parts[2] ?? ""))
    return { ats: "comeet", slug: `${parts[1]}/${parts[2]}` };
  if (/(^|\.)greenhouse\.io$/.test(u.hostname) && parts[0] && parts[0] !== "embed") return { ats: "greenhouse", slug: parts[0].toLowerCase() };
  if (u.hostname === "jobs.lever.co" && parts[0]) return { ats: "lever", slug: parts[0].toLowerCase() };
  if (u.hostname === "jobs.ashbyhq.com" && parts[0]) return { ats: "ashby", slug: parts[0] };
  return null;
}
