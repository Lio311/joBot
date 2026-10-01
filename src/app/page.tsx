import { connection } from "next/server";
import { Dashboard } from "@/components/dashboard";
import { FavoritesProvider } from "@/components/favorites";
import { getDashboardData } from "@/lib/data";

export default async function Page() {
  // Listings change every scrape; always render from the database.
  await connection();
  const data = await getDashboardData();
  return (
    <FavoritesProvider passcodeRequired={data.passcodeRequired}>
      <Dashboard
        listings={data.listings}
        status={data.status}
        cities={data.cities}
        passcodeRequired={data.passcodeRequired}
        now={data.now}
      />
    </FavoritesProvider>
  );
}
