/**
 * Reproducer for combined-variant wholesale (MOQ) pricing.
 *
 * BUSINESS RULE (the target behavior, not today's):
 *   Wholesale MOQ + wholesale unit price are configured ONCE on the PARENT
 *   product. Every variation of that product shares them, and the quantities of
 *   all variations COMBINE toward the one MOQ. Once the combined quantity
 *   reaches the MOQ, the wholesale unit price applies to the whole quantity.
 *
 *     Vial Caps — retail ₱10, wholesale ₱7, MOQ 1,000
 *       Red 250 + Black 250 + Blue 250 + Yellow 250 = 1,000  →  all at ₱7
 *
 * TODAY THIS FAILS, for two independent reasons:
 *   1. `makeVariationEntry` (checkout.ts:95) deliberately sets `reseller:
 *      undefined` on the cloned cart entry, so a variation carries NO wholesale
 *      leg at all — it can never price at wholesale, at any quantity.
 *   2. Even with a leg, the MOQ is evaluated PER CART LINE (`unitPrice(p, qty)`
 *      takes the line's own qty). Four lines of 250 are each measured against
 *      1,000 and each falls short.
 *
 * The fix is a cart-level wholesale scope keyed by `baseProductId()` — the
 * parent product id that `variantOf` already carries end to end (cart entry →
 * checkout stamp → OrderItem.productId → server re-price).
 *
 * NOTE ON CONFIG SHAPE: this file expresses the wholesale rule through the
 * EXISTING `reseller` leg ({ completeSet, minQty }) because that is the only
 * shape the Product type carries today. The implementation introduces
 * `metadata.wholesale = { enabled, moq, price }` as the product-level source of
 * truth, read through a single `resolveWholesale()`; these cases are then
 * re-expressed against it. The BEHAVIOR asserted here does not change.
 *
 *   npx tsx scripts/test-wholesale-pricing.ts
 */

import assert from "node:assert";

import {
  cartLines,
  cartTotal,
  makeVariationEntry,
  unitPrice,
  type CartLine,
} from "../src/storefront/checkout";
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

function product(p: Partial<Product> & { id: string }): Product {
  return {
    name: "Product",
    description: "",
    price: 10,
    currency: "₱",
    category: "all",
    featured: false,
    image: null,
    stock: 100000,
    ...p,
  };
}

// ── The scenario ─────────────────────────────────────────────────────────────
// One parent product, four colour variations, one wholesale rule on the parent.
const VIAL_CAPS = product({
  id: "vial-caps",
  name: "Vial Caps",
  price: 10,
  reseller: { completeSet: 7, minQty: 1000 },
  variations: [
    { name: "Red", price: 10 },
    { name: "Black", price: 10 },
    { name: "Blue", price: 10 },
    { name: "Yellow", price: 10 },
  ],
});

// A second parent with its OWN, independent rule (§13).
const SYRINGES = product({
  id: "syringes",
  name: "Syringes",
  price: 5,
  reseller: { completeSet: 3.5, minQty: 500 },
});

/** The cart entry for one chosen colour, exactly as the storefront builds it. */
function pick(parent: Product, variation: string): Product {
  const v = (parent.variations ?? []).find((x) => x.name === variation);
  assert.ok(v, `no such variation: ${variation}`);
  return makeVariationEntry(parent, v);
}

/** A cart of { variation → qty } for one parent, as deduplicated cart lines. */
function cart(parent: Product, picks: Record<string, number>): CartLine[] {
  const flat: Product[] = [];
  for (const [name, qty] of Object.entries(picks)) {
    const entry = pick(parent, name);
    for (let i = 0; i < qty; i++) flat.push(entry);
  }
  return cartLines(flat);
}

// ── Control: the harness is sound ────────────────────────────────────────────
// A product with NO variations already prices at wholesale on a single line.
// This passes today and must keep passing — it proves any failure below is the
// combined-variant gap, not a broken fixture.

check("control: a single line of a no-variation product prices at wholesale", () => {
  assert.strictEqual(unitPrice(SYRINGES, 500), 3.5);
  assert.strictEqual(unitPrice(SYRINGES, 499), 5, "below MOQ stays retail");
});

// ── The bug: combined variant quantities must reach one parent MOQ ───────────

check("4 × 250 colours = 1,000 → every line prices at the ₱7 wholesale price", () => {
  const lines = cart(VIAL_CAPS, { Red: 250, Black: 250, Blue: 250, Yellow: 250 });
  assert.strictEqual(lines.length, 4, "one line per colour");
  for (const l of lines) {
    assert.strictEqual(
      unitPrice(l.product, l.qty),
      7,
      `${l.product.name} should price at wholesale (combined qty is 1,000)`,
    );
  }
});

check("4 × 250 colours = 1,000 → cart total is 1,000 × ₱7", () => {
  const lines = cart(VIAL_CAPS, { Red: 250, Black: 250, Blue: 250, Yellow: 250 });
  assert.strictEqual(cartTotal(lines), 7000);
});

check("uneven split still combines: 100 + 400 + 300 + 200 = 1,000 → ₱7", () => {
  const lines = cart(VIAL_CAPS, { Red: 100, Black: 400, Blue: 300, Yellow: 200 });
  assert.strictEqual(cartTotal(lines), 7000);
});

// ── §12: the MOQ is a floor, never a cap ─────────────────────────────────────

check("above MOQ: 1,250 combined units ALL price at ₱7 (not just the first 1,000)", () => {
  const lines = cart(VIAL_CAPS, { Red: 500, Black: 500, Blue: 250 });
  assert.strictEqual(cartTotal(lines), 1250 * 7);
});

// ── §13: parents are evaluated independently ─────────────────────────────────

check("below MOQ stays retail: 250 + 250 + 250 = 750 of 1,000", () => {
  const lines = cart(VIAL_CAPS, { Red: 250, Black: 250, Blue: 250 });
  assert.strictEqual(cartTotal(lines), 750 * 10, "750 short of the MOQ → retail");
});

check("quantities NEVER pool across different parent products", () => {
  // Vial Caps 800/1,000 and Syringes 300/500 — neither qualifies, and their
  // 1,100 combined units must not unlock either rule.
  const caps = cart(VIAL_CAPS, { Red: 400, Black: 400 });
  const syringes: CartLine[] = [{ product: SYRINGES, qty: 300 }];
  assert.strictEqual(cartTotal(caps), 800 * 10, "Vial Caps stays retail");
  assert.strictEqual(cartTotal(syringes), 300 * 5, "Syringes stays retail");
});

// ── Option A: bulk can never RAISE a per-unit price ──────────────────────────

check("a variation priced below the wholesale price keeps its cheaper price", () => {
  const mixed = product({
    ...VIAL_CAPS,
    id: "vial-caps-mixed",
    variations: [
      { name: "Red", price: 10 },
      { name: "Black", price: 10 },
      { name: "Yellow", price: 6 }, // already cheaper than the ₱7 wholesale price
    ],
  });
  const lines = cart(mixed, { Red: 400, Black: 400, Yellow: 200 });
  const priceOf = (name: string) => {
    const l = lines.find((x) => x.product.variantName === name);
    assert.ok(l, `missing line: ${name}`);
    return unitPrice(l.product, l.qty);
  };
  assert.strictEqual(priceOf("Red"), 7, "₱10 → ₱7");
  assert.strictEqual(priceOf("Black"), 7, "₱10 → ₱7");
  assert.strictEqual(priceOf("Yellow"), 6, "₱6 stays ₱6 — bulk must never raise a price");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
