/**
 * The reseller MOQ rule at checkout — the server's answer to "can this cart buy
 * at the wholesale price?".
 *
 * The pricing side of MOQ is covered by test-wholesale-pricing.ts. This covers
 * the ORDER-LEVEL rejection: a reseller who edits their cart below the minimum
 * is told what to fix instead of being silently re-priced to retail.
 *
 *   npx tsx scripts/test-reseller-moq.ts
 */

import assert from "node:assert";

import { resellerMoqViolation } from "../src/lib/storefront/reseller-moq";
import type { Product } from "../src/storefront/types";

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

const product = (over: Partial<Product> & { id: string; name: string }): Product =>
  ({
    price: 1500,
    category: "peptides",
    currency: "₱",
    ...over,
  }) as Product;

// The acceptance-test product: retail ₱1,500, reseller ₱1,050, MOQ 10.
const TIRZ = product({
  id: "p-tirz",
  name: "Tirzepatide 30mg",
  price: 1500,
  wholesale: { enabled: true, moq: 10, price: 1050 },
});
// A product with no wholesale tier at all.
const LEMON = product({ id: "p-lemon", name: "Lemon Bottle", price: 900 });
// Two variations of one parent, sharing the parent's MOQ.
const VIAL_ONLY = product({
  id: "p-tirz-vial",
  name: "Tirzepatide 30mg — Vial only",
  variantOf: "p-tirz",
  price: 1400,
  wholesale: { enabled: true, moq: 10, price: 1050 },
});
const KIT = product({
  id: "p-tirz-kit",
  name: "Tirzepatide 30mg — Complete kit",
  variantOf: "p-tirz",
  price: 1550,
  wholesale: { enabled: true, moq: 10, price: 1050 },
});

const CATALOG = [TIRZ, LEMON, VIAL_ONLY, KIT];

console.log("\n── The acceptance case ────────────────────────────────────────");

check("10 units of an MOQ-10 product is accepted", () => {
  assert.equal(resellerMoqViolation([{ productId: "p-tirz", name: TIRZ.name, qty: 10 }], CATALOG), null);
});

check("9 units is rejected, and the message says how many more", () => {
  const msg = resellerMoqViolation([{ productId: "p-tirz", name: TIRZ.name, qty: 9 }], CATALOG);
  assert.ok(msg, "expected a rejection");
  assert.ok(msg.includes("10"), `expected the MOQ in the message: ${msg}`);
  assert.ok(msg.includes("Add 1 more"), `expected the shortfall in the message: ${msg}`);
});

check("more than the MOQ is accepted — the minimum is a floor, not a cap", () => {
  assert.equal(resellerMoqViolation([{ productId: "p-tirz", name: TIRZ.name, qty: 250 }], CATALOG), null);
});

console.log("\n── Products without reseller pricing ──────────────────────────");

check("a product with no wholesale tier is never blocked at any quantity", () => {
  // A reseller may still buy an ordinary retail item alongside their bulk order.
  assert.equal(resellerMoqViolation([{ productId: "p-lemon", name: LEMON.name, qty: 1 }], CATALOG), null);
});

check("an empty cart passes", () => {
  assert.equal(resellerMoqViolation([], CATALOG), null);
});

check("a line matching no live product is skipped, not rejected", () => {
  assert.equal(
    resellerMoqViolation([{ productId: "gone", name: "Deleted product", qty: 1 }], CATALOG),
    null,
  );
});

console.log("\n── Variations combine toward one MOQ ──────────────────────────");

check("6 vials + 4 kits = 10 units of one parent → accepted", () => {
  // The pricing engine pools variations by parent; the rejection must agree, or
  // a reseller who legitimately qualifies gets blocked at checkout.
  const msg = resellerMoqViolation(
    [
      { productId: "p-tirz-vial", name: VIAL_ONLY.name, qty: 6 },
      { productId: "p-tirz-kit", name: KIT.name, qty: 4 },
    ],
    CATALOG,
  );
  assert.equal(msg, null, `expected combined quantities to qualify, got: ${msg}`);
});

check("6 vials + 3 kits = 9 → still rejected", () => {
  assert.ok(
    resellerMoqViolation(
      [
        { productId: "p-tirz-vial", name: VIAL_ONLY.name, qty: 6 },
        { productId: "p-tirz-kit", name: KIT.name, qty: 3 },
      ],
      CATALOG,
    ),
  );
});

check("different products never pool toward each other's MOQ", () => {
  // 9 of one product plus 9 of another is not 18 units of anything.
  const other = product({
    id: "p-sema",
    name: "Semaglutide 10mg",
    wholesale: { enabled: true, moq: 10, price: 800 },
  });
  const msg = resellerMoqViolation(
    [
      { productId: "p-tirz", name: TIRZ.name, qty: 9 },
      { productId: "p-sema", name: other.name, qty: 9 },
    ],
    [...CATALOG, other],
  );
  assert.ok(msg, "expected a rejection — neither product reached its own MOQ");
});

console.log("\n── Legacy reseller legs ───────────────────────────────────────");

check("a legacy reseller leg's minQty is enforced too", () => {
  const legacy = product({
    id: "p-legacy",
    name: "Legacy Peptide",
    price: 2000,
    reseller: { completeSet: 1500, minQty: 25 },
  });
  assert.ok(resellerMoqViolation([{ productId: "p-legacy", name: legacy.name, qty: 24 }], [legacy]));
  assert.equal(
    resellerMoqViolation([{ productId: "p-legacy", name: legacy.name, qty: 25 }], [legacy]),
    null,
  );
});

check("lines are matched by name when no productId is sent", () => {
  assert.ok(resellerMoqViolation([{ name: TIRZ.name, qty: 2 }], CATALOG));
});

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
