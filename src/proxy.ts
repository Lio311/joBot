import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, validSession } from "./lib/session";

// Everything except the login page requires the passcode session. Server actions check it again.
export async function proxy(request: NextRequest) {
  if (await validSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const url = new URL("/login", request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|icon.svg|favicon.ico|apple-icon.png|manifest.webmanifest|icons/|sw\\.js$).*)"],
};
