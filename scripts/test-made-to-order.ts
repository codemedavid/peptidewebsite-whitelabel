/**
 * MADE-TO-ORDER products — selling without an inventory.
 *
 * Grounding — the mstomato incident (tenant `mstomato`, found 2026-09-02): the
 * store sells vial cases and caps that are MANUFACTURED PER ORDER, so there is
 * no stock to count. Every one of its 21 products therefore sat at `stock = 0`
 * (17 of them `active`, carrying 1,233 untracked colourway variations between
 * them), and every layer of the inventory gate fired at once: the card badged
 * "Out of stock", the CTA read "Sold out" and was inert, all 81 option pills
 * struck through, addToCart refused, the cart drawer blocked and
 * placeStorefrontOrderAction rejected. The storefront could not take a single
 * order.
 *
 * The fix reuses the seam that already exists for GROUP-BUY PRE-ORDERS — an
 * item supplied AFTER the order is placed must never be gated by on-hand units
 * (see isGroupBuyPreorder in two-ways-cart, honoured by cartLineRoom,
 * cartStockViolations, store.tsx addToCart and orders.ts stockViolation).
 * A made-to-order product is structurally the same thing, so `effectiveStock`
 * answers Infinity for it and every gate downstream resolves correctly through
 * the one number they already share.
 *
 * What this suite locks:
 *   1. ENGINE     — effectiveStock is unbounded for a made-to-order line, and
 *                   untouched for every other product.
 *   2. DISPLAY    — it is never "Sold out", including the 81-variation shape
 *                   that is mstomato's actual catalog.
 *   3. CART       — it can always be added, and never blocks the cart.
 *   4. DEDUCTION  — confirming an order does not churn its stock column.
 *   5. PERSISTENCE— the flag survives the save pipeline, and (the trap this
 *                   file exists for) is NOT wiped by an ordinary admin save.
 *   6. ENTITLEMENT— fail-closed: an unentitled tenant's products gate exactly
 *                   as they do today, so no other store changes behaviour.
 *
 * Run:
 *   npm run test:made-to-order
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Product } from "../src/storefront/types";
import {
  isMadeToOrder,
  stripMadeToOrder,
} from "../src/lib/storefront/made-to-order";
import {
  applyStockMoveToProducts,
  availableUnits,
  cartLineRoom,
  cartStockViolations,
  effectiveStock,
  isOptionOutOfStock,
  productOutOfStock,
} from "../src/lib/storefront/inventory";
import { buildProductOptions } from "../src/lib/storefront/variations";
import { buildProductCta, CTA_COPY } from "../src/lib/storefront/product-cta";
import { normalizeProductInput } from "../src/lib/storefront/product-input";
import {
  dbProductToStorefront,
  productToDbWrite,
  type DbProductRow,
} from "../src/lib/storefront/product-mapping";

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
    name: "Single Vial Case – 3 mL",
    description: "",
    price: 350,
    currency: "₱",
    category: "cat_cases",
    featured: false,
    image: null,
    stock: 0,
    ...over,
  }) as Product;

/** mstomato's real catalog shape: a made-to-order product with many colourway
 *  variations, none of which track their own stock. */
const COLOURWAYS = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `Colour ${i + 1}`, price: 350 }));

const line = (product: Product, qty: number) => ({ product, qty });
const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

console.log("\nMade-to-order products\n");

// ══════════════════════════════ 1. ENGINE ═══════════════════════════════════
console.log("isMadeToOrder / effectiveStock");

check("isMadeToOrder is true only for an explicit true", () => {
  assert.equal(isMadeToOrder(P({ madeToOrder: true })), true);
  assert.equal(isMadeToOrder(P()), false);
  assert.equal(isMadeToOrder(P({ madeToOrder: false })), false);
  assert.equal(isMadeToOrder(undefined), false);
  assert.equal(isMadeToOrder(null), false);
});

check("a made-to-order line has unbounded stock even at a zero column", () => {
  assert.equal(effectiveStock(P({ madeToOrder: true, stock: 0 })), Infinity);
});

check("a made-to-order variation is unbounded too, tracked or not", () => {
  const p = P({
    madeToOrder: true,
    stock: 0,
    variations: [{ name: "Pink", price: 350 }, { name: "Blue", price: 350, stock: 0 }],
  });
  assert.equal(effectiveStock(p, "Pink"), Infinity);
  assert.equal(effectiveStock(p, "Blue"), Infinity);
});

check("an ordinary product's stock reading is completely unchanged", () => {
  assert.equal(effectiveStock(P({ stock: 7 })), 7);
  assert.equal(effectiveStock(P({ stock: 0 })), 0);
  const tracked = P({ stock: 9, variations: [{ name: "5mg", price: 1, stock: 3 }] });
  assert.equal(effectiveStock(tracked, "5mg"), 3);
});

// ═════════════════════════════ 2. DISPLAY ═══════════════════════════════════
console.log("\nAvailability — never 'Sold out'");

check("a made-to-order product with no stock is not out of stock", () => {
  assert.equal(productOutOfStock(P({ madeToOrder: true, stock: 0 })), false);
});

check("mstomato's real shape — 81 untracked colourways at stock 0 — stays buyable", () => {
  const p = P({ madeToOrder: true, stock: 0, variations: COLOURWAYS(81) });
  assert.equal(productOutOfStock(p), false);
  const options = buildProductOptions(p);
  assert.ok(options.length >= 81, `expected the colourways as options, got ${options.length}`);
  assert.equal(
    options.some((o) => isOptionOutOfStock(p, o)),
    false,
    "no colourway may render struck-through / '· out'",
  );
});

check("the same product WITHOUT the flag is still sold out (the bug today)", () => {
  const p = P({ stock: 0, variations: COLOURWAYS(81) });
  assert.equal(productOutOfStock(p), true);
  assert.equal(buildProductOptions(p).every((o) => isOptionOutOfStock(p, o)), true);
});

check("availableUnits reports unbounded rather than a misleading 0", () => {
  assert.equal(availableUnits(P({ madeToOrder: true, stock: 0 })), Infinity);
  assert.equal(availableUnits(P({ stock: 4 })), 4);
});

console.log("\nBuy controls (buildProductCta)");

check("a made-to-order product offers Add to Cart, enabled", () => {
  const cta = buildProductCta(P({ madeToOrder: true, stock: 0 }), -1);
  assert.equal(cta.ctaLabel, CTA_COPY.addToCart);
  assert.equal(cta.disabled, false);
  assert.equal(cta.priceLabel, null);
  assert.equal(cta.stock, Infinity, "the qty stepper must not be capped at 0");
});

check("a picked colourway is buyable", () => {
  const p = P({ madeToOrder: true, stock: 0, variations: COLOURWAYS(81) });
  const cta = buildProductCta(p, 0);
  assert.equal(cta.ctaLabel, CTA_COPY.addToCart);
  assert.equal(cta.disabled, false);
});

check("with options and none picked it still says Select an option, not Sold out", () => {
  const p = P({ madeToOrder: true, stock: 0, variations: COLOURWAYS(81) });
  const cta = buildProductCta(p, -1);
  assert.equal(cta.ctaLabel, CTA_COPY.selectOption);
});

check("a closed shop still beats made-to-order", () => {
  const cta = buildProductCta(P({ madeToOrder: true }), -1, { storeClosed: true });
  assert.equal(cta.ctaLabel, CTA_COPY.closed);
  assert.equal(cta.disabled, true);
});

check("an owner-paused product still beats made-to-order", () => {
  const cta = buildProductCta(P({ madeToOrder: true, purchasable: false }), -1);
  assert.equal(cta.ctaLabel, CTA_COPY.notAvailable);
  assert.equal(cta.disabled, true);
});

check("price-on-request still beats made-to-order", () => {
  const cta = buildProductCta(P({ madeToOrder: true, priceOnRequest: true }), -1);
  assert.equal(cta.ctaLabel, CTA_COPY.messageToOrder);
  assert.equal(cta.disabled, true);
});

// ═══════════════════════════════ 3. CART ════════════════════════════════════
console.log("\nCart gates");

check("cartLineRoom is unbounded — the '+' never locks", () => {
  assert.equal(cartLineRoom(line(P({ madeToOrder: true, stock: 0 }), 99)), Infinity);
});

check("a made-to-order line never blocks the cart", () => {
  assert.deepEqual(cartStockViolations([line(P({ madeToOrder: true, stock: 0 }), 250)]), []);
});

check("a normal sold-out line in the SAME cart still blocks", () => {
  const vs = cartStockViolations([
    line(P({ id: "mto", madeToOrder: true, stock: 0 }), 10),
    line(P({ id: "onhand", name: "Vial Topper", stock: 0 }), 1),
  ]);
  assert.equal(vs.length, 1);
  assert.equal(vs[0].productId, "onhand");
});

// ════════════════════════════ 4. DEDUCTION ══════════════════════════════════
console.log("\nStock movement on confirm");

check("confirming an order does not churn a made-to-order product's column", () => {
  const p = P({ id: "mto", madeToOrder: true, stock: 0 });
  const out = applyStockMoveToProducts([p], [{ name: p.name, qty: 5, price: 350, productId: "mto" }], "deduct");
  assert.equal(out[0], p, "the product object must come back untouched (same identity)");
});

check("a tracked made-to-order variation is not deducted either", () => {
  const p = P({
    id: "mto",
    madeToOrder: true,
    stock: 0,
    variations: [{ name: "Pink", price: 350, stock: 4 }],
  });
  const out = applyStockMoveToProducts(
    [p],
    [{ name: p.name, qty: 2, price: 350, productId: "mto", variation: "Pink" }],
    "deduct",
  );
  assert.equal(out[0].variations?.[0].stock, 4);
});

check("an ordinary product in the same batch still deducts", () => {
  const mto = P({ id: "mto", madeToOrder: true, stock: 0 });
  const normal = P({ id: "n", name: "Vial Topper", stock: 10 });
  const out = applyStockMoveToProducts(
    [mto, normal],
    [
      { name: mto.name, qty: 3, price: 350, productId: "mto" },
      { name: normal.name, qty: 3, price: 350, productId: "n" },
    ],
    "deduct",
  );
  assert.equal(out[0].stock, 0);
  assert.equal(out[1].stock, 7);
});

// ══════════════════════════ 5. PERSISTENCE ══════════════════════════════════
console.log("\nSave pipeline round-trip");

function roundTrip(input: Record<string, unknown>) {
  const write = productToDbWrite(normalizeProductInput(input), "PHP", "₱");
  const row: DbProductRow = {
    id: "prod_1",
    sku: "SKU",
    slug: "slug",
    name: write.name,
    description: write.description,
    priceCents: write.priceCents,
    currency: write.currency,
    images: write.images,
    stock: write.stock,
    status: write.status,
    active: write.active,
    metadata: write.metadata,
  };
  return {
    metadata: write.metadata as Record<string, unknown>,
    product: dbProductToStorefront(row, "₱"),
  };
}

check("madeToOrder:true survives the full save pipeline", () => {
  const out = roundTrip({ name: "Single Vial Case – 3 mL", madeToOrder: true });
  assert.equal(out.metadata.madeToOrder, true);
  assert.equal(out.product.madeToOrder, true);
});

check("a stocked product never persists a madeToOrder key", () => {
  assert.ok(!("madeToOrder" in roundTrip({ name: "Vial Topper", stock: 5 }).metadata));
});

check("editing a made-to-order product does not silently put it back on the stock gate", () => {
  // THE TRAP this file exists for. normalizeProductInput is what every admin
  // save funnels through; a client payload that omits the key must not be read
  // as "turn it off", or one unrelated edit in the product form would put all
  // 19 of mstomato's listings back to "Sold out" — the same regression class
  // that productClass and purchasable each already carry a guard for.
  const saved = dbProductToStorefront(
    {
      id: "p", sku: "s", slug: "s", name: "Single Vial Case – 3 mL", description: null,
      priceCents: 35000, currency: "PHP", images: [], stock: 0, status: "active",
      active: true, metadata: { madeToOrder: true, category: "cat_cases" },
    },
    "₱",
  );
  const resaved = productToDbWrite(normalizeProductInput({ ...saved }), "PHP", "₱");
  assert.equal((resaved.metadata as Record<string, unknown>).madeToOrder, true);
});

// ═════════════════════════ 6. ENTITLEMENT ═══════════════════════════════════
console.log("\nEntitlement — fail closed");

check("an unentitled tenant's products gate exactly as they do today", () => {
  const [p] = stripMadeToOrder([P({ madeToOrder: true, stock: 0 })], false);
  assert.equal(p.madeToOrder, undefined);
  assert.equal(productOutOfStock(p), true);
  assert.equal(effectiveStock(p), 0);
});

check("an entitled tenant keeps the flag", () => {
  const input = [P({ madeToOrder: true, stock: 0 })];
  const out = stripMadeToOrder(input, true);
  assert.equal(out[0].madeToOrder, true);
  assert.equal(out[0], input[0], "an entitled catalog must not be needlessly copied");
});

check("stripping leaves every other field alone", () => {
  const [p] = stripMadeToOrder([P({ madeToOrder: true, freeShipping: true, stock: 3 })], false);
  assert.equal(p.freeShipping, true);
  assert.equal(p.stock, 3);
});

// ═══════════════════════════ 7. WIRING ══════════════════════════════════════
// Source assertions, in the style of test-stock-gate: the engine can be right
// and the app still wrong if a call site is never made.
console.log("\nWiring");

check("placeStorefrontOrderAction strips the flag before its stock guard", () => {
  const s = src("src/actions/orders.ts");
  assert.match(s, /stripMadeToOrder\s*\(/, "orders.ts never calls stripMadeToOrder — an unentitled tenant could bypass its own inventory");
  assert.match(s, /STORE_MADE_TO_ORDER/);
});

check("the storefront resolves the entitlement server-side", () => {
  const s = src("src/app/(tenant)/(storefront)/storefront-home.tsx");
  assert.match(s, /STORE_MADE_TO_ORDER/);
  assert.match(s, /stripMadeToOrder\s*\(/);
});

check("the feature is registered and outside every plan ceiling", () => {
  const s = src("src/lib/features/catalog.ts");
  assert.match(s, /STORE_MADE_TO_ORDER:\s*"storefront\.made_to_order"/);
  assert.match(s, /OPERATOR_GRANTABLE[\s\S]*FEATURES\.STORE_MADE_TO_ORDER/);
  assert.ok(
    !/(?:^|\n)const (?:PRO|ENTERPRISE|STARTER)[\s\S]*?FEATURES\.STORE_MADE_TO_ORDER[\s\S]*?\n\];/.test(s),
    "made-to-order must not sit inside a plan ceiling — every existing tenant must be OFF on deploy",
  );
});

check("the owner's dashboard does not report made-to-order items as low stock", () => {
  const s = src("src/lib/storefront/admin-dashboard.ts");
  assert.match(s, /isMadeToOrder\s*\(/, "lowStockProducts would flag all 19 mstomato listings forever");
});

check("the store admin's Inventory screen labels them instead of 'Out of stock'", () => {
  const s = src("src/storefront/admin/AdminInventory.tsx");
  assert.match(s, /isMadeToOrder\s*\(/);
});

check("the product editor can set the flag", () => {
  const s = src("src/storefront/admin/AdminAddProduct.tsx");
  assert.match(s, /madeToOrder/);
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
