/**
 * App promo & event notifications — the pure rules (src/lib/mobile/promo-push.ts).
 * The send/opt-in endpoints are covered in test:community-api.
 *   npm run test:promo-push
 */
import assert from "node:assert/strict";
import { FEATURES, type FeatureKey } from "../src/lib/features/catalog";
import {
  PROMO_DAILY_CAP,
  PROMO_HEADLINE_MAX,
  PROMO_MESSAGE_MAX,
  parsePromoInput,
  promoNextFreeAt,
  promoNotification,
  promoPushEnabled,
  promoSendsLeft,
} from "../src/lib/mobile/promo-push";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-11-17T12:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * HOUR);
const has = (...keys: FeatureKey[]) => (k: FeatureKey) => keys.includes(k);

console.log("promo push rules");

check("input: trimmed, spaces collapsed; headline and message both required", () => {
  assert.deepEqual(parsePromoInput({ headline: "  11.11   Sale ", message: " 20% off\n everything " }), { ok: true, value: { headline: "11.11 Sale", message: "20% off everything" } });
  assert.equal(parsePromoInput({ headline: "", message: "x" }).ok, false);
  assert.equal(parsePromoInput({ headline: "x", message: "   " }).ok, false);
  assert.equal(parsePromoInput(null).ok, false);
  assert.equal(parsePromoInput({ headline: 5, message: "x" }).ok, false);
});

check("input: length caps", () => {
  assert.equal(parsePromoInput({ headline: "h".repeat(PROMO_HEADLINE_MAX), message: "m" }).ok, true);
  assert.equal(parsePromoInput({ headline: "h".repeat(PROMO_HEADLINE_MAX + 1), message: "m" }).ok, false);
  assert.equal(parsePromoInput({ headline: "h", message: "m".repeat(PROMO_MESSAGE_MAX + 1) }).ok, false);
});

check("the notification is titled with the store's name", () => {
  assert.deepEqual(promoNotification("VR Jonina", { headline: "11.11 Sale", message: "20% off." }), { title: "VR Jonina", body: "11.11 Sale — 20% off." });
});

check("daily cap: counts only sends in the last 24 hours", () => {
  assert.equal(promoSendsLeft([], now), PROMO_DAILY_CAP);
  assert.equal(promoSendsLeft([ago(1), ago(5)], now), 1);
  assert.equal(promoSendsLeft([ago(1), ago(5), ago(23)], now), 0);
  assert.equal(promoSendsLeft([ago(1), ago(5), ago(25)], now), 1, "a send older than 24 h no longer counts");
});

check("next free send: when the oldest send in the window ages out", () => {
  assert.equal(promoNextFreeAt([ago(1)], now), null);
  assert.deepEqual(promoNextFreeAt([ago(1), ago(5), ago(20)], now), new Date(ago(20).getTime() + 24 * HOUR));
});

check("enabled only when granted AND the customer app is open", () => {
  assert.equal(promoPushEnabled(has(FEATURES.MOBILE_PROMO_PUSH)), false, "no customer app");
  assert.equal(promoPushEnabled(has(FEATURES.MOBILE_SHOP)), false, "not granted");
  assert.equal(promoPushEnabled(has(FEATURES.MOBILE_PROMO_PUSH, FEATURES.MOBILE_SHOP)), true);
  assert.equal(promoPushEnabled(has(FEATURES.MOBILE_PROMO_PUSH, FEATURES.MOBILE_COMMUNITY)), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
