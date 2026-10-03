import { existsSync, readFileSync, writeFileSync } from "node:fs";
import webpush from "web-push";

const path = ".env.local";
const original = existsSync(path) ? readFileSync(path, "utf8") : "";
if (/^\s*(?:export\s+)?VAPID_(?:PUBLIC|PRIVATE)_KEY\s*=\s*["']?[^\s"'#]/m.test(original)) {
  console.error("VAPID keys already exist in .env.local; keeping them to preserve device subscriptions.");
  process.exit(1);
}
const keys = webpush.generateVAPIDKeys();
const cleaned = original.replace(/^\s*(?:export\s+)?VAPID_(?:PUBLIC|PRIVATE)_KEY\s*=.*\r?\n?/gm, "");
writeFileSync(path, `${cleaned.trimEnd()}\n\n# Web Push: copy these SAME keys to the website and GitHub Actions secrets.\nVAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`, { mode: 0o600 });
console.log("VAPID keys saved to .env.local. Set VAPID_SUBJECT to your contact URL or mailto address, and copy all three values to the website and GitHub Actions secrets.");
