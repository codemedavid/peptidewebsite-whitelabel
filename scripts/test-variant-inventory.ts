/**
 * Self-contained test for PER-VARIATION inventory & availability.
 *
 * Before this, a product carried ONE `stock` integer and every variation shared
 * it. This feature gives each variation its own stock, with a FALLBACK rule so
 * existing data keeps working: a variation with no explicit `stock` still draws
 * from the base product's `stock` column; only a variation with a numeric
 * `stock` is tracked independently.
 *
 * Runs the REAL pure helpers (no DB, no React runtime):
 *
 *   - src/lib/storefront/inventory.ts
 *       variationStock / effectiveStock — the single "how many of this line are
 *           available" rule shared by the cart cap, the checkout stock guard,
 *           the deduction, and every display surface.
 *       applyVariationStock / applyStockMoveToProducts — order deduction &
 *           restock, per variation, immutable, clamped at zero.
 *       optionStock / isOptionOutOfStock / productOutOfStock — availability for
 *           the storefront card/modal option picker.
 *
 *   - src/lib/storefront/product-mapping.ts (round-trip preserves variation stock)
 *   - src/lib/storefront/product-detail.ts (modal exposes per-option availability)
 *   - src/actions/orders.ts (the checkout guard is wired to effectiveStock)
 *
 *   npm run test:variant-inventory
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Product, OrderItem } from "../src/storefront/types";
import {
  variationStock,
  effectiveStock,
  applyVariationStock,
  applyStockMoveToProducts,
  optionStock,
  isOptionOutOfStock,
  productOutOfStock,
} from "../src/lib/storefront/inventory";
import { buildProductOptions } from "../src/lib/storefront/variations";
import { dbProductToStorefront, productToDbWrite } from "../src/lib/storefront/product-mapping";
import { buildProductDetail } from "../src/lib/storefront/product-detail";

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

/** Minimal storefront product; only the fields under test matter. */
const P = (over: Partial<Product> = {}): Product =>
  ({
    id: "p1",
    name: "Tirzepatide",
    description: "",
    price: 1500,
    currency: "₱",
    category: "peptides",
    featured: false,
    image: null,
    stock: 10,
    ...over,
  }) as Product;

console.log("\nPer-variation inventory & availability\n");

// ─────────────────────────────── variationStock ─────────────────────────────
console.log("variationStock");

check("returns a variation's own stock when it is tracked", () => {
  const p = P({ variations: [{ name: "5mg", price: 1200, stock: 3 }] });
  assert.equal(variationStock(p, "5mg"), 3);
});

check("returns undefined for a variation with no stock (fallback to base)", () => {
  const p = P({ variations: [{ name: "5mg", price: 1200 }] });
  assert.equal(variationStock(p, "5mg"), undefined);
});

check("returns undefined when no variation name is asked for", () => {
  const p = P({ variations: [{ name: "5mg", price: 1200, stock: 3 }] });
  assert.equal(variationStock(p, undefined), undefined);
});

check("returns undefined when the named variation does not exist", () => {
  const p = P({ variations: [{ name: "5mg", price: 1200, stock: 3 }] });
  assert.equal(variationStock(p, "50mg"), undefined);
});

check("a tracked stock of 0 is still 'tracked' (0, not undefined)", () => {
  const p = P({ variations: [{ name: "5mg", price: 1200, stock: 0 }] });
  assert.equal(variationStock(p, "5mg"), 0);
});

// ─────────────────────────────── effectiveStock ─────────────────────────────
console.log("effectiveStock");

check("a tracked variation reports its OWN stock, not the base", () => {
  const p = P({ stock: 10, variations: [{ name: "5mg", price: 1200, stock: 3 }] });
  assert.equal(effectiveStock(p, "5mg"), 3);
});

check("a tracked variation at 0 is out even when the base column has stock", () => {
  const p = P({ stock: 99, variations: [{ name: "10mg", price: 2000, stock: 0 }] });
  assert.equal(effectiveStock(p, "10mg"), 0);
});

check("an untracked variation falls back to the base column", () => {
  const p = P({ stock: 7, variations: [{ name: "5mg", price: 1200 }] });
  assert.equal(effectiveStock(p, "5mg"), 7);
});

check("a line with no variation uses the base column", () => {
  assert.equal(effectiveStock(P({ stock: 4 }), undefined), 4);
});

check("negative / absent base stock clamps to 0", () => {
  assert.equal(effectiveStock(P({ stock: -3 }), undefined), 0);
  assert.equal(effectiveStock(P({ stock: undefined }), undefined), 0);
});

// ────────────────────────────── applyVariationStock ─────────────────────────
console.log("applyVariationStock");

check("deduct reduces only the named tracked variation", () => {
  const v = [
    { name: "5mg", price: 1200, stock: 3 },
    { name: "10mg", price: 2000, stock: 8 },
  ];
  assert.deepEqual(applyVariationStock(v, "5mg", -2), [
    { name: "5mg", price: 1200, stock: 1 },
    { name: "10mg", price: 2000, stock: 8 },
  ]);
});

check("restock increases the named variation", () => {
  const v = [{ name: "5mg", price: 1200, stock: 3 }];
  assert.deepEqual(applyVariationStock(v, "5mg", +5), [{ name: "5mg", price: 1200, stock: 8 }]);
});

check("deduction clamps at zero, never negative", () => {
  const v = [{ name: "5mg", price: 1200, stock: 1 }];
  assert.deepEqual(applyVariationStock(v, "5mg", -4), [{ name: "5mg", price: 1200, stock: 0 }]);
});

check("an untracked variation (no stock) is left untouched", () => {
  const v = [{ name: "5mg", price: 1200 }];
  assert.deepEqual(applyVariationStock(v, "5mg", -2), [{ name: "5mg", price: 1200 }]);
});

check("does not mutate the input array", () => {
  const v = [{ name: "5mg", price: 1200, stock: 3 }];
  const before = JSON.stringify(v);
  applyVariationStock(v, "5mg", -1);
  assert.equal(JSON.stringify(v), before);
});

// ────────────────────────── applyStockMoveToProducts ────────────────────────
// The pure deduction/restock engine (demo path + the shape the DB path mirrors).
console.log("applyStockMoveToProducts");

const ITEM = (over: Partial<OrderItem>): OrderItem => ({
  name: "Tirzepatide",
  qty: 1,
  price: 1500,
  productId: "p1",
  ...over,
});

check("deducting a tracked-variation line reduces that variation, not the base", () => {
  const p = P({
    stock: 10,
    variations: [
      { name: "5mg", price: 1200, stock: 3 },
      { name: "10mg", price: 2000, stock: 8 },
    ],
  });
  const [out] = applyStockMoveToProducts([p], [ITEM({ variation: "5mg", qty: 2 })], "deduct");
  assert.equal(out.stock, 10, "base column must be untouched for a tracked variation");
  assert.deepEqual(out.variations, [
    { name: "5mg", price: 1200, stock: 1 },
    { name: "10mg", price: 2000, stock: 8 },
  ]);
});

check("deducting a fallback-variation line reduces the base column", () => {
  const p = P({ stock: 10, variations: [{ name: "5mg", price: 1200 }] });
  const [out] = applyStockMoveToProducts([p], [ITEM({ variation: "5mg", qty: 3 })], "deduct");
  assert.equal(out.stock, 7, "an untracked variation shares the base column");
});

check("deducting a non-variation line reduces the base column", () => {
  const p = P({ stock: 5 });
  const [out] = applyStockMoveToProducts([p], [ITEM({ qty: 2 })], "deduct");
  assert.equal(out.stock, 3);
});

check("restock reverses a tracked-variation deduction", () => {
  const p = P({ variations: [{ name: "5mg", price: 1200, stock: 1 }] });
  const [out] = applyStockMoveToProducts([p], [ITEM({ variation: "5mg", qty: 4 })], "restock");
  assert.equal((out.variations ?? [])[0].stock, 5);
});

check("two lines for the same product hit their own pools independently", () => {
  const p = P({
    stock: 10,
    variations: [
      { name: "5mg", price: 1200, stock: 3 },
      { name: "10mg", price: 2000, stock: 8 },
    ],
  });
  const [out] = applyStockMoveToProducts(
    [p],
    [ITEM({ variation: "5mg", qty: 2 }), ITEM({ variation: "10mg", qty: 5 })],
    "deduct",
  );
  assert.deepEqual(out.variations, [
    { name: "5mg", price: 1200, stock: 1 },
    { name: "10mg", price: 2000, stock: 3 },
  ]);
  assert.equal(out.stock, 10);
});

check("does not mutate the input products", () => {
  const p = P({ variations: [{ name: "5mg", price: 1200, stock: 3 }] });
  const before = JSON.stringify(p);
  applyStockMoveToProducts([p], [ITEM({ variation: "5mg", qty: 1 })], "deduct");
  assert.equal(JSON.stringify(p), before);
});

// ──────────────── optionStock / isOptionOutOfStock / productOutOfStock ───────
console.log("availability helpers");

check("optionStock resolves each option through effectiveStock", () => {
  const p = P({
    stock: 4,
    variations: [
      { name: "5mg", price: 1200, stock: 0 },
      { name: "10mg", price: 2000 }, // fallback → base 4
    ],
  });
  const opts = buildProductOptions(p);
  const tracked = opts.find((o) => o.name === "5mg")!;
  const fallback = opts.find((o) => o.name === "10mg")!;
  assert.equal(optionStock(p, tracked), 0);
  assert.equal(optionStock(p, fallback), 4);
  assert.equal(isOptionOutOfStock(p, tracked), true);
  assert.equal(isOptionOutOfStock(p, fallback), false);
});

check("a no-variation product is out of stock exactly when the base is 0", () => {
  assert.equal(productOutOfStock(P({ stock: 0 })), true);
  assert.equal(productOutOfStock(P({ stock: 5 })), false);
});

check("a product with variations is out ONLY when every option is out", () => {
  const someLeft = P({
    stock: 0,
    variations: [
      { name: "5mg", price: 1200, stock: 0 },
      { name: "10mg", price: 2000, stock: 2 },
    ],
  });
  const allOut = P({
    stock: 0,
    variations: [
      { name: "5mg", price: 1200, stock: 0 },
      { name: "10mg", price: 2000, stock: 0 },
    ],
  });
  assert.equal(productOutOfStock(someLeft), false);
  assert.equal(productOutOfStock(allOut), true);
});

check("a tracked-0 option with a fallback sibling drawing on stock keeps the product buyable", () => {
  const p = P({
    stock: 6,
    variations: [
      { name: "5mg", price: 1200, stock: 0 }, // tracked, sold out
      { name: "10mg", price: 2000 }, // fallback → base 6, still available
    ],
  });
  assert.equal(productOutOfStock(p), false);
});

// ─────────────────────── mapping round-trip preserves stock ─────────────────
console.log("product-mapping round-trip");

check("productToDbWrite keeps a numeric variation stock", () => {
  const write = productToDbWrite(
    P({ variations: [{ name: "5mg", price: 1200, stock: 3 }] }),
    "PHP",
    "₱",
  );
  assert.deepEqual(write.metadata.variations, [{ name: "5mg", price: 1200, stock: 3 }]);
});

check("productToDbWrite does NOT inject stock onto an untracked variation", () => {
  const write = productToDbWrite(
    P({ variations: [{ name: "5mg", price: 1200 }] }),
    "PHP",
    "₱",
  );
  assert.deepEqual(write.metadata.variations, [{ name: "5mg", price: 1200 }]);
});

check("dbProductToStorefront reads a tracked variation stock back", () => {
  const row = {
    id: "p1",
    name: "Tirzepatide",
    description: null,
    priceCents: 150000,
    currency: "PHP",
    stock: 10,
    status: "active",
    images: [],
    metadata: { variations: [{ name: "5mg", price: 1200, stock: 3 }] },
  };
  const p = dbProductToStorefront(row as never, "₱");
  assert.deepEqual(p.variations, [{ name: "5mg", price: 1200, stock: 3 }]);
});

check("a persisted tracked stock of 0 survives the round-trip (not dropped)", () => {
  const write = productToDbWrite(
    P({ variations: [{ name: "5mg", price: 1200, stock: 0 }] }),
    "PHP",
    "₱",
  );
  assert.deepEqual(write.metadata.variations, [{ name: "5mg", price: 1200, stock: 0 }]);
});

// ─────────────────── product-detail modal per-option availability ───────────
console.log("buildProductDetail");

check("exposes per-option stock aligned to options", () => {
  const p = P({
    stock: 4,
    variations: [
      { name: "5mg", price: 1200, stock: 0 },
      { name: "10mg", price: 2000, stock: 2 },
    ],
  });
  const d = buildProductDetail(p);
  const idx5 = d.options.findIndex((o) => o.name === "5mg");
  const idx10 = d.options.findIndex((o) => o.name === "10mg");
  assert.equal(d.optionStock[idx5], 0);
  assert.equal(d.optionStock[idx10], 2);
});

check("outOfStock reflects all-options-out, not just the base column", () => {
  const someLeft = buildProductDetail(
    P({ stock: 0, variations: [{ name: "5mg", price: 1200, stock: 3 }] }),
  );
  const allOut = buildProductDetail(
    P({ stock: 0, variations: [{ name: "5mg", price: 1200, stock: 0 }] }),
  );
  assert.equal(someLeft.outOfStock, false, "a stocked variation keeps the product buyable");
  assert.equal(allOut.outOfStock, true);
});

// ─────────────────── the checkout guard is wired to effectiveStock ──────────
console.log("orders.ts wiring");

check("stockViolation resolves stock through effectiveStock (per-variant guard)", () => {
  const src = readFileSync(join(process.cwd(), "src/actions/orders.ts"), "utf8");
  assert.ok(
    /effectiveStock\s*\(/.test(src),
    "orders.ts never calls effectiveStock — the checkout guard still keys off the shared column",
  );
});

check("the deduction path uses the per-variation stock engine", () => {
  const src = readFileSync(join(process.cwd(), "src/actions/orders.ts"), "utf8");
  assert.ok(
    /applyStockMoveToProducts\s*\(/.test(src),
    "orders.ts demo deduction no longer uses applyStockMoveToProducts",
  );
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
