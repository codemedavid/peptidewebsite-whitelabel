/**
 * Two per-store checkout settings (thepeppylab, 2026-10-17):
 *
 *   1. Courier `note` — the owner's own line shown under the courier picker
 *      while that courier is selected ("NCR and nearby areas only · pick-up is
 *      Malate, Manila"). Plain text, trimmed and capped; blank = no key.
 *   2. Brand `checkoutHideEmail` — drops the Email field from checkout. Email is
 *      never required server-side, so the order still saves; the chat message
 *      simply leaves the "Email:" line out instead of printing a blank one.
 *
 *   npm run test:checkout-courier-note-email
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanCourierNote, courierNote, MAX_COURIER_NOTE_LENGTH } from "../src/lib/storefront/courier-note";
import { checkoutFields } from "../src/lib/storefront/checkout-fields";

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

console.log("\nCheckout — courier note + optional email field\n");

console.log("1. Courier note");

check("trims and keeps a real note", () => {
  assert.equal(cleanCourierNote("  NCR only  "), "NCR only");
});
check("blank / non-string → undefined (no key persisted)", () => {
  assert.equal(cleanCourierNote("   "), undefined);
  assert.equal(cleanCourierNote(undefined), undefined);
  assert.equal(cleanCourierNote(5), undefined);
});
check("capped", () => {
  assert.equal(cleanCourierNote("x".repeat(MAX_COURIER_NOTE_LENGTH + 50))?.length, MAX_COURIER_NOTE_LENGTH);
});
check("courierNote reads the selected courier, '' when none", () => {
  assert.equal(courierNote({ note: " Pick-up: Malate " }), "Pick-up: Malate");
  assert.equal(courierNote({}), "");
  assert.equal(courierNote(null), "");
});

console.log("\n2. Checkout fields");

check("default keeps Email, required", () => {
  const email = checkoutFields({}).find((f) => f.key === "email");
  assert.ok(email?.required);
});
check("checkoutHideEmail drops Email and nothing else", () => {
  const all = checkoutFields({});
  const hidden = checkoutFields({ checkoutHideEmail: true });
  assert.equal(hidden.some((f) => f.key === "email"), false);
  assert.equal(hidden.length, all.length - 1);
});

console.log("\n3. Wiring guards");

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const cart = read("src/storefront/components/CartCheckout.tsx");
const admin = read("src/storefront/admin/AdminCouriers.tsx");
const action = read("src/actions/storefront-admin.ts");
const checkoutTs = read("src/storefront/checkout.ts");

check("checkout builds its fields from checkoutFields(brand)", () => {
  assert.ok(/checkoutFields\(brand\)/.test(cart));
});
check("checkout renders the selected courier's note", () => {
  assert.ok(/courierNote\(selectedCourier\)/.test(cart));
});
check("admin courier form edits the note and save persists it", () => {
  assert.ok(/setNote\(/.test(admin) && /note: note\.trim\(\)/.test(admin), "AdminCouriers has no note field");
  assert.ok(/cleanCourierNote\(o\.note\)/.test(action), "normalizeCouriers drops the note");
});
check("order message omits a blank Email line", () => {
  assert.ok(/customer\.email\.trim\(\) \? \[`Email: /.test(checkoutTs));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
