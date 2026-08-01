/**
 * Tests for the CHECKOUT line name — cartDisplayName in src/storefront/checkout.ts.
 *
 * WHY (k-glow, 2026-08-01): sellers put the dose in the VARIATIONS, not the
 * product name — the catalog row is "Semaglutide" and "5mg × 10 vials" is a
 * variation. The catalog card and the two-ways home render an option picker, so
 * picking one clones the product via makeVariationEntry and the cart entry is
 * named "Semaglutide — 5mg × 10 vials". The GROUP-BUY page has no picker (owner
 * declined one): it calls addToCart(p) with the raw catalog row, so the entry
 * keeps the bare name and the checkout list — and the order the seller receives —
 * read "Semaglutide" with the mg simply gone.
 *
 * cartDisplayName is the one name both the checkout list and the persisted order
 * item use. Its rules, and what each protects against:
 *
 *   - A chosen variation is left alone — makeVariationEntry already put the dose
 *     in the name; appending again would read "… — 5mg × 10 vials 5mg × 10 vials".
 *   - A name already carrying a dose is left alone ("Lemon Bottle 10ml").
 *   - Exactly ONE buyable option → that option's name is appended, so a bare add
 *     is labelled identically to the same product added through a picker.
 *   - Several options with none chosen → left BARE. The dose is genuinely unknown
 *     and this string is persisted onto the order: "Tirzepatide 5mg / 10mg / 15mg"
 *     would tell the seller the customer ordered every dose at once.
 *   - A distinct "Standard" base price alongside one variation → left bare. The
 *     customer may have bought Standard, which is NOT the variation.
 *
 *   npm run test:checkout-names
 */

import assert from "node:assert";

import { cartDisplayName, makeVariationEntry, resolveLiveProduct } from "../src/storefront/checkout";
import type { Product } from "../src/storefront/types";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** A catalog row with the fields the name rules read; the rest is filler. */
function product(over: Partial<Product> & { name: string; price: number }): Product {
  return {
    id: over.name.toLowerCase().replace(/\s+/g, "-"),
    description: "",
    currency: "₱",
    category: "peptides",
    featured: false,
    image: null,
    ...over,
  } as Product;
}

// Real k-glow rows (see scripts/inspect-kglow-gb-names.ts). The single-variation
// products all price the variation AT the base price, so "Standard" is not a
// distinct option and the one variation is the only thing buyable.
const semaglutide = product({
  name: "Semaglutide",
  price: 4340,
  variations: [{ name: "5mg × 10 vials", price: 4340 }],
});
const tirzepatide = product({
  name: "Tirzepatide",
  price: 5000,
  variations: [
    { name: "5mg × 10 vials", price: 5000 },
    { name: "10mg × 10 vials", price: 7000 },
    { name: "15mg × 10 vials", price: 9000 },
  ],
});
const lemonBottle = product({ name: "Lemon Bottle 10ml", price: 1200 });
const kissPeptin = product({ name: "KissPeptin-10", price: 3000 });

console.log("\ncartDisplayName — the dose survives onto the checkout line\n");

check("a bare add of a single-variation product carries its dose", () => {
  assert.strictEqual(cartDisplayName(semaglutide), "Semaglutide — 5mg × 10 vials");
});

check("a bare group-buy add is named identically to the same product picked", () => {
  // The GB page adds the raw row; the catalog card clones the option. Both must
  // reach checkout under one name, or the seller sees two lines for one product.
  const picked = makeVariationEntry(semaglutide, semaglutide.variations![0]);
  assert.strictEqual(cartDisplayName(semaglutide), cartDisplayName(picked));
});

check("a chosen variation is not double-appended", () => {
  const picked = makeVariationEntry(semaglutide, semaglutide.variations![0]);
  assert.strictEqual(cartDisplayName(picked), "Semaglutide — 5mg × 10 vials");
});

check("a name that already carries its dose is left alone", () => {
  assert.strictEqual(cartDisplayName(lemonBottle), "Lemon Bottle 10ml");
});

check("a product with no variations is left alone", () => {
  assert.strictEqual(cartDisplayName(kissPeptin), "KissPeptin-10");
});

check("several unchosen doses are NOT merged into one line name", () => {
  // The order is persisted from this string — it must not claim every dose.
  const shown = cartDisplayName(tirzepatide);
  assert.strictEqual(shown, "Tirzepatide");
  assert.ok(!shown.includes("/"), `invented a dose list: ${shown}`);
});

check("a chosen dose survives on a multi-variation product", () => {
  const picked = makeVariationEntry(tirzepatide, tirzepatide.variations![1]);
  assert.strictEqual(cartDisplayName(picked), "Tirzepatide — 10mg × 10 vials");
});

check("a distinct Standard base price suppresses the append", () => {
  // Base ₱1,000 vs the only variation at ₱1,099: "Standard" is a real, cheaper
  // option, so a bare entry must not be labelled as the variation.
  const mixed = product({
    name: "Retatrutide",
    price: 1000,
    variations: [{ name: "5mg × 10 vials", price: 1099 }],
  });
  assert.strictEqual(cartDisplayName(mixed), "Retatrutide");
});

check("a re-hydrated live cart entry still carries the dose", () => {
  // liveCartLines re-reads every entry from the catalog before pricing it; the
  // name the checkout renders comes out of THAT, not the add-time snapshot.
  const live = resolveLiveProduct(semaglutide, [semaglutide]);
  assert.strictEqual(cartDisplayName(live), "Semaglutide — 5mg × 10 vials");
});

check("an empty variation name never leaves a dangling separator", () => {
  const blank = product({ name: "Selank", price: 2000, variations: [{ name: "  ", price: 2000 }] });
  assert.strictEqual(cartDisplayName(blank), "Selank");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
