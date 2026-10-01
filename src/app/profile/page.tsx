import { connection } from "next/server";
import { Header } from "@/components/header";
import { ProfileForm } from "@/components/profile-form";
import { getProfileData } from "@/lib/data";

export default async function ProfilePage() {
  await connection();
  const data = await getProfileData();
  return (
    <>
      <Header now={data.now} />
      <main className="flex-1">
        <ProfileForm data={data} />
      </main>
    </>
  );
}
