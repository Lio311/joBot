// Facebook CDN links are signed and short-lived, and some come from regional edge hosts
// (scontent.<pop>.fna.fbcdn.net) that don't resolve outside that region. Dropping those
// up front shows the placeholder instead of a failed request in the browser console.

export function usableImage(url: string | null | undefined, now = Date.now()): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!u.hostname.endsWith("fbcdn.net")) return url;
  if (u.hostname.endsWith(".fna.fbcdn.net")) return null;
  // `oe` is the expiry as a hex unix timestamp.
  const oe = u.searchParams.get("oe");
  if (oe && parseInt(oe, 16) * 1000 < now + 3_600_000) return null;
  return url;
}
