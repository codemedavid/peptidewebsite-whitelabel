/**
 * Self-contained test for the courier booking link — the external delivery form
 * a customer completes before ordering (a Lalamove booking form, a Maxim link).
 *
 * The store owner pastes the URL onto the COURIER itself (Courier.bookingUrl,
 * beside the existing trackingUrl), so it is per-tenant by construction: the
 * couriers array lives inside that tenant's branding.config row. Nothing keys
 * off the courier's NAME, so a rename never breaks it and the same field serves
 * Lalamove, Maxim or a same-day rider.
 *
 *   src/lib/storefront/courier-booking.ts
 *     safeExternalUrl(input)      — http(s) only; anything else becomes "".
 *     resolveCourierBooking(couriers, courierId, entitled)
 *                                 — { name, url } | null for the checkout card.
 *
 *   npm run test:courier-booking
 */

import assert from "node:assert";

import type { Courier } from "../src/storefront/types";
import { safeExternalUrl, resolveCourierBooking } from "../src/lib/storefront/courier-booking";

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

function courier(over: Partial<Courier> = {}): Courier {
  return { id: "c1", name: "J&T Express", trackingUrl: "", active: true, ...over };
}

const LALAMOVE = courier({
  id: "c_lala",
  name: "Lalamove",
  noLocation: true,
  bookingUrl: "https://example.com/lalamove-form",
});
const JNT = courier({ id: "c_jnt", name: "J&T Express" });
const COURIERS: Courier[] = [JNT, LALAMOVE];

console.log("\nCourier booking link\n");

// ─── The customer-facing card (spec Tests 5, 6, 8) ──────────────────────────

check("picking Lalamove surfaces the admin's configured link (spec Test 5)", () => {
  const booking = resolveCourierBooking(COURIERS, "c_lala", true);
  assert.strictEqual(booking?.url, "https://example.com/lalamove-form");
});

check("the card is titled with the courier's own name, not a hardcoded 'Lalamove'", () => {
  assert.strictEqual(resolveCourierBooking(COURIERS, "c_lala", true)?.name, "Lalamove");
  const maxim = [courier({ id: "c_max", name: "Maxim", bookingUrl: "https://example.com/m" })];
  assert.strictEqual(resolveCourierBooking(maxim, "c_max", true)?.name, "Maxim");
});

check("switching Lalamove → J&T hides the card (spec Test 6)", () => {
  assert.strictEqual(resolveCourierBooking(COURIERS, "c_jnt", true), null);
});

check("no courier selected shows nothing", () => {
  assert.strictEqual(resolveCourierBooking(COURIERS, "", true), null);
});

check("a blank booking URL does not crash checkout (spec Test 8)", () => {
  const blank = [courier({ id: "c_lala", name: "Lalamove", bookingUrl: "   " })];
  assert.strictEqual(resolveCourierBooking(blank, "c_lala", true), null);
});

check("a courier with no bookingUrl field at all is fine (every legacy courier)", () => {
  assert.strictEqual(resolveCourierBooking([JNT], "c_jnt", true), null);
});

check("a missing or malformed courier list returns nothing rather than throwing", () => {
  assert.strictEqual(resolveCourierBooking(undefined, "c_lala", true), null);
  assert.strictEqual(resolveCourierBooking(null, "c_lala", true), null);
  assert.strictEqual(resolveCourierBooking([null, 7, "x"], "c_lala", true), null);
  assert.strictEqual(resolveCourierBooking({ nope: 1 }, "c_lala", true), null);
});

check("an edited URL is read fresh from config, never cached (spec Test 7)", () => {
  const before = resolveCourierBooking(COURIERS, "c_lala", true);
  const edited = COURIERS.map((c) =>
    c.id === "c_lala" ? { ...c, bookingUrl: "https://example.com/new-form" } : c,
  );
  const after = resolveCourierBooking(edited, "c_lala", true);
  assert.strictEqual(before?.url, "https://example.com/lalamove-form");
  assert.strictEqual(after?.url, "https://example.com/new-form");
});

// ─── Tenant isolation (spec Test 9) ─────────────────────────────────────────

check("two tenants never see each other's booking link (spec Test 9)", () => {
  const tenantA: Courier[] = [
    courier({ id: "c_lala", name: "Lalamove", bookingUrl: "https://example.com/a" }),
  ];
  const tenantB: Courier[] = [
    courier({ id: "c_lala", name: "Lalamove", bookingUrl: "https://example.com/b" }),
  ];
  // Same courier id in both stores — the link comes from the config that was
  // passed in, which is read from that tenant's own branding row.
  assert.strictEqual(resolveCourierBooking(tenantA, "c_lala", true)?.url, "https://example.com/a");
  assert.strictEqual(resolveCourierBooking(tenantB, "c_lala", true)?.url, "https://example.com/b");
});

check("a tenant that configured no link shows nothing while another tenant's works", () => {
  const configured = [courier({ id: "c_lala", name: "Lalamove", bookingUrl: "https://example.com/a" })];
  const unconfigured = [courier({ id: "c_lala", name: "Lalamove" })];
  assert.ok(resolveCourierBooking(configured, "c_lala", true));
  assert.strictEqual(resolveCourierBooking(unconfigured, "c_lala", true), null);
});

// ─── The entitlement gate (feature management, default OFF) ─────────────────

check("an unentitled tenant never renders the card", () => {
  assert.strictEqual(resolveCourierBooking(COURIERS, "c_lala", false), null);
});

check("revoking the feature leaves the owner's saved URL intact", () => {
  resolveCourierBooking(COURIERS, "c_lala", false);
  assert.strictEqual(LALAMOVE.bookingUrl, "https://example.com/lalamove-form");
});

// ─── URL safety: this value becomes an <a href> ─────────────────────────────
// trackingUrl has only ever been rendered as TEXT, so it was never scheme-
// checked. bookingUrl is a link the customer clicks, which makes a javascript:
// URL saved by any staff member with courier permission a stored-XSS vector.

check("http and https links are kept", () => {
  assert.strictEqual(safeExternalUrl("https://example.com/f"), "https://example.com/f");
  assert.strictEqual(safeExternalUrl("http://example.com/f"), "http://example.com/f");
});

check("surrounding whitespace is trimmed", () => {
  assert.strictEqual(safeExternalUrl("  https://example.com/f  "), "https://example.com/f");
});

check("a javascript: URL is rejected", () => {
  assert.strictEqual(safeExternalUrl("javascript:alert(1)"), "");
  assert.strictEqual(safeExternalUrl("JaVaScRiPt:alert(1)"), "");
  assert.strictEqual(safeExternalUrl("  javascript:alert(1)"), "");
});

check("a data: URL is rejected", () => {
  assert.strictEqual(safeExternalUrl("data:text/html,<script>alert(1)</script>"), "");
});

check("other non-web schemes are rejected", () => {
  assert.strictEqual(safeExternalUrl("vbscript:msgbox(1)"), "");
  assert.strictEqual(safeExternalUrl("file:///etc/passwd"), "");
});

check("a scheme-relative or bare value is rejected rather than guessed at", () => {
  assert.strictEqual(safeExternalUrl("//evil.example.com"), "");
  assert.strictEqual(safeExternalUrl("example.com/form"), "");
  assert.strictEqual(safeExternalUrl(""), "");
});

check("non-string input is rejected", () => {
  assert.strictEqual(safeExternalUrl(undefined), "");
  assert.strictEqual(safeExternalUrl(null), "");
  assert.strictEqual(safeExternalUrl(42), "");
  assert.strictEqual(safeExternalUrl({ href: "https://example.com" }), "");
});

check("an unsafe URL never reaches the checkout card", () => {
  const hostile = [courier({ id: "c_lala", name: "Lalamove", bookingUrl: "javascript:alert(1)" })];
  assert.strictEqual(resolveCourierBooking(hostile, "c_lala", true), null);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
