import { connection } from "next/server";
import { Header } from "@/components/header";
import { JobsBoard } from "@/components/jobs-board";
import { getBoardData } from "@/lib/data";
import { pushConfigured } from "@/lib/push";

export default async function Home() {
  await connection(); // render on request; the build never touches the database
  const data = await getBoardData();
  return (
    <>
      <Header runs={data.runs} now={data.now} pushPublicKey={pushConfigured() ? process.env.VAPID_PUBLIC_KEY! : null} />
      <main className="flex-1">
        <JobsBoard data={data} />
      </main>
    </>
  );
}
