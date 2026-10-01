import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "../../src/db/client";
import { pdfToText } from "../../src/lib/cv";
import { saveProfile } from "../../src/lib/profile-store";

// npm run cv: reads the newest PDF in ./cv and stores its text as the profile's CV.

const dir = "cv";
const pdfs = readdirSync(dir)
  .filter((f) => f.toLowerCase().endsWith(".pdf"))
  .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t);
if (!pdfs.length) {
  console.error("No PDF in ./cv. Put your CV there (e.g. cv/my-cv.pdf) and run again.");
  process.exit(1);
}
const file = pdfs[0].f;
const text = await pdfToText(new Uint8Array(readFileSync(join(dir, file))));
if (text.length < 200) {
  console.error(`Only ${text.length} characters extracted from ${file}. Is it a scanned image? Export it as a text PDF.`);
  process.exit(1);
}
const db = getDb();
await migrate(db, { migrationsFolder: "drizzle" });
const version = await saveProfile(db, { cvText: text, cvFileName: file });
console.log(`Loaded ${file}: ${text.length} characters (profile v${version}). Next: fill in the questionnaire on the dashboard.`);
await closeDb();
