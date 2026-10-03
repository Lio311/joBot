// Vercel has the production database credentials during its build. Migrate before serving new code.
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { getDb, closeDb } from "../src/db/client";

async function prepareDeployment() {
  if (process.env.VERCEL !== "1" || process.env.VERCEL_ENV !== "production") return;
  if (!process.env.DATABASE_URL) throw new Error("Production DATABASE_URL is not configured");
  try {
    await migrate(getDb(), { migrationsFolder: "drizzle" });
    console.log("Production database migrations applied.");
  } finally {
    await closeDb();
  }
}

prepareDeployment().catch(() => {
  // Keep connection strings out of build logs.
  console.error("Production database migration failed. Deployment stopped.");
  process.exitCode = 1;
});
