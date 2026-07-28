/**
 * Self-contained test for the PRODUCT CARD call-to-action state + the card's
 * responsive buy row.
 *
 * Two defects this locks down:
 *
 *  1. A product whose variations are ALL out of stock still asked the customer
 *     to "Select an option" — the card carried an "Out of stock" badge and
 *     struck-through, sold-out pills, and then a big primary button inviting a
 *     choice that could not be made. It must read as sold out.
 *
 *  2. The CTA label is variable-length ("Select an option", "Available after
 *     group buy") but `.btn` is `white-space: nowrap` and the CTA was
 *     `flex: 1` with the default `min-width: auto` — so it could not shrink or
 *     wrap, the buy row overflowed the card, and `.card { overflow: hidden }`
 *     clipped the button in half on phone-width cards.
 *
 * Runs the REAL pure helper (no DB, no React runtime) and asserts the CSS +
 * component wiring that carries it to screen:
 *
 *   - src/lib/storefront/product-cta.ts  — buildProductCta, the single source of
 *       truth for the price-slot label, the button label, and whether buying is
 *       blocked. Shared by the catalog card and the quick-view modal so the two
 *       can never disagree.
 *   - src/storefront/storefront.css      — the buy row shrinks/wraps in place
 *   - src/storefront/components/Catalog.tsx — card + modal read the helper
 *
 *   npm run test:product-cta
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Product } from "../src/storefront/types";
import { buildProductCta } from "../src/lib/storefront/product-cta";

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
    name: "Semax",
    description: "",
    price: 0,
    currency: "₱",
    category: "peptides",
    featured: false,
    image: null,
    stock: 10,
    ...over,
  }) as Product;

const root = join(__dirname, "..");
const css = readFileSync(join(root, "src/storefront/storefront.css"), "utf8");
const catalog = readFileSync(
  join(root, "src/storefront/components/Catalog.tsx"),
  "utf8",
);

console.log("\nProduct card CTA state\n");

// ── 1. every variation sold out → the card reads sold out, not "pick one" ────
check("all variations out of stock → CTA says Sold out (not Select an option)", () => {
  const p = P({
    price: 0,
    variations: [
      { name: "5mg", price: 1200, stock: 0 },
      { name: "10mg", price: 2100, stock: 0 },
    ],
  });
  const cta = buildProductCta(p, -1);
  assert.equal(cta.ctaLabel, "Sold out");
  assert.notEqual(cta.ctaLabel, "Select an option");
  assert.equal(cta.disabled, true);
});

check("all variations out of stock → price slot says Sold out too", () => {
  const p = P({
    price: 0,
    variations: [
      { name: "5mg", price: 1200, stock: 0 },
      { name: "10mg", price: 2100, stock: 0 },
    ],
  });
  assert.equal(buildProductCta(p, -1).priceLabel, "Sold out");
});

check("sold out wins even after the customer clicks a (dead) option pill", () => {
  const p = P({
    price: 0,
    variations: [
      { name: "5mg", price: 1200, stock: 0 },
      { name: "10mg", price: 2100, stock: 0 },
    ],
  });
  assert.equal(buildProductCta(p, 1).ctaLabel, "Sold out");
  assert.equal(buildProductCta(p, 1).disabled, true);
});

// ── 2. one stocked option keeps the product buyable ─────────────────────────
check("one stocked option → still asks for a selection", () => {
  const p = P({
    price: 0,
    variations: [
      { name: "5mg", price: 1200, stock: 0 },
      { name: "10mg", price: 2100, stock: 4 },
    ],
  });
  const cta = buildProductCta(p, -1);
  assert.equal(cta.ctaLabel, "Select an option");
  assert.equal(cta.priceLabel, "Select an option");
  assert.equal(cta.disabled, true);
});

check("picking the stocked option → Add to Cart, real price, enabled", () => {
  const p = P({
    price: 0,
    variations: [
      { name: "5mg", price: 1200, stock: 0 },
      { name: "10mg", price: 2100, stock: 4 },
    ],
  });
  const cta = buildProductCta(p, 1);
  assert.equal(cta.ctaLabel, "Add to Cart");
  assert.equal(cta.priceLabel, null);
  assert.equal(cta.disabled, false);
  assert.equal(cta.stock, 4);
});

check("picking a sold-out option while others remain → Sold out, price still shown", () => {
  const p = P({
    price: 0,
    variations: [
      { name: "5mg", price: 1200, stock: 0 },
      { name: "10mg", price: 2100, stock: 4 },
    ],
  });
  const cta = buildProductCta(p, 0);
  assert.equal(cta.ctaLabel, "Sold out");
  assert.equal(cta.priceLabel, null, "the chosen option's price stays visible");
  assert.equal(cta.disabled, true);
  assert.equal(cta.stock, 0);
});

// ── 3. single-price products are unchanged apart from the unified wording ───
check("single-price product in stock → Add to Cart", () => {
  const cta = buildProductCta(P({ price: 1799, stock: 3 }), -1);
  assert.equal(cta.ctaLabel, "Add to Cart");
  assert.equal(cta.priceLabel, null);
  assert.equal(cta.disabled, false);
  assert.equal(cta.stock, 3);
});

check("single-price product at zero stock → Sold out", () => {
  const cta = buildProductCta(P({ price: 1799, stock: 0 }), -1);
  assert.equal(cta.ctaLabel, "Sold out");
  assert.equal(cta.priceLabel, "Sold out");
  assert.equal(cta.disabled, true);
});

// ── 4. price-on-request and the group-buy on-hand gate keep precedence ──────
check("price on request beats everything else", () => {
  const cta = buildProductCta(P({ priceOnRequest: true, stock: 0 }), -1);
  assert.equal(cta.ctaLabel, "Message to order");
  assert.equal(cta.priceLabel, "Message for price");
  assert.equal(cta.disabled, true);
});

check("group-buy blocked on-hand product keeps its own CTA", () => {
  const cta = buildProductCta(P({ price: 1799, stock: 5 }), -1, {
    gbBlocked: true,
  });
  assert.equal(cta.ctaLabel, "Available after group buy");
  assert.equal(cta.disabled, true);
});

// ── 5. no "Out of Stock" copy left to drift from "Sold out" ─────────────────
check("Catalog.tsx no longer hardcodes the old Out of Stock button copy", () => {
  assert.ok(
    !/"Out of Stock"/.test(catalog),
    'Catalog.tsx still contains the literal "Out of Stock" CTA copy',
  );
});

check("card and modal both read buildProductCta", () => {
  assert.ok(
    catalog.includes("buildProductCta"),
    "Catalog.tsx does not import/use buildProductCta",
  );
  assert.equal(
    (catalog.match(/buildProductCta\(/g) ?? []).length >= 2,
    true,
    "expected both the card and the detail modal to call buildProductCta",
  );
});

console.log("\nProduct card buy row — responsive\n");

/** The declaration block of a CSS rule, by exact selector. */
function block(selector: string): string {
  const i = css.indexOf(selector + " {");
  assert.notEqual(i, -1, `CSS rule not found: ${selector}`);
  const start = css.indexOf("{", i);
  const end = css.indexOf("}", start);
  return css.slice(start + 1, end);
}

check("the CTA can shrink inside the clipped card (min-width: 0)", () => {
  const b = block(".sf-root .product-card__cta");
  assert.match(
    b,
    /min-width:\s*0/,
    ".product-card__cta needs min-width: 0 — flex items default to min-width:auto and cannot shrink below their label",
  );
});

check("the CTA label wraps instead of overflowing", () => {
  const b = block(".sf-root .product-card__cta");
  assert.match(
    b,
    /white-space:\s*normal/,
    ".btn sets white-space: nowrap; the card CTA must opt back out so long labels wrap",
  );
});

check("the buy row wraps the CTA onto its own line when it cannot fit", () => {
  const b = block(".sf-root .product-card__buy");
  assert.match(b, /flex-wrap:\s*wrap/);
});

check("the cart icon never shrinks away", () => {
  assert.match(
    css,
    /\.sf-root \.product-card__cta svg \{[^}]*flex:\s*none/,
    "the CTA svg needs flex: none so shrinking the button squashes text, not the icon",
  );
});

check("a wrapped CTA keeps its own height (no stretched pill blob)", () => {
  const b = block(".sf-root .product-card__buy");
  assert.match(
    b,
    /align-content:\s*flex-start/,
    "multi-line flex defaults to align-content: stretch — the wrapped CTA line then fills the row's spare height and the pill radius turns it into an ellipse",
  );
});

check("the stacked column state does not also wrap", () => {
  const i = css.indexOf("@container (max-width:");
  assert.notEqual(i, -1);
  const stack = css.slice(i, css.indexOf("\n}\n", i));
  assert.match(
    stack,
    /flex-wrap:\s*nowrap/,
    "flex-direction: column + flex-wrap: wrap wraps by HEIGHT and stretches — the stacked row must opt out",
  );
});

check("the stacked CTA drops its flex basis (it is a HEIGHT in a column)", () => {
  const i = css.indexOf("@container (max-width:");
  const stack = css.slice(i, css.indexOf("\n}\n", i));
  assert.match(
    stack,
    /\.product-card__cta \{[^}]*flex:\s*none/,
    "flex: 1 1 130px means a 130px-TALL button once the row becomes a column — .btn's pill radius then renders it as an ellipse",
  );
});

check("narrow cards stack the stepper above a full-width CTA", () => {
  const m = css.match(/@container \(max-width:\s*(\d+)px\)/);
  assert.ok(m, "no @container query found for the buy row");
  assert.ok(
    Number(m![1]) >= 300,
    `the stack threshold is ${m![1]}px — too narrow for labels like "Select an option"; expected ≥ 300px`,
  );
});

console.log('\n"Not available" (purchasable: false) — set in Group Buys → Pricing\n');

// The owner's own decision to pause a product. It has to outrank inventory and
// the group-buy gate: those are states that clear on their own, and letting them
// mask the pause would put a paused product back on sale the moment stock
// arrived or a round closed. Only price-on-request (also owner-set, and more
// specific about WHY there is no price) stays above it.
check("purchasable:false → Not available, disabled, even with stock", () => {
  const cta = buildProductCta(P({ price: 1799, stock: 25, purchasable: false }), -1);
  assert.equal(cta.ctaLabel, "Not available");
  assert.equal(cta.disabled, true);
});

check("purchasable:false keeps the price on screen (it is paused, not unpriced)", () => {
  const cta = buildProductCta(P({ price: 1799, stock: 25, purchasable: false }), -1);
  assert.equal(cta.priceLabel, null, "a paused product still shows what it costs");
});

check("purchasable:false beats the group-buy on-hand gate", () => {
  const cta = buildProductCta(P({ price: 1799, stock: 5, purchasable: false }), -1, {
    gbBlocked: true,
  });
  assert.equal(cta.ctaLabel, "Not available");
  assert.equal(cta.disabled, true);
});

check("purchasable:false beats sold-out", () => {
  const cta = buildProductCta(P({ price: 1799, stock: 0, purchasable: false }), -1);
  assert.equal(cta.ctaLabel, "Not available");
});

check("price-on-request still outranks purchasable:false", () => {
  const cta = buildProductCta(P({ priceOnRequest: true, purchasable: false }), -1);
  assert.equal(cta.ctaLabel, "Message to order");
});

check("purchasable:false blocks a variation product before any option is picked", () => {
  const p = P({
    price: 0,
    purchasable: false,
    variations: [{ name: "10mg", price: 2100, stock: 4 }],
  });
  assert.equal(buildProductCta(p, -1).ctaLabel, "Not available");
  assert.equal(buildProductCta(p, 0).ctaLabel, "Not available");
});

check("an ordinary product is untouched by the new branch", () => {
  const cta = buildProductCta(P({ price: 1799, stock: 3 }), -1);
  assert.equal(cta.ctaLabel, "Add to Cart");
  assert.equal(cta.disabled, false);
});

check("purchasable:true is treated as buyable", () => {
  assert.equal(
    buildProductCta(P({ price: 1799, stock: 3, purchasable: true }), -1).ctaLabel,
    "Add to Cart",
  );
});

console.log("\nEnforcement — a paused product must be unbuyable, not just unclickable\n");

const groupBuyPage = readFileSync(
  join(root, "src/storefront/pages/GroupBuyPage.tsx"),
  "utf8",
);
const store = readFileSync(join(root, "src/storefront/store.tsx"), "utf8");
const ordersAction = readFileSync(join(root, "src/actions/orders.ts"), "utf8");

check("the group-buy page blocks paused products", () => {
  // It used to render a bare `onClick={() => addToCart(p)}` with no guard at
  // all, so a paused product stayed fully buyable on the group-buy page.
  //
  // Deliberately NOT asserting buildProductCta here: that helper gates on stock,
  // and group-buy lines are PRE-ORDERS exempt from stock (isGroupBuyPreorder).
  // Routing this page through it would render every stock-0 round product as
  // "Sold out" — the exact bug test:kglow-onhand and the GB pre-order exemption
  // exist to prevent. The requirement is the pause guard, not the helper.
  assert.match(
    groupBuyPage,
    /purchasable === false/,
    "GroupBuyPage.tsx does not guard purchasable — its Join GB button bypasses the pause",
  );
});

check("the cart guards purchasable, next to the price-on-request guard", () => {
  assert.match(
    store,
    /purchasable === false/,
    "store.tsx addToCart has no purchasable guard — the CTA is cosmetic without it",
  );
});

check("order placement re-checks purchasable server-side", () => {
  // The client guard is UX. This is the boundary: a stale tab, a replayed
  // request, or a hand-rolled POST must not be able to buy a paused product.
  assert.match(
    ordersAction,
    /purchasable/,
    "orders.ts never re-checks purchasable — the server would accept the order",
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
