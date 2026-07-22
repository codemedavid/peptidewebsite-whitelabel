/**
 * Tests for the two-ways CART rules — src/lib/storefront/two-ways-cart.ts.
 *
 * Two behaviors, both driven by the live round's pricing scope (the banner):
 *
 *   1. PRE-ORDER STOCK EXEMPTION — a product inside the live round's scope is a
 *      pre-order (the bulk order is placed after the round closes), so on-hand
 *      stock must NOT gate add-to-cart or checkout. This was the "Join GB does
 *      nothing" bug: the round's products carried stock 0, so the cart's stock
 *      cap silently rejected every click.
 *
 *   2. NO MIXED CARTS — on-hand items ship now, group-buy items ship after the
 *      round closes; one order can't do both. Adding a GB item to a cart holding
 *      on-hand items (or vice versa) is rejected, and the server re-checks the
 *      same rule at placement.
 *
 * Pure functions under test:
 *   gbScopeFromBanner     — the live banner → a GroupBuyPriceScope (null = no round).
 *   isGroupBuyPreorder    — is this product stock-exempt (inside the live scope)?
 *   twoWaysAddViolation   — why this add is rejected (mixing), or null.
 *   twoWaysOrderViolation — server-side: does this order mix the two paths?
 *
 *   npm run test:two-ways-cart
 */

import assert from "node:assert";

import {
  gbScopeFromBanner,
  isGroupBuyPreorder,
  twoWaysAddViolation,
  twoWaysOrderViolation,
} from "../src/lib/storefront/two-ways-cart";
import type { GroupBuyBanner } from "../src/lib/storefront/group-buy-banner";

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

function banner(overrides: Partial<GroupBuyBanner> = {}): GroupBuyBanner {
  return {
    id: "gb1",
    name: "june gb",
    description: "",
    deliveryEta: "3–4 weeks after close",
    productIds: ["g1", "g2"],
    coversAll: false,
    slotGoal: 0,
    endsAt: null,
    filled: 0,
    ...overrides,
  };
}

function main() {
  console.log("\ngbScopeFromBanner\n");

  check("null banner (no live round) → null scope", () => {
    assert.equal(gbScopeFromBanner(null), null);
    assert.equal(gbScopeFromBanner(undefined), null);
  });
  check("scoped banner → its product ids", () => {
    const scope = gbScopeFromBanner(banner());
    assert.ok(scope);
    assert.equal(scope.coversAll, false);
    assert.deepEqual([...scope.productIds], ["g1", "g2"]);
  });
  check("coversAll banner → coversAll scope", () => {
    const scope = gbScopeFromBanner(banner({ coversAll: true, productIds: [] }));
    assert.ok(scope);
    assert.equal(scope.coversAll, true);
  });

  console.log("\nisGroupBuyPreorder (stock exemption)\n");

  check("product inside the live scope is a pre-order (stock-exempt)", () => {
    assert.equal(isGroupBuyPreorder("g1", gbScopeFromBanner(banner())), true);
  });
  check("product outside the scope keeps its stock gate", () => {
    assert.equal(isGroupBuyPreorder("onhand1", gbScopeFromBanner(banner())), false);
  });
  check("no live round → nothing is stock-exempt", () => {
    assert.equal(isGroupBuyPreorder("g1", null), false);
  });
  check("coversAll round → every product is a pre-order", () => {
    const scope = gbScopeFromBanner(banner({ coversAll: true, productIds: [] }));
    assert.equal(isGroupBuyPreorder("anything", scope), true);
  });

  console.log("\ntwoWaysAddViolation (no mixed carts at add time)\n");

  const scope = gbScopeFromBanner(banner());

  check("empty cart → any add is allowed", () => {
    assert.equal(twoWaysAddViolation("g1", [], scope), null);
    assert.equal(twoWaysAddViolation("onhand1", [], scope), null);
  });
  check("GB item into a cart holding on-hand items → rejected with a message", () => {
    const msg = twoWaysAddViolation("g1", ["onhand1"], scope);
    assert.ok(msg && msg.length > 0);
  });
  check("on-hand item into a cart holding GB items → rejected with a message", () => {
    const msg = twoWaysAddViolation("onhand1", ["g1"], scope);
    assert.ok(msg && msg.length > 0);
  });
  check("GB item into an all-GB cart → allowed", () => {
    assert.equal(twoWaysAddViolation("g2", ["g1"], scope), null);
  });
  check("on-hand item into an all-on-hand cart → allowed", () => {
    assert.equal(twoWaysAddViolation("onhand2", ["onhand1"], scope), null);
  });
  check("no live round → mixing rule is off", () => {
    assert.equal(twoWaysAddViolation("g1", ["onhand1"], null), null);
  });
  check("coversAll round → every item is GB, nothing can mix", () => {
    const all = gbScopeFromBanner(banner({ coversAll: true, productIds: [] }));
    assert.equal(twoWaysAddViolation("a", ["b"], all), null);
  });

  console.log("\ntwoWaysOrderViolation (server re-check at placement)\n");

  check("order mixing GB and on-hand lines → rejected with a message", () => {
    const msg = twoWaysOrderViolation(["g1", "onhand1"], scope);
    assert.ok(msg && msg.length > 0);
  });
  check("all-GB order → allowed", () => {
    assert.equal(twoWaysOrderViolation(["g1", "g2"], scope), null);
  });
  check("all-on-hand order → allowed", () => {
    assert.equal(twoWaysOrderViolation(["onhand1", "onhand2"], scope), null);
  });
  check("no live round → allowed", () => {
    assert.equal(twoWaysOrderViolation(["g1", "onhand1"], null), null);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main();
