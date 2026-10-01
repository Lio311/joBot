import type { NextRequest } from "next/server";
import { unsubscribe } from "@/lib/subscriptions";

// Target of the digest's List-Unsubscribe header. Mail clients POST here (RFC 8058, body
// "List-Unsubscribe=One-Click"); anything that opens it in a browser lands on the page instead.

export async function POST(request: NextRequest) {
  const { outcome } = await unsubscribe(request.nextUrl.searchParams.get("token"));
  const ok = outcome !== "invalid";
  return new Response(ok ? "Unsubscribed\n" : "Unknown token\n", {
    status: ok ? 200 : 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  const url = new URL("/unsubscribe", request.nextUrl);
  const token = request.nextUrl.searchParams.get("token");
  if (token) url.searchParams.set("token", token);
  return Response.redirect(url, 303);
}
