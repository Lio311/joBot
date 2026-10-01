import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, validSession } from "./session";

export class AuthError extends Error {}

/** Server actions call this first: the proxy guards pages, not action POSTs from elsewhere. */
export async function requireAuth() {
  const jar = await cookies();
  if (!(await validSession(jar.get(SESSION_COOKIE)?.value))) throw new AuthError("not signed in");
}
