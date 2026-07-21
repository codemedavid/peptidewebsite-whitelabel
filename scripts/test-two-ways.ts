/**
 * Tests for the "Two ways to order" storefront core (kglow) —
 * src/lib/storefront/two-ways.ts plus the slotGoal additions to the Group Buy
 * round (group-buy.ts) and its public banner (group-buy-banner.ts).
 *
 * The K Glow storefront presents two order paths side by side:
 *   ON-HAND  — regular stocked items (productType !== "gb"), ship now.
 *   GROUP BUY — productType "gb" items, priced by gbPrice, shown with the
 *               regular price + the per-item saving, under a live round whose
 *               countdown / delivery ETA / slot-goal progress come from the
 *               Group Buy module.
 *
 * Pure functions under test:
 *   isGroupBuyProduct — classify a product as group-buy (tag "gb") or on-hand.
 *   groupBuyLine      — resolve a product's regular vs GB price + saving.
 *   splitTwoWays      — split a catalog into the on-hand + group-buy paths.
 *   slotProgress      — the slot-goal bar (18 of 30 · 60%); OFF when goal <= 0
 *                       so the owner can turn the progress bar off per round.
 *   normalizeGroupBuy — now carries slotGoal (0 = off).
 *   buildGroupBuyBanner — surfaces slotGoal to the storefront.
 *
 *   npm run test:two-ways
 */

import assert from "node:assert";

import {
  isGroupBuyProduct,
  groupBuyLine,
  splitTwoWays,
  slotProgress,
} from "../src/lib/storefront/two-ways";
import { normalizeGroupBuy, type GroupBuy } from "../src/lib/storefront/group-buy";
import { buildGroupBuyBanner } from "../src/lib/storefront/group-buy-banner";

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

// Minimal structural product (two-ways only reads price / gbPrice / productType,
// but we thread an id through to prove the split preserves the caller's objects).
type P = { id: string; price: number; gbPrice?: number; productType?: "gb" | "onhand" };

function main() {
  console.log("\nisGroupBuyProduct\n");

  check('productType "gb" is a group-buy product', () => {
    assert.equal(isGroupBuyProduct({ productType: "gb" }), true);
  });
  check('productType "onhand" / absent is NOT a group-buy product', () => {
    assert.equal(isGroupBuyProduct({ productType: "onhand" }), false);
    assert.equal(isGroupBuyProduct({}), false);
  });

  console.log("\ngroupBuyLine (regular vs GB pricing)\n");

  check("gbPrice below the regular price → saving is the difference", () => {
    const line = groupBuyLine({ id: "g", price: 700, gbPrice: 560, productType: "gb" });
    assert.equal(line.regularPrice, 700);
    assert.equal(line.gbPrice, 560);
    assert.equal(line.savings, 140);
    assert.equal(line.hasSavings, true);
  });

  check("no gbPrice (absent / 0) → GB price falls back to regular, no saving", () => {
    const a = groupBuyLine({ id: "a", price: 700, productType: "gb" });
    assert.equal(a.gbPrice, 700);
    assert.equal(a.savings, 0);
    assert.equal(a.hasSavings, false);
    const b = groupBuyLine({ id: "b", price: 700, gbPrice: 0, productType: "gb" });
    assert.equal(b.gbPrice, 700);
    assert.equal(b.hasSavings, false);
  });

  check("misconfigured gbPrice >= regular → clamped to regular, never a negative saving", () => {
    const line = groupBuyLine({ id: "c", price: 700, gbPrice: 900, productType: "gb" });
    assert.equal(line.gbPrice, 700);
    assert.equal(line.savings, 0);
    assert.equal(line.hasSavings, false);
  });

  console.log("\nsplitTwoWays\n");

  const catalog: P[] = [
    { id: "onhand-1", price: 700 },
    { id: "gb-1", price: 700, gbPrice: 560, productType: "gb" },
    { id: "onhand-2", price: 850, productType: "onhand" },
    { id: "gb-2", price: 1050, gbPrice: 840, productType: "gb" },
  ];

  check("separates the catalog into on-hand products and group-buy lines", () => {
    const { onHand, groupBuy } = splitTwoWays(catalog);
    assert.deepEqual(onHand.map((p) => p.id), ["onhand-1", "onhand-2"]);
    assert.deepEqual(groupBuy.map((l) => l.product.id), ["gb-1", "gb-2"]);
  });

  check("group-buy lines carry resolved pricing + savings", () => {
    const { groupBuy } = splitTwoWays(catalog);
    assert.equal(groupBuy[0].savings, 140);
    assert.equal(groupBuy[1].savings, 210);
    assert.ok(groupBuy.every((l) => l.hasSavings));
  });

  check("preserves the caller's product objects (identity) in the on-hand path", () => {
    const { onHand } = splitTwoWays(catalog);
    assert.strictEqual(onHand[0], catalog[0]);
  });

  check("empty catalog → empty paths", () => {
    assert.deepEqual(splitTwoWays([]), { onHand: [], groupBuy: [] });
  });

  check("never mutates the input array", () => {
    const copy = [...catalog];
    splitTwoWays(catalog);
    assert.deepEqual(catalog, copy);
  });

  console.log("\nslotProgress (goal bar — editable / turn-off-able per round)\n");

  check("goal off (0 / undefined / negative) → disabled, no progress", () => {
    for (const goal of [0, undefined, -5, null as unknown as number]) {
      const p = slotProgress(goal, 12);
      assert.equal(p.enabled, false);
      assert.equal(p.pct, 0);
    }
  });

  check("18 of 30 slots → enabled, 60%", () => {
    const p = slotProgress(30, 18);
    assert.equal(p.enabled, true);
    assert.equal(p.goal, 30);
    assert.equal(p.filled, 18);
    assert.equal(p.pct, 60);
    assert.equal(p.pctLabel, "60%");
    assert.equal(p.pctWidth, "60%");
  });

  check("filled beyond the goal → capped at 100%", () => {
    const p = slotProgress(30, 45);
    assert.equal(p.pct, 100);
    assert.equal(p.pctWidth, "100%");
  });

  check("negative / fractional filled is clamped and floored", () => {
    assert.equal(slotProgress(30, -3).filled, 0);
    assert.equal(slotProgress(30, 5.9).filled, 5);
  });

  console.log("\nGroupBuy round carries an editable slot goal\n");

  // Untyped bag on purpose: several cases feed invalid values (e.g. slotGoal:
  // "abc") to prove normalizeGroupBuy coerces them, so the param must accept
  // unknowns rather than the strict GroupBuy field types.
  function gb(partial: Record<string, unknown>): GroupBuy {
    return normalizeGroupBuy({ id: "gb1", name: "June GB", status: "active", ...partial });
  }

  check("normalizeGroupBuy defaults slotGoal to 0 (off) when absent", () => {
    assert.equal(gb({}).slotGoal, 0);
  });

  check("normalizeGroupBuy keeps a positive integer goal", () => {
    assert.equal(gb({ slotGoal: 30 }).slotGoal, 30);
    assert.equal(gb({ slotGoal: 25.7 }).slotGoal, 25);
  });

  check("normalizeGroupBuy coerces a negative / invalid goal to 0 (off)", () => {
    assert.equal(gb({ slotGoal: -10 }).slotGoal, 0);
    assert.equal(gb({ slotGoal: "abc" }).slotGoal, 0);
  });

  check("buildGroupBuyBanner surfaces the live round's slotGoal", () => {
    const caps = { scheduled: true, productAssignment: true };
    const now = new Date("2026-07-17T12:00:00.000Z");
    const banner = buildGroupBuyBanner(
      [gb({ createdAt: "2026-07-01T00:00:00.000Z", productIds: ["p1"], slotGoal: 30 })],
      caps,
      now,
    );
    assert.ok(banner);
    assert.equal(banner!.slotGoal, 30);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
