import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { test } from "node:test";
import { config } from "dotenv";
import webpush from "web-push";
import { closeDb, getDb } from "../src/db/client";
import { jobs, pushDeliveries, pushSubscriptions } from "../src/db/schema";
import { pushPass } from "../scraper/lib/push";
import { and, inArray } from "drizzle-orm";

// Explicit opt-in: use a local database only, with rollback and no real Push requests.
test("Postgres filtering, per-device dedupe and retries", { skip: process.env.LOCAL_PUSH_DB_TEST !== "1" }, async () => {
  config({ path: [".env.local", ".env"], quiet: true });
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
  const original = webpush.sendNotification;
  const originalEnv = { ...process.env };
  const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
  const keys = { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
  const vapid = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = vapid.publicKey; process.env.VAPID_PRIVATE_KEY = vapid.privateKey; process.env.VAPID_SUBJECT = "mailto:test@example.com";
  delete process.env.ANTHROPIC_API_KEY;
  const rollback = new Error("rollback test records");
  try {
    await assert.rejects(getDb().transaction(async (tx) => {
      const now = Date.now();
      const suffix = randomBytes(8).toString("hex");
      const devices = await tx.insert(pushSubscriptions).values([3, 1].map((days) => ({
        endpoint: `https://fcm.googleapis.com/fcm/send/db-test-${suffix}-${days}`, ...keys, createdAt: new Date(now - days * 864e5),
      }))).returning();
      // This runs against existing local data too; restrict the test to these devices.
      const candidates = await tx.insert(jobs).values([
        { title: "fresh", score: 90, firstSeenAt: new Date(now) },
        { title: "before-second-device", score: 90, firstSeenAt: new Date(now - 2 * 864e5) },
        { title: "low", score: 10, firstSeenAt: new Date(now) },
        { title: "hidden", score: 99, status: "hidden" as const, firstSeenAt: new Date(now) },
        { title: "old", score: 99, firstSeenAt: new Date(now - 8 * 864e5) },
        { title: "duplicate", score: 99, duplicateOf: 1, firstSeenAt: new Date(now) },
      ].map((job, i) => ({ ...job, source: "push-test", externalId: `${suffix}-${i}`, url: "https://example.com/job" }))).returning();
      await tx.insert(pushDeliveries).values({ subscriptionId: devices[0].id, jobId: candidates[0].id });
      const sent: string[] = [];
      webpush.sendNotification = (async (sub) => {
        assert.ok(devices.some((d) => d.endpoint === sub.endpoint));
        sent.push(sub.endpoint);
        if (sub.endpoint === devices[1].endpoint) throw { statusCode: 503 };
        return { statusCode: 201, headers: {}, body: "" };
      }) as typeof webpush.sendNotification;
      // Delegate all queries to the transaction but limit the initial device query.
      let first = true;
      const scoped = new Proxy(tx, { get(target, key) {
        if (key === "select") return () => {
          if (first) { first = false; return { from: () => tx.select().from(pushSubscriptions).where(inArray(pushSubscriptions.id, devices.map((d) => d.id))) }; }
          return { from: (table: typeof jobs | typeof pushDeliveries) => {
            if (table === jobs) return { where: (condition: import("drizzle-orm").SQL) =>
              target.select().from(jobs).where(and(condition, inArray(jobs.id, candidates.map((j) => j.id)))) };
            return target.select().from(pushDeliveries);
          } };
        };
        const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
      } });
      await pushPass(scoped as unknown as ReturnType<typeof getDb>, 60, () => {});
      const delivered = () => tx.select().from(pushDeliveries).where(inArray(pushDeliveries.subscriptionId, devices.map((d) => d.id)));
      let rows = await delivered();
      assert.equal(rows.length, 2);
      assert.deepEqual(rows.map((r) => r.jobId).sort(), [candidates[0].id, candidates[1].id].sort());
      assert.ok(rows.every((r) => r.subscriptionId === devices[0].id));
      first = true; sent.length = 0;
      webpush.sendNotification = (async (sub) => { sent.push(sub.endpoint); return { statusCode: 201, headers: {}, body: "" }; }) as typeof webpush.sendNotification;
      await pushPass(scoped as unknown as ReturnType<typeof getDb>, 60, () => {});
      assert.deepEqual(sent, [devices[1].endpoint], "retry only the failed device");
      rows = await delivered(); assert.equal(rows.length, 3);
      first = true; sent.length = 0;
      await pushPass(scoped as unknown as ReturnType<typeof getDb>, 60, () => {});
      assert.equal(sent.length, 0, "do not resend delivered jobs");
      throw rollback;
    }), (error) => error === rollback);
  } finally {
    webpush.sendNotification = original;
    process.env = originalEnv;
    await closeDb();
  }
});
