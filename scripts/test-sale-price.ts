/**
 * Tests for the SALE PRICE the storefront ADVERTISES — src/lib/storefront/sale.ts.
 *
 * The bug this pins (reported by a store owner, 2026-08-28): a product the owner
 * put on sale looked exactly like every other product while browsing. The card,
 * the quick-view modal and the two-ways shelf all printed the LIST price, and the
 * discount only appeared once the item was already in the cart — the shopper
 * found out it was on sale after deciding to buy it, which is the one moment the
 * saving no longer sells anything. HP Glow ships ~8 such products today
 * (Retatrutide 30mg lists ₱4,299 and is charged ₱3,899).
 *
 * The rule is a single invariant: THE PRICE ON SCREEN IS THE PRICE THE CART
 * CHARGES. Every guarantee below is a consequence of it, and the parity block
 * states it directly against checkout.unitPrice.
 *
 * Layers covered:
 *   1. The pure helper — resolveSaleView(product, selectedIndex) — which every
 *      browsing surface asks for its price, its struck compare-at and its badge.
 *   2. Parity with src/storefront/checkout.ts → unitPrice(), the price actually
 *      charged. A display rule that can disagree with checkout IS the bug.
 *   3. resolveBaseSaleView(product) — the same rule for a browsing surface that
 *      has NO option picker to consult: the editorial featured band and the
 *      reseller price list. Both shipped printing the raw list price, which is
 *      the reported bug surviving on the two surfaces the original fix missed.
 *   4. Structural guards on the surfaces (Catalog.tsx card + modal,
 *      two-ways-home.ts shelf, EditorialEdit.tsx band, MerchantPage.tsx retail
 *      tier) so they actually consume the helper.
 *
 *   npm run test:sale-price
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  isDiscountActive,
  resolveBaseSaleView,
  resolveSaleView,
  saleBadgeLabel,
} from "../src/lib/storefront/sale";
import { unitPrice } from "../src/storefront/checkout";
import { buildTwoWaysHomeView } from "../src/lib/storefront/two-ways-home";
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

function product(p: Partial<Product> & { id: string }): Product {
  return {
    name: "Product",
    description: "",
    price: 0,
    currency: "₱",
    category: "all",
    featured: false,
    image: null,
    stock: 10,
    ...p,
  };
}

/** A plain single-price product on a real sale: ₱2,000 marked down to ₱1,500. */
const onSale = product({
  id: "sale",
  name: "Glutathione",
  price: 2000,
  discountEnabled: true,
  discountPrice: 1500,
});

/** The same product with no sale running. */
const noSale = product({ id: "plain", name: "Glutathione", price: 2000 });

console.log("\nSale price — the discount is visible while browsing, not just in the cart\n");

// ───────────────────────────── isDiscountActive ─────────────────────────────
console.log("isDiscountActive");

check("a priced discount below the list price is active", () => {
  assert.equal(isDiscountActive(onSale), true);
});

check("no discount configured is not active", () => {
  assert.equal(isDiscountActive(noSale), false);
});

check("a discount PRICE without the toggle is not active", () => {
  assert.equal(isDiscountActive(product({ id: "x", price: 2000, discountPrice: 1500 })), false);
});

check("the toggle with an unset (0) discount price is NOT active — never sells at zero", () => {
  // The product editor happily saves `discountEnabled` with an empty price
  // (`Number("") || 0`). Treating that as a real sale would advertise — and
  // charge — ₱0 for the product.
  const p = product({ id: "x", price: 2000, discountEnabled: true, discountPrice: 0 });
  assert.equal(isDiscountActive(p), false);
});

check("a discount at or ABOVE the list price is not active — a sale never raises the price", () => {
  assert.equal(
    isDiscountActive(product({ id: "x", price: 2000, discountEnabled: true, discountPrice: 2000 })),
    false,
  );
  assert.equal(
    isDiscountActive(product({ id: "x", price: 2000, discountEnabled: true, discountPrice: 2400 })),
    false,
  );
});

check("a null / non-finite discount price is not active", () => {
  assert.equal(
    isDiscountActive(product({ id: "x", price: 2000, discountEnabled: true, discountPrice: null })),
    false,
  );
});

// ───────────────────────────── resolveSaleView ──────────────────────────────
console.log("resolveSaleView — single-price products");

check("a product on sale shows the SALE price immediately, with no option to pick", () => {
  const view = resolveSaleView(onSale, -1);
  assert.equal(view.price, 1500);
  assert.equal(view.onSale, true);
});

check("the list price it was marked down from comes back as compareAt (the struck price)", () => {
  assert.equal(resolveSaleView(onSale, -1).compareAt, 2000);
});

check("the saving is expressed as a whole percent for the badge", () => {
  assert.equal(resolveSaleView(onSale, -1).percentOff, 25);
});

check("a product with no sale shows its list price and NO compare-at / badge", () => {
  const view = resolveSaleView(noSale, -1);
  assert.equal(view.price, 2000);
  assert.equal(view.compareAt, null);
  assert.equal(view.onSale, false);
  assert.equal(view.badgeLabel, null);
});

check("an enabled-but-unpriced discount shows the LIST price, not free", () => {
  const p = product({ id: "x", price: 2000, discountEnabled: true, discountPrice: 0 });
  const view = resolveSaleView(p, -1);
  assert.equal(view.price, 2000);
  assert.equal(view.onSale, false);
});

console.log("resolveSaleView — variation products");

const variationSale = product({
  id: "var",
  name: "Tirzepatide",
  price: 2000,
  discountEnabled: true,
  discountPrice: 1500,
  variations: [
    { name: "5mg", price: 3000 },
    { name: "10mg", price: 5000 },
  ],
});

check("nothing picked yet → still no price (reveal-on-click survives)", () => {
  const view = resolveSaleView(variationSale, -1);
  assert.equal(view.price, null);
  assert.equal(view.onSale, false);
  assert.equal(view.badgeLabel, null);
});

check("picking the base 'Standard' option reveals the sale, because that is what it charges", () => {
  // options = [Standard 2000, 5mg 3000, 10mg 5000]
  const view = resolveSaleView(variationSale, 0);
  assert.equal(view.price, 1500);
  assert.equal(view.compareAt, 2000);
  assert.equal(view.onSale, true);
});

check("picking a real variation shows ITS price and no sale — the promo is the base's", () => {
  // makeVariationEntry clears discountEnabled/discountPrice on the cart clone,
  // so advertising a saving on a variation would advertise a price the cart
  // refuses to charge.
  const five = resolveSaleView(variationSale, 1);
  assert.equal(five.price, 3000);
  assert.equal(five.compareAt, null);
  assert.equal(five.onSale, false);
});

check("an index past the end of the option list is treated as no selection", () => {
  assert.equal(resolveSaleView(variationSale, 9).price, null);
});

// ──────────────────────────────── badge label ───────────────────────────────
console.log("saleBadgeLabel");

check("a measurable saving is badged with its percentage", () => {
  assert.equal(saleBadgeLabel(25), "25% off");
  assert.equal(resolveSaleView(onSale, -1).badgeLabel, "25% off");
});

check("a saving too small to round to a percent still reads as a sale", () => {
  assert.equal(saleBadgeLabel(0), "Sale");
});

// ───────────────── parity: what is shown IS what is charged ─────────────────
console.log("parity with checkout.unitPrice — the reported bug");

const parityCases: Array<[string, Product, number]> = [
  ["a product on sale", onSale, -1],
  ["a product with no sale", noSale, -1],
  [
    "an enabled-but-unpriced discount",
    product({ id: "z", price: 2000, discountEnabled: true, discountPrice: 0 }),
    -1,
  ],
  [
    "a discount above list price",
    product({ id: "z", price: 2000, discountEnabled: true, discountPrice: 2400 }),
    -1,
  ],
  ["a variation product's base option", variationSale, 0],
];

for (const [label, p, idx] of parityCases) {
  check(`${label}: the advertised price equals the price the cart charges`, () => {
    const shown = resolveSaleView(p, idx).price;
    const charged = unitPrice(p, 1);
    assert.equal(
      shown,
      charged,
      `catalog shows ${shown} but checkout charges ${charged} — the shopper only learns the real price in the cart`,
    );
  });
}

// ─────────────────────── Catalog.tsx structural guards ──────────────────────
console.log("Catalog.tsx card + quick-view modal");

const catalog = readFileSync(
  join(process.cwd(), "src/storefront/components/Catalog.tsx"),
  "utf8",
);

check("the card + modal price from resolveSaleView, not the raw list price", () => {
  const uses = catalog.match(/resolveSaleView\(/g) ?? [];
  assert.ok(
    uses.length >= 2,
    `expected the card AND the modal to call resolveSaleView (found ${uses.length})`,
  );
});

check("both surfaces render a struck-through compare-at price", () => {
  const struck = catalog.match(/product-card__compare|sf-detail__compare/g) ?? [];
  assert.ok(
    struck.length >= 2,
    `no compare-at element on the card and modal (found ${struck.length}) — the shopper cannot see what the price was marked down FROM`,
  );
});

check("a product on sale carries a sale badge", () => {
  assert.ok(
    catalog.includes("badgeLabel"),
    "the card never renders sale.badgeLabel — an on-sale product looks identical to every other card in the grid",
  );
});

// ──────────────────── two-ways on-hand shelf structural guard ───────────────
console.log("two-ways home — the ships-now shelf");

check("the shelf advertises the sale price and the price it was marked down from", () => {
  const view = buildTwoWaysHomeView([onSale], null, "₱");
  const line = view.onHand.lines[0];
  assert.equal(line.price, 1500, "the shelf still lists the pre-sale price");
  assert.ok(
    line.priceLabel.includes("1,500"),
    `shelf price label reads "${line.priceLabel}" — not the sale price`,
  );
  assert.ok(
    line.compareAtLabel.includes("2,000"),
    `shelf shows no struck list price (compareAtLabel = "${line.compareAtLabel}")`,
  );
});

check("a product with no sale exposes no compare-at on the shelf", () => {
  const view = buildTwoWaysHomeView([noSale], null, "₱");
  assert.equal(view.onHand.lines[0].compareAtLabel, "");
});

// ───────────────── resolveBaseSaleView — surfaces with no picker ────────────
// The editorial featured band and the reseller price list are browsing surfaces
// with no option picker: they show one figure per product and cannot ask the
// customer which size they mean. Both printed `product.price` raw, so a marked
// down product advertised the list price and the saving reappeared only in the
// cart — the reported bug, surviving on the two surfaces the first fix missed.
console.log("resolveBaseSaleView — surfaces with no option picker");

check("a single-price product on sale shows the SALE price, with no pick to make", () => {
  const view = resolveBaseSaleView(onSale);
  assert.equal(view.price, 1500);
  assert.equal(view.onSale, true);
});

check("it carries the list price it was marked down from, for the struck figure", () => {
  const view = resolveBaseSaleView(onSale);
  assert.equal(view.compareAt, 2000);
  assert.equal(view.badgeLabel, "25% off");
});

check("a product with no sale shows its list price and no compare-at", () => {
  const view = resolveBaseSaleView(noSale);
  assert.equal(view.price, 2000);
  assert.equal(view.compareAt, null);
  assert.equal(view.onSale, false);
});

check("an enabled-but-unpriced discount shows the LIST price, not free", () => {
  const view = resolveBaseSaleView(
    product({ id: "x", price: 2000, discountEnabled: true, discountPrice: 0 }),
  );
  assert.equal(view.price, 2000);
  assert.equal(view.onSale, false);
});

check("a product WITH variations shows the base price and advertises NO saving", () => {
  // A picker-less surface cannot know which option the customer will buy, and a
  // variation clone drops the base product's markdown (makeVariationEntry). If
  // the base price is not separately purchasable — the seller re-entered it as a
  // named variation, so buildProductOptions offers no "Standard" — advertising
  // the markdown here promises a price the cart then refuses to charge, which is
  // the very bug this module exists to close, pointed the other way.
  const view = resolveBaseSaleView(variationSale);
  assert.equal(view.price, 2000);
  assert.equal(view.compareAt, null);
  assert.equal(view.onSale, false);
});

check("a picker-less surface shows the price the cart charges", () => {
  const shown = resolveBaseSaleView(onSale).price;
  const charged = unitPrice(onSale, 1);
  assert.equal(
    shown,
    charged,
    `the band shows ${shown} but checkout charges ${charged} — the shopper only learns the real price in the cart`,
  );
});

// ─────────────── EditorialEdit.tsx — the editorial featured band ────────────
console.log("EditorialEdit.tsx — the editorial featured band");

const editorialEdit = readFileSync(
  join(process.cwd(), "src/storefront/components/EditorialEdit.tsx"),
  "utf8",
);

check("the featured band prices from the sale helper, not the raw list price", () => {
  assert.ok(
    editorialEdit.includes("resolveBaseSaleView("),
    "the editorial featured band still prints product.price — a marked-down product advertises the pre-sale price on the home page",
  );
});

check("the band renders a struck-through compare-at price", () => {
  assert.ok(
    editorialEdit.includes("ed-edit__compare"),
    "no compare-at element in the featured band — the shopper cannot see what the price was marked down FROM",
  );
});

// ──────────────── MerchantPage.tsx — the reseller price list ────────────────
console.log("MerchantPage.tsx — the reseller price list");

const merchantPage = readFileSync(
  join(process.cwd(), "src/storefront/pages/MerchantPage.tsx"),
  "utf8",
);

check("the Retail tier prices from the sale helper, not the raw list price", () => {
  assert.ok(
    merchantPage.includes("resolveBaseSaleView("),
    "the wholesale page's Retail tier still prints product.price — the reseller is quoted a retail figure the cart will not charge, so the wholesale saving shown against it is wrong",
  );
  assert.ok(
    !/money\(product\.price\)/.test(merchantPage),
    "the Retail tier still reads product.price directly — a third copy of the sale rule is how this broke the first time",
  );
});

check("the Retail tier renders a struck-through compare-at price", () => {
  assert.ok(
    merchantPage.includes("merchant-card__compare"),
    "no compare-at element on the reseller card — the retail figure silently changes with no sign a markdown is running",
  );
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
