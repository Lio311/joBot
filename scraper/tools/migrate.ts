// Apply pending Drizzle migrations without scraping. Usage: npx tsx scraper/tools/migrate.ts
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "../../src/db/client";

migrate(getDb(), { migrationsFolder: "drizzle" })
  .then(() => console.log("migrations applied"))
  .finally(closeDb);
