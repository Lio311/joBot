// One-off helper: discover public Facebook groups for the tracked cities via Apify.
// Usage: npx tsx scraper/tools/find-groups.ts
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { runActor } from "../lib/apify";

const QUERIES = [
  "דירות למכירה בתל אביב",
  "דירות למכירה תל אביב ללא תיווך",
  "נדל\"ן למכירה תל אביב",
  "דירות למכירה בהרצליה",
  "דירות למכירה רמת גן גבעתיים",
  "דירות למכירה קרית אונו",
  "דירות למכירה בנתניה",
  "דירות למכירה במרכז ללא תיווך",
];

interface Group { name?: string; url?: string; memberCount?: number | string; visibility?: string; snippet?: string; searchQuery?: string }

runActor<Group>("khadinakbar/facebook-groups-search-scraper", {
  searchQueries: QUERIES,
  maxResultsPerQuery: 10,
  countryCode: "IL",
}).then((groups) => console.log(JSON.stringify(groups, null, 1)));
