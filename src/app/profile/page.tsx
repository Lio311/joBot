import { connection } from "next/server";
import { Header } from "@/components/header";
import { ProfileForm } from "@/components/profile-form";
import { getProfileData } from "@/lib/data";
import { pushConfigured } from "@/lib/push";

export default async function ProfilePage() {
  await connection();
  const data = await getProfileData();
  return (
    <>
      <Header now={data.now} pushPublicKey={pushConfigured() ? process.env.VAPID_PUBLIC_KEY! : null} />
      <main className="flex-1">
        <ProfileForm data={data} />
      </main>
    </>
  );
}
