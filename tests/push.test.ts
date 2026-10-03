import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import webpush from "web-push";
import { parsePushSubscription, sendDevicePush, validPushEndpoint } from "../src/lib/push";
import { pushPass } from "../scraper/lib/push";
import { pushDeliveries, pushSubscriptions } from "../src/db/schema";
import type { getDb } from "../src/db/client";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const keys = { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
const device = (id: number) => ({ id, endpoint: `https://fcm.googleapis.com/fcm/send/test-${id}`, ...keys, createdAt: new Date() });

test("subscription rejects private destinations and malformed encryption keys", () => {
  for (const endpoint of ["http://fcm.googleapis.com/a", "https://127.0.0.1/a", "https://fcm.googleapis.com.evil.test/a", "https://evilpush.apple.com/a", "https://user@fcm.googleapis.com/a", "https://fcm.googleapis.com:444/a"]) {
    assert.equal(validPushEndpoint(endpoint), false);
  }
  for (const endpoint of [device(1).endpoint, "https://web.push.apple.com/token", "https://updates.push.services.mozilla.com/wpush/v2/token"]) {
    assert.deepEqual(parsePushSubscription({ endpoint, keys }), { endpoint, keys });
  }
  assert.throws(() => parsePushSubscription({ endpoint: device(1).endpoint, keys: { ...keys, auth: "broken" } }));
  assert.throws(() => parsePushSubscription({ endpoint: device(1).endpoint, keys: { ...keys, p256dh: Buffer.alloc(65).toString("base64url") } }));
});

test("delivery and pipeline handle retries per device without making real network requests", async () => {
  const original = webpush.sendNotification;
  const env = { public: process.env.VAPID_PUBLIC_KEY, private: process.env.VAPID_PRIVATE_KEY, subject: process.env.VAPID_SUBJECT, ai: process.env.ANTHROPIC_API_KEY };
  const vapid = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
  process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const requests: string[] = [];
    const inserted: unknown[] = [];
    const deleted: unknown[] = [];
    const logs: string[] = [];
    webpush.sendNotification = (async (sub, payload, options) => {
      requests.push(sub.endpoint);
      assert.equal(options?.timeout, 10000);
      assert.equal(JSON.parse(String(payload)).url, "/");
      if (sub.endpoint.endsWith("test-1")) throw { statusCode: 503 };
      if (sub.endpoint.endsWith("test-3")) throw { statusCode: 410 };
      return { statusCode: 201, headers: {}, body: "" };
    }) as typeof webpush.sendNotification;
    let selects = 0;
    const db = {
      select: () => {
        const index = selects++;
        return { from: () => index === 0 ? Promise.resolve([device(1), device(2), device(3)]) : {
          where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([{ id: 99, score: 80, title: "Developer", company: "Company" }]) }) }),
        } };
      },
      insert: (table: unknown) => {
        assert.equal(table, pushDeliveries);
        return { values: (values: unknown) => { inserted.push(values); return { onConflictDoNothing: async () => {} }; } };
      },
      delete: (table: unknown) => {
        assert.equal(table, pushSubscriptions);
        return { where: async () => { deleted.push(table); } };
      },
    };
    await pushPass(db as unknown as ReturnType<typeof getDb>, 60, (line) => logs.push(line));
    assert.equal(requests.length, 3, "a failed device must not stop others");
    assert.deepEqual(inserted, [[{ subscriptionId: 2, jobId: 99 }]], "record delivery only for the successful device");
    assert.equal(deleted.length, 1, "delete expired subscriptions only");
    assert.ok(logs.some((line) => line.includes("device 1 failed")));
    assert.equal(await sendDevicePush(device(3), { title: "test", body: "test" }), "expired");
    delete process.env.VAPID_PRIVATE_KEY;
    await assert.rejects(sendDevicePush(device(2), { title: "test", body: "test" }), /not configured/);
    const before = requests.length;
    await pushPass(db as unknown as ReturnType<typeof getDb>, 60, (line) => logs.push(line));
    assert.equal(requests.length, before, "unconfigured environments must skip sending");
  } finally {
    webpush.sendNotification = original;
    for (const [key, value] of [["VAPID_PUBLIC_KEY", env.public], ["VAPID_PRIVATE_KEY", env.private], ["VAPID_SUBJECT", env.subject], ["ANTHROPIC_API_KEY", env.ai]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("service worker shows pushes and opens only the private dashboard origin", async () => {
  const handlers: Record<string, (event: unknown) => void> = {};
  const shown: unknown[][] = [];
  const opened: string[] = [];
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), { URL, self: {
    addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler; },
    registration: { showNotification: async (...args: unknown[]) => { shown.push(args); } },
    location: { origin: "https://jobot.example" },
    clients: { matchAll: async () => [], openWindow: async (url: string) => { opened.push(url); } },
  } });
  let pending: Promise<unknown> = Promise.resolve();
  const waitUntil = (promise: Promise<unknown>) => { pending = promise; };
  handlers.push({ data: { json: () => ({ title: "new jobs", body: "Developer", url: "https://evil.example" }) }, waitUntil });
  await pending;
  assert.equal(shown[0][0], "new jobs");
  assert.equal((shown[0][1] as { dir: string }).dir, "rtl");
  handlers.push({ data: { json: () => { throw new Error("invalid JSON"); } }, waitUntil });
  await pending;
  assert.equal(shown.length, 2);
  handlers.notificationclick({ notification: { close() {}, data: { url: "https://evil.example" } }, waitUntil });
  await pending;
  assert.deepEqual(opened, ["https://jobot.example/"]);
});
