/**
 * Group Buy Pricing — the store admin's per-product group-buy price manager
 * (Group Buys → Pricing tab).
 *
 * The tab lists the whole catalog with the regular price and the group-buy
 * price side by side, so the owner can promote any product into the round by
 * giving it a GB price, retire it from the round, or pause it without touching
 * the product editor. This file covers the pure layer behind all of that:
 *
 *   src/lib/storefront/gb-pricing.ts
 *     - buildGbPricingRows  — the view model (regular vs GB price, savings,
 *                             which rounds carry the product, availability)
 *     - gbPriceError        — validation before anything is stored
 *     - applyGbPrice        — set/replace a product's group-buy price
 *     - removeFromGroupBuy  — retire it: untag + clear price + drop from rounds
 *     - setPurchasable      — pause / resume without unlisting
 *
 * The invariant worth naming: a "group-buy price" is only real when it BEATS
 * the regular price. groupBuyLine (two-ways.ts) silently falls back to the
 * regular price otherwise, so a GB price >= regular is a phantom discount —
 * the storefront would advertise a saving of zero. The editor has to reject it
 * rather than store it.
 *
 *   npm run test:gb-pricing
 */

import assert from "node:assert";

import {
  applyGbPrice,
  buildGbPricingRows,
  gbPriceError,
  removeFromGroupBuy,
  setPurchasable,
} from "../src/lib/storefront/gb-pricing";
import { groupBuyLine } from "../src/lib/storefront/two-ways";
import type { Product } from "../src/storefront/types";
import type { GroupBuy } from "../src/lib/storefront/group-buy";

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

/** Minimal catalog product; only the fields under test matter. */
const P = (over: Partial<Product> = {}): Product =>
  ({
    id: "p1",
    name: "BPC-157",
    description: "",
    price: 1800,
    currency: "₱",
    category: "peptides",
    featured: false,
    image: null,
    stock: 10,
    ...over,
  }) as Product;

/** Minimal group buy round. */
const GB = (over: Partial<GroupBuy> = {}): GroupBuy =>
  ({
    id: "gb1",
    name: "June Group Buy",
    description: "",
    status: "active",
    startsAt: null,
    endsAt: null,
    deliveryEta: "",
    productIds: [],
    slotGoal: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...over,
  }) as GroupBuy;

console.log("\nbuildGbPricingRows — the tab's view model\n");

check("lists the whole catalog, not just group-buy products", () => {
  const rows = buildGbPricingRows(
    [P({ id: "a", name: "BPC-157" }), P({ id: "b", name: "Bac water", price: 150 })],
    [],
    "₱",
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.product.id),
    ["a", "b"],
    "catalog order is preserved so the tab matches the Products screen",
  );
});

check("a product with no GB price reads as not-in-the-group-buy", () => {
  const [row] = buildGbPricingRows([P()], [], "₱");
  assert.equal(row.isGroupBuy, false);
  assert.equal(row.savings, 0);
  assert.equal(row.hasSavings, false);
  // gbPrice deliberately falls back to the REGULAR price rather than 0 — that is
  // groupBuyLine's contract (a line never advertises a phantom saving), and the
  // row has to stay faithful to it or the admin would show a price the
  // storefront does not charge. `hasSavings` is the "a real GB price is set"
  // signal the tab renders "—" from; a zero here would be a second, conflicting
  // definition of the same thing.
  assert.equal(row.gbPrice, row.regularPrice);
});

check("a tagged product surfaces its GB price and the saving", () => {
  const [row] = buildGbPricingRows([P({ productType: "gb", gbPrice: 1200 })], [], "₱");
  assert.equal(row.isGroupBuy, true);
  assert.equal(row.gbPrice, 1200);
  assert.equal(row.savings, 600);
});

check("the row's saving agrees with what the storefront actually charges", () => {
  // The number in the admin must be the number the customer sees. groupBuyLine
  // is the storefront's own pricing rule, so assert against it rather than
  // recomputing the subtraction a second way.
  const p = P({ productType: "gb", gbPrice: 1200 });
  const [row] = buildGbPricingRows([p], [], "₱");
  assert.equal(row.savings, groupBuyLine(p).savings);
  assert.equal(row.gbPrice, groupBuyLine(p).gbPrice);
});

check("formatted labels carry the tenant's currency symbol", () => {
  const [row] = buildGbPricingRows([P({ productType: "gb", gbPrice: 1200 })], [], "₱");
  assert.match(row.regularLabel, /₱/);
  assert.match(row.gbLabel, /₱/);
});

check("rows report which rounds carry the product", () => {
  const rounds = [
    GB({ id: "gb1", name: "June", productIds: ["a"] }),
    GB({ id: "gb2", name: "July", productIds: ["a", "b"] }),
  ];
  const rows = buildGbPricingRows([P({ id: "a" }), P({ id: "b" })], rounds, "₱");
  assert.deepEqual(rows[0].roundNames, ["June", "July"]);
  assert.deepEqual(rows[1].roundNames, ["July"]);
});

check("an archived round never claims a product", () => {
  // Archived rounds are history. Showing "in: <archived round>" would tell the
  // owner a retired product is still committed somewhere.
  const rounds = [GB({ id: "gb1", name: "Old", status: "archived", productIds: ["a"] })];
  const [row] = buildGbPricingRows([P({ id: "a" })], rounds, "₱");
  assert.deepEqual(row.roundNames, []);
});

check("a round with no assignment covers the whole catalog", () => {
  // Empty productIds means "every product" everywhere else in the group-buy
  // code (buildGroupBuyGate, groupBuyForOrder) — the tab must not contradict it.
  const rounds = [GB({ id: "gb1", name: "June", productIds: [] })];
  const rows = buildGbPricingRows([P({ id: "a" }), P({ id: "b" })], rounds, "₱");
  assert.deepEqual(rows[0].roundNames, ["June"]);
  assert.deepEqual(rows[1].roundNames, ["June"]);
});

check("rows expose the pause state", () => {
  const rows = buildGbPricingRows([P({ purchasable: false }), P({ id: "b" })], [], "₱");
  assert.equal(rows[0].available, false);
  assert.equal(rows[1].available, true);
});

console.log("\ngbPriceError — a GB price is only real when it beats the regular price\n");

check("a price below the regular price is accepted", () => {
  assert.equal(gbPriceError(P({ price: 1800 }), 1200), null);
});

check("a price equal to the regular price is rejected", () => {
  // groupBuyLine would fall back to the regular price and advertise no saving.
  assert.ok(gbPriceError(P({ price: 1800 }), 1800));
});

check("a price above the regular price is rejected", () => {
  assert.ok(gbPriceError(P({ price: 1800 }), 2400));
});

check("zero and negative prices are rejected", () => {
  assert.ok(gbPriceError(P({ price: 1800 }), 0));
  assert.ok(gbPriceError(P({ price: 1800 }), -50));
});

check("a non-finite price is rejected rather than stored as NaN", () => {
  assert.ok(gbPriceError(P({ price: 1800 }), Number.NaN));
});

check("the rejection message names both numbers so the owner can fix it", () => {
  const msg = gbPriceError(P({ price: 1800 }), 2400) ?? "";
  assert.match(msg, /1,?800/);
  assert.match(msg, /2,?400/);
});

console.log("\napplyGbPrice — set or replace a product's group-buy price\n");

check("tags the product and stores the price", () => {
  const next = applyGbPrice(P(), 1200);
  assert.equal(next.productType, "gb");
  assert.equal(next.gbPrice, 1200);
});

check("does not mutate the input product", () => {
  const original = P();
  applyGbPrice(original, 1200);
  assert.equal(original.productType, undefined);
  assert.equal(original.gbPrice, undefined);
});

check("replaces an existing GB price", () => {
  const next = applyGbPrice(P({ productType: "gb", gbPrice: 1200 }), 999);
  assert.equal(next.gbPrice, 999);
});

check("leaves the regular price alone", () => {
  assert.equal(applyGbPrice(P({ price: 1800 }), 1200).price, 1800);
});

check("leaves every unrelated field intact", () => {
  const next = applyGbPrice(P({ stock: 7, purity: "99%" }), 1200);
  assert.equal(next.stock, 7);
  assert.equal(next.purity, "99%");
});

check("the result prices through the storefront rule at the new number", () => {
  const next = applyGbPrice(P({ price: 1800 }), 1200);
  assert.equal(groupBuyLine(next).gbPrice, 1200);
  assert.equal(groupBuyLine(next).hasSavings, true);
});

console.log("\nremoveFromGroupBuy — retire from the group buy, keep the catalog row\n");

check("untags the product and clears its GB price", () => {
  const next = removeFromGroupBuy(P({ productType: "gb", gbPrice: 1200 })).product;
  assert.equal(next.productType, "onhand");
  assert.equal(next.gbPrice, 0);
});

check("keeps the product and its regular price in the catalog", () => {
  const next = removeFromGroupBuy(P({ productType: "gb", gbPrice: 1200, price: 1800 })).product;
  assert.equal(next.name, "BPC-157");
  assert.equal(next.price, 1800);
});

check("does not mutate the input", () => {
  const original = P({ productType: "gb", gbPrice: 1200 });
  removeFromGroupBuy(original);
  assert.equal(original.productType, "gb");
  assert.equal(original.gbPrice, 1200);
});

check("reports the rounds that still assign the product", () => {
  const rounds = [
    GB({ id: "gb1", productIds: ["p1", "other"] }),
    GB({ id: "gb2", productIds: ["other"] }),
  ];
  const out = removeFromGroupBuy(P({ id: "p1", productType: "gb" }), rounds);
  assert.deepEqual(
    out.roundUpdates.map((u) => u.id),
    ["gb1"],
    "only the round that actually lists the product needs rewriting",
  );
  assert.deepEqual(out.roundUpdates[0].productIds, ["other"]);
});

check("a round that covers the whole catalog is left alone", () => {
  // Empty productIds means "all products" — there is no id to strip, and adding
  // entries would silently narrow the round from all-products to a subset.
  const rounds = [GB({ id: "gb1", productIds: [] })];
  const out = removeFromGroupBuy(P({ id: "p1", productType: "gb" }), rounds);
  assert.deepEqual(out.roundUpdates, []);
});

check("removing the round's only product does not silently widen it to all", () => {
  // The trap: an empty productIds reads as "covers the whole catalog", so a
  // round left with nothing assigned flips to covering EVERYTHING.
  const rounds = [GB({ id: "gb1", productIds: ["p1"] })];
  const out = removeFromGroupBuy(P({ id: "p1", productType: "gb" }), rounds);
  assert.equal(out.roundUpdates.length, 1);
  assert.deepEqual(out.roundUpdates[0].productIds, []);
  assert.equal(
    out.emptiesRound,
    true,
    "the caller has to be told, so it can warn instead of quietly re-scoping the round",
  );
});

check("emptiesRound is false when other products remain", () => {
  const rounds = [GB({ id: "gb1", productIds: ["p1", "other"] })];
  assert.equal(removeFromGroupBuy(P({ id: "p1" }), rounds).emptiesRound, false);
});

check("no rounds passed → just the product change", () => {
  const out = removeFromGroupBuy(P({ productType: "gb", gbPrice: 1200 }));
  assert.deepEqual(out.roundUpdates, []);
  assert.equal(out.emptiesRound, false);
});

console.log("\nsetPurchasable — pause without unlisting\n");

check("pausing sets purchasable false and keeps the product listed", () => {
  const next = setPurchasable(P(), false);
  assert.equal(next.purchasable, false);
  assert.notEqual(next.available, false, "pausing must not hide the product");
});

check("resuming sets purchasable true", () => {
  assert.equal(setPurchasable(P({ purchasable: false }), true).purchasable, true);
});

check("does not mutate the input", () => {
  const original = P({ purchasable: false });
  setPurchasable(original, true);
  assert.equal(original.purchasable, false);
});

check("pausing leaves the group-buy price intact for when it resumes", () => {
  const next = setPurchasable(P({ productType: "gb", gbPrice: 1200 }), false);
  assert.equal(next.productType, "gb");
  assert.equal(next.gbPrice, 1200);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
