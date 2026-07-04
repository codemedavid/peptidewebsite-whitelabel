/**
 * Self-contained test for the admin order-alert pure cores. Runs the REAL
 * lib/analytics/events.ts (no DB, no Next runtime, no network):
 *   - resolveAdminNotifyEmail() — the config gate: returns the admin's email only
 *     when orderNotifications is enabled AND the address is a valid email, else null.
 *   - buildAdminOrderPayload()  — Order → PostHog capture payload whose PERSON is
 *     the admin (distinctId + $set email = admin), so PostHog Messaging emails the
 *     store owner — while the buyer's details ride in event properties, never $set.
 *
 * This is the "you received an order" alert (Automated package). Kept pure so the
 * gate is unit-testable exactly like scripts/test-posthog.ts.
 *
 *   npm run test:admin-order-alert
 */

import assert from "node:assert";

import {
  POSTHOG_EVENTS,
  orderTotal,
  buildEmailBrand,
  buildAdminOrderPayload,
  resolveAdminNotifyEmail,
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

const ADMIN_EMAIL = "owner@gmail.com";

console.log("\nAdmin order-alert — pure-core gate\n");

// ───────────────── resolveAdminNotifyEmail (the config gate) ─────────────────
console.log("resolveAdminNotifyEmail (branding.config.orderNotifications)");

check("returns the trimmed email when enabled and valid", () => {
  assert.equal(
    resolveAdminNotifyEmail({ orderNotifications: { enabled: true, email: "  Owner@Gmail.com " } }),
    "Owner@Gmail.com",
  );
});

check("returns null when disabled (even with a valid email)", () => {
  assert.equal(
    resolveAdminNotifyEmail({ orderNotifications: { enabled: false, email: "owner@gmail.com" } }),
    null,
  );
});

check("returns null when the config slice is missing", () => {
  assert.equal(resolveAdminNotifyEmail({}), null);
  assert.equal(resolveAdminNotifyEmail({ orderNotifications: {} }), null);
});

check("returns null for a malformed / empty email", () => {
  for (const bad of ["", "   ", "not-an-email", "a@b", "@gmail.com", "owner@", "owner @gmail.com"]) {
    assert.equal(
      resolveAdminNotifyEmail({ orderNotifications: { enabled: true, email: bad } }),
      null,
      `expected null for "${bad}"`,
    );
  }
});

check("is defensive against non-object / non-string shapes", () => {
  assert.equal(resolveAdminNotifyEmail({ orderNotifications: null }), null);
  assert.equal(resolveAdminNotifyEmail({ orderNotifications: { enabled: true, email: 123 } }), null);
  assert.equal(resolveAdminNotifyEmail({ orderNotifications: { enabled: "yes", email: "owner@gmail.com" } }), null);
});

// ───────────────── buildAdminOrderPayload (person = admin) ───────────────────
console.log("\nbuildAdminOrderPayload (Order → admin-targeted capture)");

check("uses the admin event name", () => {
  const p = buildAdminOrderPayload(makeOrder(), undefined, ADMIN_EMAIL);
  assert.equal(p.event, POSTHOG_EVENTS.ORDER_PLACED_ADMIN);
  assert.equal(p.event, "admin_order_placed");
});

check("targets the ADMIN as the person (distinctId + $set email), lowercased", () => {
  const p = buildAdminOrderPayload(makeOrder(), undefined, "Owner@Gmail.com");
  assert.equal(p.distinctId, "owner@gmail.com");
  assert.ok(p.personProperties, "personProperties present");
  assert.equal(p.personProperties!.email, "owner@gmail.com");
});

check("NEVER identifies the buyer as the person (buyer email not in $set)", () => {
  const p = buildAdminOrderPayload(makeOrder(), undefined, ADMIN_EMAIL);
  // The buyer is jane@example.com — she must not become the messaged person.
  assert.notEqual(p.distinctId, "jane@example.com");
  assert.notEqual(p.personProperties!.email, "jane@example.com");
});

check("carries the order summary in properties (incl. the buyer's name for the admin to read)", () => {
  const p = buildAdminOrderPayload(makeOrder(), undefined, ADMIN_EMAIL);
  assert.equal(p.properties.orderNumber, "ABC-1001");
  assert.equal(p.properties.total, orderTotal(makeOrder())); // 500
  assert.equal(p.properties.itemsCount, 3); // 2 + 1 units
  assert.equal(p.properties.buyerName, "Jane Buyer");
});

check("carries brand properties when a brand is given (one template, every store)", () => {
  const brand = buildEmailBrand(
    { name: "Peptide Palace", button: "#0F766E", currency: "₱" },
    "https://shop.jonina.store",
  );
  const p = buildAdminOrderPayload(makeOrder(), brand, ADMIN_EMAIL);
  assert.equal(p.properties.brandName, "Peptide Palace");
  assert.equal(p.properties.storeUrl, "https://shop.jonina.store");
  assert.equal(p.properties.orderNumber, "ABC-1001"); // order props intact
});

check("omits brand keys entirely when no brand is given", () => {
  const p = buildAdminOrderPayload(makeOrder(), undefined, ADMIN_EMAIL);
  assert.ok(!("brandName" in p.properties));
  assert.ok(!("storeUrl" in p.properties));
});

// ────────────────────────────────── summary ─────────────────────────────────
console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed.\n`);
process.exit(failed === 0 ? 0 : 1);
