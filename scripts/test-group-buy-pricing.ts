/**
 * Regression tests for the live group-buy pricing path — the fixes for the
 * code-review findings on src/storefront/checkout.ts + two-ways.ts:
 *
 *   #1  authoritativeItemPrice must price a VARIATION of a group-buy product the
 *       same way the client cart does (route it through unitPrice), instead of
 *       always returning the raw variation price — otherwise the server charges a
 *       different amount than the page/cart advertised.
 *   #3  Live group-buy pricing must never RAISE the price above the regular
 *       (discount / reseller-wholesale) price: a reseller buying gb products in
 *       bulk keeps the cheaper wholesale price instead of being pushed up to
 *       gbPrice.
 *   #4  Group-buy pricing is SCOPED to the live round: a productType "gb" product
 *       that is not assigned to the live round is priced at its regular price, not
 *       gbPrice — the round's productIds (or coversAll) decide, not the mere
 *       presence of a live round.
 *   #5  The demand-excluded order statuses are a single shared list.
 *
 *   npm run test:group-buy-pricing
 */

import assert from "node:assert";

import {
  unitPrice,
  cartTotal,
  authoritativeItemPrice,
  makeVariationEntry,
  cartLines,
} from "../src/storefront/checkout";
import {
  isInGroupBuyScope,
  type GroupBuyPriceScope,
} from "../src/lib/storefront/two-ways";
import { DEMAND_EXCLUDED_STATUS_LIST, orderCountsAsDemand } from "../src/lib/storefront/group-buy";
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
    price: 0,
    currency: "₱",
    category: "all",
    featured: false,
    image: null,
    stock: 10,
    ...p,
  } as Product;
}

// Live-round scopes.
const COVERS_ALL: GroupBuyPriceScope = { coversAll: true, productIds: [] };
const ONLY_GB1: GroupBuyPriceScope = { coversAll: false, productIds: ["gb-1"] };

function main() {
  console.log("\nisInGroupBuyScope\n");

  check("in-scope by explicit productId", () => {
    assert.equal(isInGroupBuyScope("gb-1", ONLY_GB1), true);
  });
  check("out-of-scope when not assigned to the round", () => {
    assert.equal(isInGroupBuyScope("gb-2", ONLY_GB1), false);
  });
  check("covers-all scope includes every product", () => {
    assert.equal(isInGroupBuyScope("anything", COVERS_ALL), true);
  });
  check("null scope (no live round) → never in scope", () => {
    assert.equal(isInGroupBuyScope("gb-1", null), false);
  });

  console.log("\n#4 — group-buy pricing is scoped to the live round\n");

  const gb1 = product({ id: "gb-1", price: 700, gbPrice: 560, productType: "gb" });
  const gb2 = product({ id: "gb-2", price: 700, gbPrice: 560, productType: "gb" });

  check("gb product assigned to the round → gbPrice", () => {
    assert.equal(unitPrice(gb1, 1, ONLY_GB1), 560);
  });
  check("gb product NOT assigned to the round → regular price (not gbPrice)", () => {
    assert.equal(unitPrice(gb2, 1, ONLY_GB1), 700);
  });
  check("covers-all round → every gb product gets gbPrice", () => {
    assert.equal(unitPrice(gb2, 1, COVERS_ALL), 560);
  });
  check("no live round (null scope) → regular price", () => {
    assert.equal(unitPrice(gb1, 1, null), 700);
    assert.equal(unitPrice(gb1, 1), 700);
  });
  check("on-hand product is never gb-priced even under a covers-all round", () => {
    const onHand = product({ id: "oh-1", price: 850, productType: "onhand" });
    assert.equal(unitPrice(onHand, 1, COVERS_ALL), 850);
  });

  console.log("\n#3 — live gb pricing never raises the price above regular\n");

  // Reseller wholesale (700) is cheaper than gbPrice (900): the reseller keeps
  // the wholesale price rather than being pushed UP to the group price.
  const gbReseller = product({
    id: "gb-1",
    price: 1000,
    gbPrice: 900,
    productType: "gb",
    reseller: { completeSet: 700, vialsOnly: 0, minQty: 10 },
  });
  check("bulk reseller during a live round keeps the cheaper wholesale price", () => {
    assert.equal(unitPrice(gbReseller, 10, COVERS_ALL), 700);
  });
  check("single unit still gets the group price (gbPrice < regular)", () => {
    assert.equal(unitPrice(gbReseller, 1, COVERS_ALL), 900);
  });
  check("gbPrice cheaper than wholesale → gbPrice wins for the bulk line", () => {
    const gbCheap = product({
      id: "gb-1",
      price: 1000,
      gbPrice: 600,
      productType: "gb",
      reseller: { completeSet: 700, vialsOnly: 0, minQty: 10 },
    });
    assert.equal(unitPrice(gbCheap, 10, COVERS_ALL), 600);
  });

  console.log("\n#1 — authoritativeItemPrice prices a gb variation like the cart\n");

  const gbWithVariation = product({
    id: "gb-1",
    name: "Reta",
    price: 700,
    gbPrice: 560,
    productType: "gb",
    variations: [{ name: "10mg", price: 900 }],
  });
  const item = { productId: "gb-1", name: "Reta — 10mg", qty: 1, variation: "10mg" };

  check("server matches the cart: a gb variation in a live round → gbPrice", () => {
    const viaCart = unitPrice(
      makeVariationEntry(gbWithVariation, { name: "10mg", price: 900 }),
      1,
      COVERS_ALL,
    );
    assert.equal(authoritativeItemPrice(item, [gbWithVariation], COVERS_ALL), viaCart);
    assert.equal(authoritativeItemPrice(item, [gbWithVariation], COVERS_ALL), 560);
  });
  check("no live round → the variation's own price stands", () => {
    assert.equal(authoritativeItemPrice(item, [gbWithVariation], null), 900);
  });
  check("gb variation out of the round's scope → the variation's own price", () => {
    // Round only assigns some OTHER product, so this gb variation is off-round.
    const scoped: GroupBuyPriceScope = { coversAll: false, productIds: ["other"] };
    assert.equal(authoritativeItemPrice(item, [gbWithVariation], scoped), 900);
  });
  check("unknown variation → null (unchanged skip rule)", () => {
    const gone = { productId: "gb-1", name: "Reta — 5mg", qty: 1, variation: "5mg" };
    assert.equal(authoritativeItemPrice(gone, [gbWithVariation], COVERS_ALL), null);
  });

  console.log("\ncartTotal honours the scope\n");

  check("cartTotal prices only the round's gb products at gbPrice", () => {
    const lines = cartLines([gb1, gb2]); // one of each
    // gb-1 in scope → 560, gb-2 out of scope → 700 = 1260
    assert.equal(cartTotal(lines, ONLY_GB1), 1260);
    // covers-all → both 560 = 1120
    assert.equal(cartTotal(lines, COVERS_ALL), 1120);
    // no round → both regular = 1400
    assert.equal(cartTotal(lines, null), 1400);
  });

  console.log("\n#5 — one shared demand-excluded status list\n");

  check("DEMAND_EXCLUDED_STATUS_LIST is the single source both paths share", () => {
    assert.deepEqual([...DEMAND_EXCLUDED_STATUS_LIST].sort(), ["canceled", "cancelled", "refunded"]);
    for (const s of DEMAND_EXCLUDED_STATUS_LIST) assert.equal(orderCountsAsDemand(s), false);
    assert.equal(orderCountsAsDemand("processing"), true);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
