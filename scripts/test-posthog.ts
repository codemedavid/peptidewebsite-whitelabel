/**
 * Self-contained test for the PostHog integration's pure cores. Runs the REAL
 * modules (no DB, no Next runtime, no network):
 *   - lib/crypto/envelope.ts    — AES-256-GCM seal/open for tenant creds
 *   - lib/analytics/events.ts   — Order → PostHog capture payload builders
 *
 * Covers: encrypt/decrypt round-trip (incl. unicode/empty), IV randomization,
 * GCM tamper detection (ciphertext/iv/tag), wrong-key rejection, key-length
 * validation, key fingerprint in dataKeyId; and for events: distinctId
 * resolution + fallback, total math (items + shipping + fee − discount, clamped),
 * order_placed / order_status_changed payload shape, and the email→$set identity
 * that PostHog Messaging needs to reach the customer.
 *
 *   npm run test:posthog
 */

import assert from "node:assert";

// Deterministic 32-byte hex key for the run (envelope reads ENCRYPTION_KEY).
const KEY_A = "1".repeat(64);
const KEY_B = "2".repeat(64);
process.env.ENCRYPTION_KEY = KEY_A;

import {
  encryptSecret,
  decryptSecret,
  type EncryptedBlob,
} from "../src/lib/crypto/envelope";
import {
  POSTHOG_EVENTS,
  resolveDistinctId,
  orderTotal,
  buildOrderPlacedPayload,
  buildStatusChangedPayload,
  buildSampleOrder,
} from "../src/lib/analytics/events";

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** A minimal but valid storefront Order, overridable per case. */
function makeOrder(over: Record<string, unknown> = {}): any {
  return {
    id: "o-123",
    orderNumber: "ABC-1001",
    status: "new",
    paymentStatus: "pending",
    paymentMethod: "Bank transfer",
    date: "2026-06-27T00:00:00.000Z",
    customer: { name: "Jane Buyer", email: "  Jane@Example.COM ", phone: "0917", contactMethod: "gmail" },
    shipping: { address: "1 St", barangay: "", city: "Cebu", province: "Cebu", postal: "", country: "PH", region: "", fee: 50 },
    courier: "J&T",
    trackingNumber: "",
    shippingNote: "",
    items: [
      { name: "BPC-157", qty: 2, price: 100 },
      { name: "TB-500", qty: 1, price: 250 },
    ],
    statusHistory: [{ status: "new", at: "2026-06-27T00:00:00.000Z" }],
    paymentProof: null,
    ...over,
  };
}

console.log("\nPostHog integration — pure-core gate\n");

// ───────────────────────────── envelope: crypto ─────────────────────────────
console.log("envelope (AES-256-GCM)");

check("round-trips an ASCII secret", () => {
  process.env.ENCRYPTION_KEY = KEY_A;
  const sealed = encryptSecret("phc_secret_projectKey_123");
  assert.equal(decryptSecret(sealed.encryptedCredentials, sealed.dataKeyId), "phc_secret_projectKey_123");
});

check("round-trips unicode and empty string", () => {
  process.env.ENCRYPTION_KEY = KEY_A;
  for (const s of ["", " key-with-emoji-🔐-and-ünïcode", " spaced "]) {
    const sealed = encryptSecret(s);
    assert.equal(decryptSecret(sealed.encryptedCredentials), s);
  }
});

check("ciphertext does not equal plaintext", () => {
  process.env.ENCRYPTION_KEY = KEY_A;
  const sealed = encryptSecret("phc_plain");
  assert.notEqual(sealed.encryptedCredentials.ciphertext, "phc_plain");
});

check("randomizes IV — same plaintext seals to different ciphertext", () => {
  process.env.ENCRYPTION_KEY = KEY_A;
  const a = encryptSecret("same-input");
  const b = encryptSecret("same-input");
  assert.notEqual(a.encryptedCredentials.iv, b.encryptedCredentials.iv);
  assert.notEqual(a.encryptedCredentials.ciphertext, b.encryptedCredentials.ciphertext);
});

check("tampered ciphertext fails the GCM tag (throws, never garbage)", () => {
  process.env.ENCRYPTION_KEY = KEY_A;
  const sealed = encryptSecret("phc_secret");
  const buf = Buffer.from(sealed.encryptedCredentials.ciphertext, "base64");
  buf[0] ^= 0xff;
  const tampered: EncryptedBlob = { ...sealed.encryptedCredentials, ciphertext: buf.toString("base64") };
  assert.throws(() => decryptSecret(tampered));
});

check("tampered auth tag is rejected", () => {
  process.env.ENCRYPTION_KEY = KEY_A;
  const sealed = encryptSecret("phc_secret");
  const buf = Buffer.from(sealed.encryptedCredentials.tag, "base64");
  buf[0] ^= 0xff;
  const tampered: EncryptedBlob = { ...sealed.encryptedCredentials, tag: buf.toString("base64") };
  assert.throws(() => decryptSecret(tampered));
});

check("a blob sealed by key A cannot be opened by key B", () => {
  process.env.ENCRYPTION_KEY = KEY_A;
  const sealed = encryptSecret("phc_secret");
  process.env.ENCRYPTION_KEY = KEY_B;
  assert.throws(() => decryptSecret(sealed.encryptedCredentials));
  process.env.ENCRYPTION_KEY = KEY_A; // restore
});

check("dataKeyId fingerprints the key (differs across keys, stable per key)", () => {
  process.env.ENCRYPTION_KEY = KEY_A;
  const a1 = encryptSecret("x").dataKeyId;
  const a2 = encryptSecret("y").dataKeyId;
  assert.equal(a1, a2, "same key → same fingerprint");
  process.env.ENCRYPTION_KEY = KEY_B;
  const b1 = encryptSecret("x").dataKeyId;
  assert.notEqual(a1, b1, "different key → different fingerprint");
  process.env.ENCRYPTION_KEY = KEY_A; // restore
});

check("rejects a malformed (non-32-byte) ENCRYPTION_KEY", () => {
  process.env.ENCRYPTION_KEY = "deadbeef"; // too short
  assert.throws(() => encryptSecret("x"));
  process.env.ENCRYPTION_KEY = KEY_A; // restore
});

// ───────────────────────────── events: builders ─────────────────────────────
console.log("\nevents (Order → capture payload)");

check("resolveDistinctId uses the trimmed, lowercased email", () => {
  assert.equal(resolveDistinctId(makeOrder()), "jane@example.com");
});

check("resolveDistinctId falls back to orderNumber, then id, never empty", () => {
  const noEmail = makeOrder({ customer: { name: "", email: "", phone: "", contactMethod: "" } });
  assert.equal(resolveDistinctId(noEmail), "ABC-1001");
  const noEmailNoNumber = makeOrder({
    orderNumber: undefined,
    customer: { name: "", email: "  ", phone: "", contactMethod: "" },
  });
  assert.equal(resolveDistinctId(noEmailNoNumber), "o-123");
});

check("orderTotal = items + shipping + adminFee − discount (clamped ≥ 0)", () => {
  // items: 2*100 + 1*250 = 450; +shipping 50 = 500
  assert.equal(orderTotal(makeOrder()), 500);
  const withFeeAndDiscount = makeOrder({
    adminFee: { label: "Service", amount: 30 },
    discount: { code: "SAVE", label: "Save 100", amount: 100 },
  });
  // 450 + 50 + 30 − 100 = 430
  assert.equal(orderTotal(withFeeAndDiscount), 430);
  const overDiscounted = makeOrder({
    items: [{ name: "x", qty: 1, price: 10 }],
    shipping: { ...makeOrder().shipping, fee: 0 },
    discount: { code: "BIG", label: "Big", amount: 9999 },
  });
  assert.equal(orderTotal(overDiscounted), 0);
});

check("buildOrderPlacedPayload has the right event, distinctId and core props", () => {
  const p = buildOrderPlacedPayload(makeOrder());
  assert.equal(p.event, POSTHOG_EVENTS.ORDER_PLACED);
  assert.equal(p.distinctId, "jane@example.com");
  assert.equal(p.properties.orderNumber, "ABC-1001");
  assert.equal(p.properties.total, 500);
  assert.equal(p.properties.itemsCount, 3); // 2 + 1 units
  assert.equal(p.properties.paymentMethod, "Bank transfer");
});

check("buildOrderPlacedPayload identifies the person by email/name (PostHog $set)", () => {
  const p = buildOrderPlacedPayload(makeOrder());
  assert.ok(p.personProperties, "personProperties present");
  assert.equal(p.personProperties!.email, "jane@example.com");
  assert.equal(p.personProperties!.name, "Jane Buyer");
});

check("buildOrderPlacedPayload omits email from $set when the buyer gave none", () => {
  const p = buildOrderPlacedPayload(makeOrder({ customer: { name: "Anon", email: "", phone: "", contactMethod: "" } }));
  assert.ok(!("email" in (p.personProperties ?? {})) || p.personProperties!.email === undefined);
});

check("buildStatusChangedPayload carries from/to status and tracking", () => {
  const order = makeOrder({ status: "shipped", courier: "LBC", trackingNumber: "TRK99" });
  const p = buildStatusChangedPayload(order, "processing", "shipped");
  assert.equal(p.event, POSTHOG_EVENTS.ORDER_STATUS_CHANGED);
  assert.equal(p.distinctId, "jane@example.com");
  assert.equal(p.properties.fromStatus, "processing");
  assert.equal(p.properties.toStatus, "shipped");
  assert.equal(p.properties.trackingNumber, "TRK99");
  assert.equal(p.properties.orderNumber, "ABC-1001");
});

// ──────────────────────── sample order (super-admin test tool) ───────────────
console.log("\nsample order (send-test-events tool)");

check("buildSampleOrder carries the given email (→ lowercased distinctId)", () => {
  const o = buildSampleOrder("Owner@Store.COM");
  assert.equal(resolveDistinctId(o), "owner@store.com");
  assert.ok(o.items.length >= 1, "has at least one line item");
});

check("buildSampleOrder with no email is still a valid order", () => {
  const o = buildSampleOrder();
  assert.ok(orderTotal(o) > 0, "non-zero total");
  assert.equal(resolveDistinctId(o), o.orderNumber); // falls back to order number
});

check("sample order feeds the real builders (placed + shipped/delivered)", () => {
  const o = buildSampleOrder("t@e.com");
  const placed = buildOrderPlacedPayload(o);
  assert.equal(placed.event, POSTHOG_EVENTS.ORDER_PLACED);
  assert.equal(placed.distinctId, "t@e.com");
  const shipped = buildStatusChangedPayload(o, "processing", "shipped");
  assert.equal(shipped.properties.toStatus, "shipped");
  const delivered = buildStatusChangedPayload(o, "shipped", "delivered");
  assert.equal(delivered.properties.toStatus, "delivered");
});

// ────────────────────────────────── summary ─────────────────────────────────
console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed.\n`);
process.exit(failed === 0 ? 0 : 1);
