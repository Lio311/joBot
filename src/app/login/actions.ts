"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_DAYS, authMode, sessionToken } from "@/lib/session";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function login(_prev: { error?: string } | null, form: FormData): Promise<{ error?: string }> {
  if (authMode() === "unconfigured") return { error: "ADMIN_PASSCODE לא הוגדר בשרת" };
  const input = String(form.get("passcode") ?? "");
  const expected = process.env.ADMIN_PASSCODE ?? "";
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!input || !timingSafeEqual(a, b)) {
    await sleep(600); // slows down guessing
    return { error: "קוד שגוי" };
  }
  (await cookies()).set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  const next = String(form.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
