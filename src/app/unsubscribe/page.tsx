import type { Metadata } from "next";
import { connection } from "next/server";
import { NoticePage } from "@/components/notice-page";
import { maskEmail, subscriptionByToken } from "@/lib/subscriptions";
import { UnsubscribeFlow } from "./unsubscribe-flow";

export const metadata: Metadata = {
  title: "Unsubscribe · diraBot",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Opening the link only shows the page; unsubscribing takes the button (a server action).
 * Gmail/Outlook link scanners pre-open links, so a GET must never unsubscribe anyone.
 * Mail clients' one-click unsubscribe uses the POST route at /unsubscribe/one-click instead.
 */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const { token } = await searchParams;
  const sub = await subscriptionByToken(token);

  if (!sub || typeof token !== "string") {
    return (
      <NoticePage tone="warning" title="This link doesn't work">
        It may be incomplete. Use the unsubscribe link at the bottom of any diraBot email.
      </NoticePage>
    );
  }
  return <UnsubscribeFlow token={token} who={maskEmail(sub.email)} subscribed={sub.status !== "unsubscribed"} canUndo={sub.confirmed} />;
}
