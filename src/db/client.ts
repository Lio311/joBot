import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // prepare:false keeps us compatible with transaction-mode poolers (Neon, Supabase).
  return postgres(url, { prepare: false, max: 5, onnotice: () => {} });
}

export function getDb() {
  globalForDb.sql ??= connect();
  return drizzle(globalForDb.sql, { schema });
}

export async function closeDb() {
  await globalForDb.sql?.end();
  globalForDb.sql = undefined;
}
