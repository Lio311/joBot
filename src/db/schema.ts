import {
  pgTable,
  serial,
  text,
  integer,
  real,
  doublePrecision,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  boolean,
} from "drizzle-orm/pg-core";
import type { PriceEntry } from "../lib/price-history";

export const FEATURE_KEYS = ["parking", "elevator", "balcony", "safeRoom", "airConditioning", "storage", "accessible", "renovated"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const listings = pgTable(
  "listings",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    description: text("description"),
    city: text("city").notNull(),
    priority: integer("priority").notNull(),
    neighborhood: text("neighborhood"),
    street: text("street"),
    propertyType: text("property_type"),
    rooms: real("rooms"),
    sqm: integer("sqm"),
    floor: integer("floor"),
    price: integer("price"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    images: jsonb("images").$type<string[]>().notNull().default([]),
    /** Loose signature (city + street + rooms + sqm) used to spot the same flat on two sites. */
    fingerprint: text("fingerprint"),
    duplicateOf: integer("duplicate_of"),
    isAgency: boolean("is_agency"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** Known asking prices, oldest first: our own readings plus what the site reports (see PriceEntry). */
    priceHistory: jsonb("price_history").$type<PriceEntry[]>().notNull().default([]),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    /** Amenities from the source (parking, elevator, balcony, safeRoom, …); absent key = unknown. */
    features: jsonb("features").$type<Partial<Record<FeatureKey, boolean>>>().notNull().default({}),
    /** Set once the listing's own page confirms the ad was taken down. */
    removedAt: timestamp("removed_at", { withTimezone: true }),
    /** Last time we checked a not-recently-seen listing's page for removal. */
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    /** When the owner starred the listing from the dashboard (favorites, synced across devices). Null = not starred. */
    starredAt: timestamp("starred_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("listings_source_external_idx").on(t.source, t.externalId),
    index("listings_fingerprint_idx").on(t.fingerprint),
    index("listings_first_seen_idx").on(t.firstSeenAt),
  ],
);

export const scrapeRuns = pgTable("scrape_runs", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull(), // ok | blocked | error | skipped
  found: integer("found").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  message: text("message"),
});

/**
 * Cities added from the dashboard, on top of the built-in ones in src/lib/config.ts.
 * Every field is derived from the CBS settlements list when the city is added.
 */
export const trackedCities = pgTable(
  "tracked_cities",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    he: text("he").notNull(),
    priority: integer("priority").notNull(),
    /** CBS settlement code, which is also Yad2's city code. */
    yad2Code: text("yad2_code").notNull(),
    onmap: text("onmap").notNull(),
    homeless: text("homeless").notNull(),
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tracked_cities_key_idx").on(t.key), uniqueIndex("tracked_cities_yad2_code_idx").on(t.yad2Code)],
);

export const SUBSCRIBER_STATUSES = ["pending", "active", "unsubscribed"] as const;
export type SubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number];

/** Visitors who signed up for the email digest from the dashboard (double opt-in). */
export const subscribers = pgTable(
  "subscribers",
  {
    id: serial("id").primaryKey(),
    /** Trimmed and lowercased. */
    email: text("email").notNull(),
    status: text("status").$type<SubscriberStatus>().notNull().default("pending"),
    /** Random, unguessable; used in the confirm and unsubscribe links. */
    token: text("token").notNull(),
    /** Only listings at this priority or better (1 = top). Null = everything. */
    minPriority: integer("min_priority"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Last time a confirmation email went out; rate-limits resends. */
    confirmSentAt: timestamp("confirm_sent_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("subscribers_email_idx").on(t.email), uniqueIndex("subscribers_token_idx").on(t.token)],
);

export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
export type ScrapeRun = typeof scrapeRuns.$inferSelect;
export type TrackedCity = typeof trackedCities.$inferSelect;
export type Subscriber = typeof subscribers.$inferSelect;
