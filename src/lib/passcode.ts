import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

// Optional shared passcode for changing the tracked cities (env ADMIN_PASSCODE).

export const passcodeRequired = () => !!process.env.ADMIN_PASSCODE;

/** Constant-time check; always true when no passcode is configured. */
export function passcodeOk(input: unknown): boolean {
  const expected = process.env.ADMIN_PASSCODE;
  if (!expected) return true;
  if (typeof input !== "string" || input.length > 200) return false;
  // Hash both sides so the comparison runs on equal-length buffers and leaks nothing about length.
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
