/**
 * Self-contained test for always-live cart pricing. Runs the REAL pure pricing
 * core (no DB, no Next runtime, no browser) so a price the owner changes is
 * never frozen in a customer's cart, and the server re-prices authoritatively
 * at checkout.
 *
 *   - storefront/checkout.ts
 *       resolveLiveProduct(entry, catalog)   — re-hydrate a cart entry (incl. a
 *                                               variation) with the CURRENT
 *                                               catalog price; safe snapshot
 *                                               fallback when the row/variation
 *                                               no longer exists.
 *       liveCartLines(cart, catalog)         — grouped cart lines priced from
 *                                               the live catalog.
 *       authoritativeItemPrice(item, catalog)— the server's per-unit price for a
 *                                               stored OrderItem, recomputed from
 *                                               the catalog (null = unmatched →
 *                                               caller keeps the client price).
 *
 *   npm run test:cart
 */

import assert from "node:assert";

import {
  resolveLiveProduct,
  liveCartLines,
  authoritativeItemPrice,
  cartTotal,
  makeVariationEntry,
  unitPrice,
} from "../src/storefront/checkout";
import type { Product } from "../src/storefront/types";

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

// ──────────────────────────── product factory ───────────────────────────────
function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "BPC-157",
    description: "",
    price: 100,
    currency: "₱",
    category: "peptides",
    featured: false,
    image: null,
    stock: 50,
    ...over,
  };
}

console.log("\nAlways-live cart pricing — pure core\n");

// ─────────────────────────── resolveLiveProduct ─────────────────────────────
console.log("resolveLiveProduct");

check("plain product: price raised in catalog is reflected", () => {
  const stale = product({ price: 100 });
  const catalog = [product({ price: 250 })];
  assert.equal(resolveLiveProduct(stale, catalog).price, 250);
});

check("plain product: price lowered in catalog is reflected", () => {
  const stale = product({ price: 100 });
  const catalog = [product({ price: 40 })];
  assert.equal(resolveLiveProduct(stale, catalog).price, 40);
});

check("plain product: live discount toggle is reflected", () => {
  const stale = product({ discountEnabled: false, discountPrice: 0 });
  const catalog = [product({ discountEnabled: true, discountPrice: 75 })];
  const live = resolveLiveProduct(stale, catalog);
  assert.equal(live.discountEnabled, true);
  assert.equal(live.discountPrice, 75);
  // and the effective unit price follows the discount
  assert.equal(unitPrice(live, 1), 75);
});

check("plain product: live reseller tier change is reflected", () => {
  const stale = product({ reseller: undefined });
  const catalog = [product({ reseller: { completeSet: 60, minQty: 10 } })];
  const live = resolveLiveProduct(stale, catalog);
  assert.deepEqual(live.reseller, { completeSet: 60, minQty: 10 });
  // bulk qty now gets the wholesale price
  assert.equal(unitPrice(live, 10), 60);
});

check("variation: current variation price is re-read from the live product", () => {
  // customer added "10mg" at 120; owner repriced it to 180
  const stale = makeVariationEntry(product(), { name: "10mg", price: 120 });
  const catalog = [
    product({
      variations: [
        { name: "5mg", price: 90 },
        { name: "10mg", price: 180 },
      ],
    }),
  ];
  const live = resolveLiveProduct(stale, catalog);
  assert.equal(live.price, 180);
  assert.equal(live.variantName, "10mg");
  assert.equal(live.variantOf, "p1");
  assert.equal(live.id, "p1::10mg"); // composite id preserved → cart grouping stays stable
});

check("fallback: archived/deleted product keeps the snapshot price (no crash)", () => {
  const stale = product({ id: "gone", price: 100 });
  const catalog = [product({ id: "other", price: 999 })];
  assert.equal(resolveLiveProduct(stale, catalog).price, 100);
});

check("fallback: removed variation keeps the snapshot price", () => {
  const stale = makeVariationEntry(product(), { name: "10mg", price: 120 });
  const catalog = [product({ variations: [{ name: "5mg", price: 90 }] })];
  // "10mg" no longer offered — never re-price to the wrong option
  assert.equal(resolveLiveProduct(stale, catalog).price, 120);
});

// ─────────────────────────────── liveCartLines ──────────────────────────────
console.log("liveCartLines");

check("totals are computed from the live catalog, not the stale cart", () => {
  // two stale units in the cart at 100 each
  const cart = [product({ price: 100 }), product({ price: 100 })];
  const catalog = [product({ price: 250 })];
  const lines = liveCartLines(cart, catalog);
  assert.equal(lines.length, 1, "same product groups into one line");
  assert.equal(lines[0].qty, 2, "quantity preserved");
  assert.equal(cartTotal(lines), 500, "2 × live 250");
});

check("a variation line and its base product stay distinct lines", () => {
  const base = product();
  const variant = makeVariationEntry(base, { name: "10mg", price: 120 });
  const cart = [base, variant];
  const catalog = [
    product({ price: 100, variations: [{ name: "10mg", price: 180 }] }),
  ];
  const lines = liveCartLines(cart, catalog);
  assert.equal(lines.length, 2);
  const variantLine = lines.find((l) => l.product.variantName === "10mg");
  assert.equal(variantLine?.product.price, 180, "variation re-priced live");
});

// ──────────────────────────── authoritativeItemPrice ────────────────────────
console.log("authoritativeItemPrice (server re-pricing)");

check("ignores the client price and returns the catalog price", () => {
  const item = { productId: "p1", name: "BPC-157", qty: 1, price: 10 };
  const catalog = [product({ id: "p1", price: 200 })];
  assert.equal(authoritativeItemPrice(item, catalog), 200);
});

check("matches by name when productId is absent (legacy line)", () => {
  const item = { name: "BPC-157", qty: 1, price: 10 };
  const catalog = [product({ id: "p1", name: "BPC-157", price: 175 })];
  assert.equal(authoritativeItemPrice(item, catalog), 175);
});

check("re-reads the live variation price (matched by base id + label)", () => {
  // client stamps productId = base id, variation = label
  const item = { productId: "p1", name: "BPC-157 — 10mg", qty: 1, price: 10, variation: "10mg" };
  const catalog = [
    product({ id: "p1", variations: [{ name: "10mg", price: 220 }] }),
  ];
  assert.equal(authoritativeItemPrice(item, catalog), 220);
});

check("applies the live reseller wholesale price at bulk qty", () => {
  const item = { productId: "p1", name: "BPC-157", qty: 10, price: 100 };
  const catalog = [product({ id: "p1", price: 100, reseller: { completeSet: 60, minQty: 10 } })];
  assert.equal(authoritativeItemPrice(item, catalog), 60);
});

check("returns null for an unmatched product so the caller keeps the client price", () => {
  const item = { productId: "gone", name: "Ghost", qty: 1, price: 33 };
  const catalog = [product({ id: "p1" })];
  assert.equal(authoritativeItemPrice(item, catalog), null);
});

check("returns null when the variation no longer exists", () => {
  const item = { productId: "p1", name: "BPC-157 — 10mg", qty: 1, price: 120, variation: "10mg" };
  const catalog = [product({ id: "p1", variations: [{ name: "5mg", price: 90 }] })];
  assert.equal(authoritativeItemPrice(item, catalog), null);
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
