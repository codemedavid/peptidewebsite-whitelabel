/**
 * Group-buy MOQ + vials-per-kit — pure rules (src/lib/storefront/gb-moq-kits.ts).
 *
 *   npm run test:gb-moq-kits
 *
 * MOQ is per CUSTOMER ORDER: while a round with moqVials is live, an order's
 * group-buy vials must reach it. Kits are per PRODUCT: vialsPerKit drives the
 * shopper-facing "N of 10 vials" progress and the supplier report's kit count.
 */
import assert from "node:assert";

import {
  groupBuyMoqViolation,
  kitProgress,
  kitsToOrder,
  normalizeVialsPerKit,
  roundKitProgress,
  tallyKitVials,
  withKitColumns,
} from "../src/lib/storefront/gb-moq-kits";
import type { GroupBuyBanner } from "../src/lib/storefront/group-buy-banner";
import type { GroupBuyPriceScope } from "../src/lib/storefront/two-ways";

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

const assigned: GroupBuyPriceScope = { coversAll: false, productIds: ["g1", "g2"] };
const all: GroupBuyPriceScope = { coversAll: true, productIds: [] };

console.log("\ngroupBuyMoqViolation\n");

check("no live round → never blocks", () => {
  assert.equal(groupBuyMoqViolation([{ id: "g1", qty: 1 }], null, 5), null);
});
check("no MOQ set (null / 0) → never blocks", () => {
  assert.equal(groupBuyMoqViolation([{ id: "g1", qty: 1 }], assigned, null), null);
  assert.equal(groupBuyMoqViolation([{ id: "g1", qty: 1 }], assigned, 0), null);
});
check("below the MOQ → blocks and says how many more", () => {
  const msg = groupBuyMoqViolation([{ id: "g1", qty: 2 }, { id: "g2", qty: 1 }], assigned, 5);
  assert.ok(msg && msg.includes("5") && msg.includes("2 more"), String(msg));
});
check("exactly the MOQ → allowed", () => {
  assert.equal(groupBuyMoqViolation([{ id: "g1", qty: 3 }, { id: "g2", qty: 2 }], assigned, 5), null);
});
check("vials are summed ACROSS products, not per product", () => {
  assert.equal(groupBuyMoqViolation([{ id: "g1", qty: 4 }, { id: "g2", qty: 4 }], assigned, 8), null);
});
check("lines outside the round don't count toward (or trigger) the MOQ", () => {
  assert.equal(groupBuyMoqViolation([{ id: "onhand", qty: 1 }], assigned, 5), null);
  const msg = groupBuyMoqViolation([{ id: "g1", qty: 1 }, { id: "onhand", qty: 9 }], assigned, 5);
  assert.ok(msg && msg.includes("4 more"), String(msg));
});
check("coversAll round counts gb-TAGGED products only", () => {
  assert.equal(groupBuyMoqViolation([{ id: "x", productType: "gb", qty: 5 }], all, 5), null);
  const msg = groupBuyMoqViolation(
    [{ id: "x", productType: "gb", qty: 2 }, { id: "y", qty: 9 }],
    all,
    5,
  );
  assert.ok(msg && msg.includes("3 more"), String(msg));
});

console.log("\nkitProgress\n");

check("no vials per kit → no progress (null)", () => {
  assert.equal(kitProgress(7, undefined), null);
  assert.equal(kitProgress(7, 0), null);
});
check("partway through the first kit", () => {
  assert.deepEqual(kitProgress(7, 10), { inKit: 7, perKit: 10, remaining: 3, fullKits: 0 });
});
check("nothing ordered yet → whole kit remaining", () => {
  assert.deepEqual(kitProgress(0, 10), { inKit: 0, perKit: 10, remaining: 10, fullKits: 0 });
});
check("exactly full → kit complete, nothing remaining on it", () => {
  assert.deepEqual(kitProgress(10, 10), { inKit: 10, perKit: 10, remaining: 0, fullKits: 1 });
});
check("into the second kit", () => {
  assert.deepEqual(kitProgress(13, 10), { inKit: 3, perKit: 10, remaining: 7, fullKits: 1 });
});

console.log("\nkitsToOrder\n");

check("rounds UP to whole kits and reports the shortfall", () => {
  assert.deepEqual(kitsToOrder(13, 10), { kits: 2, shortBy: 7 });
});
check("exact multiple → no shortfall", () => {
  assert.deepEqual(kitsToOrder(20, 10), { kits: 2, shortBy: 0 });
});
check("zero demand → zero kits", () => {
  assert.deepEqual(kitsToOrder(0, 10), { kits: 0, shortBy: 0 });
});
check("no vials per kit → null (report shows vials only)", () => {
  assert.equal(kitsToOrder(13, undefined), null);
});

console.log("\nnormalizeVialsPerKit\n");

check("accepts positive whole numbers (numbers or numeric strings)", () => {
  assert.equal(normalizeVialsPerKit(10), 10);
  assert.equal(normalizeVialsPerKit("10"), 10);
});
check("blank / zero / negative / junk → undefined (not set)", () => {
  for (const v of [undefined, null, "", 0, -3, "abc", Number.NaN]) {
    assert.equal(normalizeVialsPerKit(v), undefined, String(v));
  }
});
check("fractions floor; absurd sizes are capped", () => {
  assert.equal(normalizeVialsPerKit(10.7), 10);
  assert.equal(normalizeVialsPerKit(99999), 1000);
});

console.log("\ntallyKitVials\n");

check("sums qty per productId across orders (variations share the id)", () => {
  const orders = [
    { items: [{ productId: "a", qty: 2 }, { productId: "b", qty: 1 }] },
    { items: [{ productId: "a", qty: 3, variation: "10mg" }] },
  ];
  assert.deepEqual(tallyKitVials(orders), { a: 5, b: 1 });
});
check("ignores junk: missing ids, bad qty, non-array items", () => {
  const orders = [
    { items: [{ qty: 4 }, { productId: "a", qty: "x" }, { productId: "a", qty: -2 }] },
    { items: "nope" },
    { items: null },
  ];
  assert.deepEqual(tallyKitVials(orders), {});
});

console.log("\nroundKitProgress\n");

const liveBanner: GroupBuyBanner = {
  id: "gb1", name: "GB", description: "", deliveryEta: "", productIds: ["g1"],
  coversAll: false, slotGoal: 0, endsAt: null, filled: 0, kitVials: { g1: 7 },
};
check("in the live round with a kit size → progress from the round's vials", () => {
  assert.deepEqual(roundKitProgress({ id: "g1", vialsPerKit: 10 }, liveBanner), {
    inKit: 7, perKit: 10, remaining: 3, fullKits: 0,
  });
});
check("no live round, no kit size, or outside the round → null", () => {
  assert.equal(roundKitProgress({ id: "g1", vialsPerKit: 10 }, null), null);
  assert.equal(roundKitProgress({ id: "g1" }, liveBanner), null);
  assert.equal(roundKitProgress({ id: "other", vialsPerKit: 10 }, liveBanner), null);
});
check("in the round with no orders yet → an empty kit", () => {
  assert.deepEqual(roundKitProgress({ id: "g1", vialsPerKit: 5 }, { ...liveBanner, kitVials: {} }), {
    inKit: 0, perKit: 5, remaining: 5, fullKits: 0,
  });
});

console.log("\nwithKitColumns\n");

check("adds kit size, kits to order and the shortfall per supplier row", () => {
  const rows = [
    { productId: "a", vials: 13 },
    { productId: "b", vials: 4 },
    { productId: null, vials: 2 },
  ];
  assert.deepEqual(withKitColumns(rows, { a: 10 }), [
    { productId: "a", vials: 13, vialsPerKit: 10, kits: 2, shortBy: 7 },
    { productId: "b", vials: 4, vialsPerKit: null, kits: null, shortBy: null },
    { productId: null, vials: 2, vialsPerKit: null, kits: null, shortBy: null },
  ]);
});
check("never mutates the input rows", () => {
  const rows = [{ productId: "a", vials: 3 }];
  withKitColumns(rows, { a: 10 });
  assert.deepEqual(rows, [{ productId: "a", vials: 3 }]);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
