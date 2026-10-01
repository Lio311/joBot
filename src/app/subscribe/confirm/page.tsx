import type { Metadata } from "next";
import { connection } from "next/server";
import { NoticePage } from "@/components/notice-page";
import { confirmSubscription, maskEmail } from "@/lib/subscriptions";

export const metadata: Metadata = {
  title: "Confirm alerts · diraBot",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const { token } = await searchParams;
  const { outcome, email } = await confirmSubscription(token);
  const who = email ? <span className="font-medium text-fg">{maskEmail(email)}</span> : null;

  if (outcome === "confirmed" || outcome === "already-active") {
    return (
      <NoticePage tone="success" title={outcome === "confirmed" ? "You're subscribed" : "You're already subscribed"}>
        New listings and price drops will reach {who} after each run, at most every 8 hours. Every email has a one-click
        unsubscribe link.
      </NoticePage>
    );
  }
  if (outcome === "already-unsubscribed") {
    return (
      <NoticePage tone="neutral" title="This address is unsubscribed">
        {who} unsubscribed after this link was sent. To get alerts again, sign up from the dashboard.
      </NoticePage>
    );
  }
  return (
    <NoticePage tone="warning" title="This link doesn't work">
      It may be incomplete or out of date. Sign up again from the dashboard and we&apos;ll send a fresh confirmation link.
    </NoticePage>
  );
}
