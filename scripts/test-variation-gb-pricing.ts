/**
 * Per-variation group-buy pricing.
 *
 * THE BUG (found 2026-08-03, live on k-glow): `metadata.gbPrice` is a SINGLE
 * per-product number, but a product can carry many size variations. When a
 * customer picks an option, `makeVariationEntry` clones the catalog row with the
 * variation's own `price` — and, because it spreads `...product`, the clone kept
 * the BASE product's `gbPrice`. Inside a live round `unitPrice` then charged
 * that base group-buy price for every size.
 *
 * Live example on k-glow (22 products affected):
 *
 *     Retatrutide   base gbPrice ₱3,866 (the 5mg price)
 *       30mg option lists at ₱9,924  →  charged ₱3,866   (−₱6,058 per unit)
 *
 * `unitPrice`'s `Math.min` already stops the reverse error (a base gbPrice ABOVE
 * an option's price never RAISES the line), so only the undercharge direction is
 * live — but it is live on real money.
 *
 * THE FIX: variations carry their OWN optional `gbPrice`, exactly like the
 * existing opt-in `stock`. `makeVariationEntry` takes the variation's gbPrice
 * and, when the variation has none, CLEARS the inherited one rather than
 * reusing it — so an option with no group price sells at its own regular price.
 * That is the fail-safe direction: never cheaper than the seller listed.
 *
 * This also unblocks the Dragon Peptides import, whose sheet prices every size
 * twice (GB + on-hand) and so cannot be grouped into variations without it.
 *
 *   npm run test:variation-gb-pricing
 */

import assert from "node:assert";

import type { Product } from "../src/storefront/types";
import { makeVariationEntry, unitPrice } from "../src/storefront/checkout";
import { normalizeProductInput } from "../src/lib/storefront/product-input";
import { dbProductToStorefront, productToDbWrite } from "../src/lib/storefront/product-mapping";
import type { DbProductRow } from "../src/lib/storefront/product-mapping";

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

/** A live round covering the whole catalog — the scope that triggers gb pricing. */
const LIVE = { coversAll: true, productIds: [] as string[] };

/** Minimal group-buy product; only the fields the pricing path reads matter. */
const gbProduct = (over: Partial<Product> = {}): Product =>
  ({
    id: "p1",
    name: "Retatrutide",
    price: 3866,
    productType: "gb",
    gbPrice: 3866,
    variations: [],
    ...over,
  }) as Product;

console.log("\nPer-variation group-buy pricing\n");

// ───────────────────────── makeVariationEntry (the leak) ────────────────────
console.log("makeVariationEntry");

check("carries the variation's OWN gbPrice onto the cart entry", () => {
  const p = gbProduct({
    variations: [
      { name: "5mg", price: 3866, gbPrice: 3866 },
      { name: "30mg", price: 9924, gbPrice: 9924 },
    ],
  });
  const entry = makeVariationEntry(p, { name: "30mg", price: 9924, gbPrice: 9924 });
  assert.strictEqual(entry.gbPrice, 9924, `expected the 30mg gbPrice, got ${entry.gbPrice}`);
});

check("does NOT inherit the base gbPrice when the variation has none", () => {
  const p = gbProduct({ variations: [{ name: "30mg", price: 9924 }] });
  const entry = makeVariationEntry(p, { name: "30mg", price: 9924 });
  assert.ok(
    !entry.gbPrice,
    `variation with no group price must not inherit the base ₱3,866 — got ${entry.gbPrice}`,
  );
});

check("leaves the base product's own gbPrice untouched (no variation chosen)", () => {
  const p = gbProduct();
  assert.strictEqual(p.gbPrice, 3866);
  makeVariationEntry(p, { name: "30mg", price: 9924 });
  assert.strictEqual(p.gbPrice, 3866, "makeVariationEntry must not mutate its input");
});

// ─────────────────────────── unitPrice in a live round ──────────────────────
console.log("\nunitPrice — inside a live group-buy round");

check("THE LIVE BUG: k-glow Retatrutide 30mg no longer charges the 5mg price", () => {
  const p = gbProduct({ variations: [{ name: "30mg", price: 9924 }] });
  const entry = makeVariationEntry(p, { name: "30mg", price: 9924 });
  const charged = unitPrice(entry, 1, LIVE);
  assert.notStrictEqual(charged, 3866, "still charging the base 5mg group-buy price");
  assert.strictEqual(charged, 9924, `expected ₱9,924, charged ₱${charged}`);
});

check("an option WITH its own gbPrice is charged that price", () => {
  const p = gbProduct({ variations: [{ name: "30mg", price: 9924, gbPrice: 8500 }] });
  const entry = makeVariationEntry(p, { name: "30mg", price: 9924, gbPrice: 8500 });
  assert.strictEqual(unitPrice(entry, 1, LIVE), 8500);
});

check("an option with NO gbPrice falls back to its own regular price", () => {
  const p = gbProduct({ variations: [{ name: "10mg", price: 5000 }] });
  const entry = makeVariationEntry(p, { name: "10mg", price: 5000 });
  assert.strictEqual(unitPrice(entry, 1, LIVE), 5000);
});

check("a variation gbPrice ABOVE the option price never raises the line", () => {
  // Math.min already guarantees this for the base product; it must survive the
  // per-variation path too, or a mis-entered group price becomes an overcharge.
  const p = gbProduct({ variations: [{ name: "5 vials", price: 1940, gbPrice: 3866 }] });
  const entry = makeVariationEntry(p, { name: "5 vials", price: 1940, gbPrice: 3866 });
  assert.strictEqual(unitPrice(entry, 1, LIVE), 1940);
});

check("outside a live round the option pays its regular price", () => {
  const p = gbProduct({ variations: [{ name: "30mg", price: 9924, gbPrice: 8500 }] });
  const entry = makeVariationEntry(p, { name: "30mg", price: 9924, gbPrice: 8500 });
  assert.strictEqual(unitPrice(entry, 1, null), 9924);
});

check("the base product (no variation) keeps its own gbPrice", () => {
  const p = gbProduct({ variations: [{ name: "30mg", price: 9924, gbPrice: 9924 }] });
  assert.strictEqual(unitPrice(p, 1, LIVE), 3866);
});

check("a non-gb product ignores variation gbPrice entirely", () => {
  const p = gbProduct({
    productType: "onhand",
    gbPrice: 0,
    variations: [{ name: "30mg", price: 9924, gbPrice: 100 }],
  });
  const entry = makeVariationEntry(p, { name: "30mg", price: 9924, gbPrice: 100 });
  assert.strictEqual(unitPrice(entry, 1, LIVE), 9924);
});

// ───────────────────────── Dragon Peptides import shape ─────────────────────
console.log("\nDragon Peptides — every size priced twice (GB + on-hand)");

check("HXTNT Reta: each size is charged its own group-buy price", () => {
  // Sheet rows 130-137: on-hand = GB + ₱200 on every size.
  const reta = gbProduct({
    id: "reta",
    name: "HXTNT Reta",
    price: 565, // 5mg on-hand
    gbPrice: 365, // 5mg GB
    variations: [
      { name: "5mg", price: 565, gbPrice: 365 },
      { name: "10mg", price: 750, gbPrice: 550 },
      { name: "60mg", price: 1904, gbPrice: 1704 },
    ],
  });
  const cases: [string, number, number][] = [
    ["5mg", 565, 365],
    ["10mg", 750, 550],
    ["60mg", 1904, 1704],
  ];
  for (const [name, price, gb] of cases) {
    const entry = makeVariationEntry(reta, { name, price, gbPrice: gb });
    assert.strictEqual(unitPrice(entry, 1, LIVE), gb, `${name} in-round`);
    assert.strictEqual(unitPrice(entry, 1, null), price, `${name} out-of-round`);
  }
});

// ─────────────────────────── normalizeProductInput ──────────────────────────
console.log("\nnormalizeProductInput — the admin editor's boundary");

check("preserves a positive per-variation gbPrice", () => {
  const p = normalizeProductInput({
    name: "Reta",
    price: 565,
    productType: "gb",
    gbPrice: 365,
    variations: [{ name: "60mg", price: 1904, gbPrice: 1704 }],
  });
  assert.strictEqual(p.variations?.[0]?.gbPrice, 1704);
});

check("drops a blank / zero / negative variation gbPrice (no key persisted)", () => {
  for (const bad of ["", 0, -5, null, undefined]) {
    const p = normalizeProductInput({
      name: "Reta",
      price: 565,
      productType: "gb",
      variations: [{ name: "60mg", price: 1904, gbPrice: bad }],
    });
    assert.ok(
      !("gbPrice" in (p.variations![0] as object)),
      `gbPrice=${JSON.stringify(bad)} must not persist a key`,
    );
  }
});

check("still preserves the opt-in per-variation stock alongside gbPrice", () => {
  const p = normalizeProductInput({
    name: "Reta",
    price: 565,
    productType: "gb",
    variations: [{ name: "60mg", price: 1904, gbPrice: 1704, stock: 7 }],
  });
  assert.strictEqual(p.variations?.[0]?.stock, 7);
  assert.strictEqual(p.variations?.[0]?.gbPrice, 1704);
});

// ──────────────────────────── DB round-trip ─────────────────────────────────
console.log("\nDB round-trip — productToDbWrite → dbProductToStorefront");

const rowFrom = (write: ReturnType<typeof productToDbWrite>): DbProductRow => ({
  id: "reta",
  sku: "RETA",
  name: write.name,
  description: write.description,
  priceCents: write.priceCents,
  currency: write.currency,
  slug: "reta",
  images: write.images,
  stock: write.stock,
  status: write.status,
  active: write.active,
  metadata: write.metadata,
});

check("a per-variation gbPrice survives the write → read round-trip", () => {
  const input = normalizeProductInput({
    name: "HXTNT Reta",
    price: 565,
    productType: "gb",
    gbPrice: 365,
    variations: [
      { name: "5mg", price: 565, gbPrice: 365 },
      { name: "60mg", price: 1904, gbPrice: 1704 },
    ],
  });
  const back = dbProductToStorefront(rowFrom(productToDbWrite(input, "PHP", "₱")), "₱");
  assert.strictEqual(back.variations?.[1]?.gbPrice, 1704);
  assert.strictEqual(back.variations?.[1]?.price, 1904);
});

check("a variation with no gbPrice round-trips without the key", () => {
  const input = normalizeProductInput({
    name: "HXTNT Reta",
    price: 565,
    productType: "gb",
    gbPrice: 365,
    variations: [{ name: "60mg", price: 1904 }],
  });
  const back = dbProductToStorefront(rowFrom(productToDbWrite(input, "PHP", "₱")), "₱");
  assert.ok(!("gbPrice" in (back.variations![0] as object)), "empty gbPrice must not persist");
});

check("an on-hand product never persists variation gbPrice", () => {
  const input = normalizeProductInput({
    name: "Plain",
    price: 500,
    variations: [{ name: "60mg", price: 1904, gbPrice: 1704 }],
  });
  const write = productToDbWrite(input, "PHP", "₱");
  const vars = (write.metadata.variations ?? []) as { gbPrice?: number }[];
  assert.ok(!("gbPrice" in (vars[0] as object)), "on-hand product must not carry a group price");
});

// ────────────────────────────────── summary ─────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
