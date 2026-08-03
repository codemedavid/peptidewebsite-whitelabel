/**
 * Out-of-stock GATE — the "double prevention" suite.
 *
 * Stock enforcement has three layers, and this suite proves all three agree:
 *
 *   1. TAG      — a sold-out product reads "Out of stock" wherever it is listed
 *                 (catalog card, product detail, two-ways home shelf).
 *   2. ADD      — it cannot be put in the cart (store.tsx addToCart cap).
 *   3. CHECKOUT — an item that sells out WHILE IT SITS IN THE CART blocks the
 *                 checkout, in the cart drawer AND again server-side at
 *                 placement (orders.ts stockViolation).
 *
 * Layers 1 and 2 already existed; this suite locks them and covers the gaps:
 *   - cartStockViolations — the cart-drawer gate (layer 3, client half)
 *   - availableUnits      — honest unit counts once variations track their own
 *                           stock, so the two-ways shelf stops reading the base
 *                           column alone (it hid stocked doses and advertised
 *                           sold-out ones)
 *
 * Group-buy PRE-ORDERS stay exempt throughout: the supplier order is placed
 * after the round closes, so on-hand stock must never gate them.
 *
 * Run:
 *   npm run test:stock-gate
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Product } from "../src/storefront/types";
import {
  availableUnits,
  cartStockViolations,
  productOutOfStock,
} from "../src/lib/storefront/inventory";
import { makeVariationEntry } from "../src/storefront/checkout";
import { buildTwoWaysHomeView } from "../src/lib/storefront/two-ways-home";
import type { GroupBuyPriceScope } from "../src/lib/storefront/two-ways";

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

const line = (product: Product, qty: number) => ({ product, qty });

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

console.log("\nOut-of-stock gate\n");

// ══════════════════════════ cartStockViolations ═════════════════════════════
// The cart-drawer half of layer 3. Mirrors orders.ts stockViolation so the
// customer is told in the CART, not after they have filled in an address and
// uploaded a payment proof.
console.log("cartStockViolations — the cart gate");

check("an empty cart has no violations", () => {
  assert.deepEqual(cartStockViolations([]), []);
});

check("a line within stock passes", () => {
  assert.deepEqual(cartStockViolations([line(P({ stock: 5 }), 3)]), []);
});

check("a line at exactly the available stock passes (boundary)", () => {
  assert.deepEqual(cartStockViolations([line(P({ stock: 3 }), 3)]), []);
});

check("a line asking for more than stock is a BLOCKING violation", () => {
  const [v] = cartStockViolations([line(P({ stock: 2 }), 3)]);
  assert.ok(v, "expected a violation");
  assert.equal(v.rule, "stock");
  assert.equal(v.blocking, true);
});

check("a partially-stocked line names the remaining count and the cart qty", () => {
  const [v] = cartStockViolations([line(P({ name: "Reta", stock: 2 }), 5)]);
  assert.match(v.message, /Only 2/);
  assert.match(v.message, /Reta/);
  assert.match(v.message, /5/, "the message should say how many are in the cart");
});

check("a sold-out line reads as out of stock, not 'only 0 left'", () => {
  const [v] = cartStockViolations([line(P({ name: "Reta", stock: 0 }), 1)]);
  assert.match(v.message, /out of stock/i);
  assert.doesNotMatch(v.message, /Only 0/);
});

check("EVERY offending line is reported, not just the first", () => {
  const vs = cartStockViolations([
    line(P({ id: "a", name: "A", stock: 0 }), 1),
    line(P({ id: "b", name: "B", stock: 9 }), 1),
    line(P({ id: "c", name: "C", stock: 1 }), 4),
  ]);
  assert.equal(vs.length, 2, "the customer should see both bad lines at once");
  assert.deepEqual(
    vs.map((v) => v.productId),
    ["a", "c"],
  );
});

check("a missing stock column reads as zero available (fails closed)", () => {
  const [v] = cartStockViolations([line(P({ stock: undefined }), 1)]);
  assert.ok(v, "a product with no stock number must not be silently sellable");
});

// ── per-variation pools ──────────────────────────────────────────────────────
// The bug this closes: a cart line for a TRACKED variation was checked against
// the base column, so a sold-out dose stayed buyable while the product's shared
// column was positive.
console.log("cartStockViolations — per-variation pools");

check("a tracked variation is checked against its OWN pool, not the base column", () => {
  const p = P({
    stock: 9, // plenty on the base column …
    variations: [
      { name: "5mg", price: 1200, stock: 0 }, // … but this dose is sold out
      { name: "10mg", price: 1800, stock: 4 },
    ],
  });
  const entry = makeVariationEntry(p, { name: "5mg", price: 1200 });
  const [v] = cartStockViolations([line(entry, 1)]);
  assert.ok(v, "a sold-out dose must block even when the base column is stocked");
  assert.match(v.message, /out of stock/i);
});

check("a stocked variation passes while a sibling dose is sold out", () => {
  const p = P({
    stock: 0, // base column empty …
    variations: [
      { name: "5mg", price: 1200, stock: 0 },
      { name: "10mg", price: 1800, stock: 4 }, // … but this dose has stock
    ],
  });
  const entry = makeVariationEntry(p, { name: "10mg", price: 1800 });
  assert.deepEqual(cartStockViolations([line(entry, 4)]), []);
});

check("a tracked variation caps at its own count", () => {
  const p = P({ stock: 99, variations: [{ name: "10mg", price: 1800, stock: 4 }] });
  const entry = makeVariationEntry(p, { name: "10mg", price: 1800 });
  const [v] = cartStockViolations([line(entry, 5)]);
  assert.match(v.message, /Only 4/);
});

check("an UNTRACKED variation still falls back to the base column", () => {
  const p = P({ stock: 2, variations: [{ name: "5mg", price: 1200 }] });
  const entry = makeVariationEntry(p, { name: "5mg", price: 1200 });
  const [v] = cartStockViolations([line(entry, 3)]);
  assert.match(v.message, /Only 2/);
});

check("the violation names the dose the customer actually picked", () => {
  const p = P({
    name: "Tirzepatide",
    stock: 0,
    variations: [{ name: "5mg", price: 1200, stock: 0 }],
  });
  const entry = makeVariationEntry(p, { name: "5mg", price: 1200 });
  const [v] = cartStockViolations([line(entry, 1)]);
  assert.match(v.message, /5mg/, "a bare product name can't tell two doses apart");
});

check("a violation reports the BASE product id, so the cart can find the line", () => {
  const p = P({ id: "prod-1", stock: 0, variations: [{ name: "5mg", price: 1200, stock: 0 }] });
  const entry = makeVariationEntry(p, { name: "5mg", price: 1200 });
  const [v] = cartStockViolations([line(entry, 1)]);
  assert.equal(v.productId, "prod-1");
});

// ── group-buy pre-orders stay exempt ─────────────────────────────────────────
// Mirrors store.tsx addToCart and orders.ts stockViolation: a round's products
// are ordered from the supplier after it closes, so stock-0 is normal for them.
console.log("cartStockViolations — group-buy pre-order exemption");

const ASSIGNED: GroupBuyPriceScope = { coversAll: false, productIds: ["gb-1"] };
const COVERS_ALL: GroupBuyPriceScope = { coversAll: true, productIds: [] };

check("a product assigned to the live round is exempt from the stock cap", () => {
  const p = P({ id: "gb-1", stock: 0 });
  assert.deepEqual(cartStockViolations([line(p, 10)], ASSIGNED), []);
});

check("a product OUTSIDE the live round is still capped", () => {
  const p = P({ id: "other", stock: 0 });
  assert.equal(cartStockViolations([line(p, 1)], ASSIGNED).length, 1);
});

check("under a coversAll round only gb-TAGGED products are exempt", () => {
  const tagged = P({ id: "x", stock: 0, productType: "gb" } as Partial<Product>);
  const onHand = P({ id: "y", stock: 0, productType: "onhand" } as Partial<Product>);
  assert.deepEqual(cartStockViolations([line(tagged, 5)], COVERS_ALL), []);
  assert.equal(
    cartStockViolations([line(onHand, 1)], COVERS_ALL).length,
    1,
    "a catalog-wide round must not switch off stock for genuinely on-hand goods",
  );
});

check("with no live round nothing is exempt", () => {
  const p = P({ id: "gb-1", stock: 0, productType: "gb" } as Partial<Product>);
  assert.equal(cartStockViolations([line(p, 1)], null).length, 1);
});

check("a variation of an assigned round product is exempt too", () => {
  const p = P({ id: "gb-1", stock: 0, variations: [{ name: "5mg", price: 1200, stock: 0 }] });
  const entry = makeVariationEntry(p, { name: "5mg", price: 1200 });
  assert.deepEqual(cartStockViolations([line(entry, 3)], ASSIGNED), []);
});

// ══════════════════════════════ availableUnits ══════════════════════════════
// One honest "how many can I sell right now" across the pools a product has:
// the shared base column plus every independently-tracked variation.
console.log("availableUnits");

check("a plain product reports its base column", () => {
  assert.equal(availableUnits(P({ stock: 12 })), 12);
});

check("a negative or missing base column clamps to zero", () => {
  assert.equal(availableUnits(P({ stock: -4 })), 0);
  assert.equal(availableUnits(P({ stock: undefined })), 0);
});

check("untracked variations share the base column — counted once, not per option", () => {
  const p = P({
    stock: 6,
    variations: [
      { name: "5mg", price: 1200 },
      { name: "10mg", price: 1800 },
    ],
  });
  assert.equal(availableUnits(p), 6, "two untracked options must not read as 12");
});

check("tracked variations sum their own pools", () => {
  const p = P({
    price: 1200, // equals a variation price → no distinct "Standard" option
    stock: 99, // the base column is not sellable when every option is tracked
    variations: [
      { name: "5mg", price: 1200, stock: 3 },
      { name: "10mg", price: 1800, stock: 4 },
    ],
  });
  assert.equal(availableUnits(p), 7);
});

check("a distinct base price is its own sellable pool, added to the tracked ones", () => {
  const p = P({
    price: 1500, // distinct → buildProductOptions offers "Standard"
    stock: 2,
    variations: [{ name: "5mg", price: 1200, stock: 3 }],
  });
  assert.equal(availableUnits(p), 5);
});

check("a mix of tracked and untracked options counts the base column once", () => {
  const p = P({
    price: 1200, // no distinct "Standard"
    stock: 2,
    variations: [
      { name: "5mg", price: 1200, stock: 3 }, // own pool
      { name: "10mg", price: 1800 }, // falls back to the base column
    ],
  });
  assert.equal(availableUnits(p), 5);
});

check("availableUnits is zero exactly when the product is out of stock", () => {
  const allOut = P({
    price: 1200,
    stock: 0,
    variations: [
      { name: "5mg", price: 1200, stock: 0 },
      { name: "10mg", price: 1800, stock: 0 },
    ],
  });
  assert.equal(availableUnits(allOut), 0);
  assert.equal(productOutOfStock(allOut), true);
});

// ═══════════════════ two-ways home shelf reads real availability ════════════
// The shelf used to read product.stock alone, so it HID products whose doses
// were stocked (base column 0) and ADVERTISED products whose doses were all
// sold out (base column positive).
console.log("two-ways home — shelf availability");

const shelf = (products: Product[]) => buildTwoWaysHomeView(products, null, "₱");

check("a product with a stocked dose is buyable even when the base column is 0", () => {
  const p = P({
    price: 1200,
    stock: 0,
    variations: [{ name: "10mg", price: 1800, stock: 4 }],
  });
  const [l] = shelf([p]).onHand.lines;
  assert.equal(l.inStock, true, "a stocked dose must not be hidden by an empty base column");
  assert.equal(l.stockLabel, "4 in stock");
});

check("a product whose every dose is sold out reads Out of stock", () => {
  const p = P({
    price: 1200,
    stock: 7, // a stale/shared base column …
    variations: [
      { name: "5mg", price: 1200, stock: 0 },
      { name: "10mg", price: 1800, stock: 0 },
    ],
  });
  const [l] = shelf([p]).onHand.lines;
  assert.equal(l.inStock, false, "… must not advertise 7 units nobody can buy");
});

check("a plain product is unchanged (base column drives the label)", () => {
  const [l] = shelf([P({ stock: 12, variations: undefined })]).onHand.lines;
  assert.equal(l.inStock, true);
  assert.equal(l.stockLabel, "12 in stock");
});

check("a plain product at zero is unchanged", () => {
  const [l] = shelf([P({ stock: 0, variations: undefined })]).onHand.lines;
  assert.equal(l.inStock, false);
  assert.equal(l.stockLabel, "0 in stock");
});

check("a product carrying no stock number at all stays buyable (unknown ≠ sold out)", () => {
  const [l] = shelf([P({ stock: undefined, variations: undefined })]).onHand.lines;
  assert.equal(l.inStock, true);
  assert.equal(l.stockLabel, "", "no number to show");
});

// ══════════════════ the gate is actually WIRED to the surfaces ══════════════
// Pure helpers prove nothing if no surface calls them. These anchors fail the
// suite the moment a refactor unhooks a layer.
console.log("wiring anchors");

check("the cart drawer merges stock violations into its blocking list", () => {
  const s = src("src/storefront/components/CartCheckout.tsx");
  assert.match(
    s,
    /cartStockViolations\s*\(/,
    "CartCheckout never calls cartStockViolations — the cart still lets sold-out lines through to the details step",
  );
});

check("the cart's re-add button passes the chosen variation", () => {
  const s = src("src/storefront/components/CartCheckout.tsx");
  assert.doesNotMatch(
    s,
    /onClick=\{\(\)\s*=>\s*addToCart\(l\.product\)\}/,
    "the '+' button re-adds a variation clone with no variation argument, so the cap reads the BASE column and a sold-out dose can be incremented",
  );
});

check("the two-ways shelf resolves availability through the inventory module", () => {
  const s = src("src/lib/storefront/two-ways-home.ts");
  assert.match(
    s,
    /from "\.\/inventory"/,
    "two-ways-home still reads product.stock directly instead of the shared availability rules",
  );
});

check("the server still re-checks stock at placement (the real boundary)", () => {
  const s = src("src/actions/orders.ts");
  assert.match(s, /stockViolation\s*\(/);
  assert.match(s, /effectiveStock\s*\(/);
});

// ──────────────────────────────── summary ───────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
