// Site-wide passcode session (the site holds a CV, so everything is private).
// Edge-safe (Web Crypto) so the proxy can use it too.

export const SESSION_COOKIE = "jobot_session";
export const SESSION_DAYS = 90;

/** The cookie value for the current ADMIN_PASSCODE; changes (logs everyone out) when it changes. */
export async function sessionToken(passcode = process.env.ADMIN_PASSCODE ?? ""): Promise<string> {
  const data = new TextEncoder().encode(`jobot-session-v1:${passcode}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** No passcode configured: open in development, locked in production (CV must not be public). */
export const authMode = (): "open" | "passcode" | "unconfigured" =>
  process.env.ADMIN_PASSCODE ? "passcode" : process.env.NODE_ENV === "production" ? "unconfigured" : "open";

export async function validSession(cookie: string | undefined): Promise<boolean> {
  const mode = authMode();
  if (mode === "open") return true;
  if (mode === "unconfigured" || !cookie) return false;
  const expected = await sessionToken();
  if (cookie.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < cookie.length; i++) diff |= cookie.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
