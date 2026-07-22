/**
 * Tests for the "two ways to order" HOME view-model —
 * src/lib/storefront/two-ways-home.ts (design: "K Glow Store.dc.html").
 *
 * The home layout presents two order paths on one page: the ON-HAND product list
 * (ships now) and the GROUP BUY card (the live round's group-buy products at a
 * lower gbPrice, with the on-hand-vs-GB saving surfaced — this is the "two ways"
 * contrast, distinct from the dedicated #groupbuy page which shows one price).
 * buildTwoWaysHomeView composes the tested two-ways.ts + group-buy-page.ts
 * primitives into that view-model. Pure — no React, no DB.
 *
 *   npm run test:two-ways-home
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildTwoWaysHomeView,
  resolveHomeLayout,
  groupBuyCtaTarget,
} from "../src/lib/storefront/two-ways-home";
import type { GroupBuyBanner } from "../src/lib/storefront/group-buy-banner";
import type { Product } from "../src/storefront/types";
import { FEATURES, FEATURE_META, OPERATOR_GRANTABLE } from "../src/lib/features/catalog";

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

function banner(b: Partial<GroupBuyBanner> = {}): GroupBuyBanner {
  return {
    id: "gb1",
    name: "June GB",
    description: "",
    deliveryEta: "3–4 weeks after close",
    productIds: [],
    coversAll: true,
    slotGoal: 0,
    endsAt: null,
    filled: 0,
    ...b,
  };
}

const NOW = new Date("2026-07-22T00:00:00.000Z");

// 1. The live round is the source of truth for what's in the group buy: a scoped
//    round routes its assigned products to the GB card and the rest stay on-hand —
//    regardless of productType tagging. (Fixes: round active in admin but the
//    storefront GB card showed CLOSED because the products weren't tagged "gb".)
check("scoped round routes assigned products to group buy, rest on-hand", () => {
  const products = [
    product({ id: "a", name: "Alpha", price: 1000 }),
    product({ id: "b", name: "Bravo", price: 1500 }),
    product({ id: "c", name: "Charlie", price: 1000 }), // untagged, no gbPrice
  ];
  const view = buildTwoWaysHomeView(products, banner({ coversAll: false, productIds: ["c"] }), "₱", NOW);
  assert.deepEqual(view.onHand.lines.map((l) => l.product.id), ["a", "b"]);
  assert.equal(view.gb.count, 1);
  assert.equal(view.gb.lines[0].product.id, "c");
  // An untagged round product still lists at its regular price (no phantom saving).
  assert.equal(view.gb.lines[0].gbLabel, "₱1,000");
  assert.equal(view.gb.lines[0].hasSavings, false);
});

// 1b. A catalog-wide round (coversAll) puts every product in the group buy.
check("catalog-wide round routes all products to the group buy", () => {
  const products = [
    product({ id: "a", name: "Alpha", price: 1000 }),
    product({ id: "b", name: "Bravo", price: 1500, gbPrice: 1200 }),
  ];
  const view = buildTwoWaysHomeView(products, banner({ coversAll: true }), "₱", NOW);
  assert.equal(view.onHand.count, 0);
  assert.equal(view.gb.count, 2);
});

// 2. A group-buy line carries the on-hand-vs-GB saving + display labels.
check("group-buy line surfaces regular vs gb price and the saving", () => {
  const view = buildTwoWaysHomeView(
    [product({ id: "c", name: "Charlie", price: 1000, gbPrice: 800, productType: "gb" })],
    banner(),
    "₱",
    NOW,
  );
  const line = view.gb.lines[0];
  assert.equal(line.regularPrice, 1000);
  assert.equal(line.gbPrice, 800);
  assert.equal(line.savings, 200);
  assert.equal(line.hasSavings, true);
  assert.equal(line.regularLabel, "₱1,000");
  assert.equal(line.gbLabel, "₱800");
  assert.equal(line.saveLabel, "₱200");
});

// 3. No live round (null banner) → the GB path is closed and empty.
check("no live round yields a closed, empty group-buy path", () => {
  const view = buildTwoWaysHomeView(
    [product({ id: "c", name: "Charlie", price: 1000, gbPrice: 800, productType: "gb" })],
    null,
    "₱",
    NOW,
  );
  assert.equal(view.gb.open, false);
  assert.equal(view.gb.count, 0);
  assert.equal(view.gb.countdown, "");
  // No round → every product is on-hand (nothing is "in the group buy").
  assert.equal(view.onHand.count, 1);
});

// 4. A live round wires the round chrome: name, countdown, slot progress.
check("live round wires name, countdown and slot progress", () => {
  const view = buildTwoWaysHomeView(
    [product({ id: "c", name: "Charlie", price: 1000, gbPrice: 800, productType: "gb" })],
    banner({ name: "June GB", endsAt: "2026-07-25T00:00:00.000Z", slotGoal: 30, filled: 18 }),
    "₱",
    NOW,
  );
  assert.equal(view.gb.open, true);
  assert.equal(view.gb.name, "June GB");
  assert.equal(view.gb.countdown, "Closes in 3 days");
  assert.equal(view.gb.slots.enabled, true);
  assert.equal(view.gb.slots.goal, 30);
  assert.equal(view.gb.slots.filled, 18);
  assert.equal(view.gb.slots.pct, 60);
});

// 5. A scoped round narrows the GB list to the round's assigned products.
check("scoped round narrows the group-buy list to assigned products", () => {
  const products = [
    product({ id: "c", name: "Charlie", price: 1000, gbPrice: 800, productType: "gb" }),
    product({ id: "d", name: "Delta", price: 900, gbPrice: 700, productType: "gb" }),
  ];
  const view = buildTwoWaysHomeView(
    products,
    banner({ coversAll: false, productIds: ["c"] }),
    "₱",
    NOW,
  );
  assert.equal(view.gb.count, 1);
  assert.equal(view.gb.lines[0].product.id, "c");
});

// 6. On-hand line reports stock state for the "N in stock" badge.
check("on-hand line reports stock and in-stock state", () => {
  const view = buildTwoWaysHomeView(
    [
      product({ id: "a", name: "Alpha", price: 1000, stock: 12 }),
      product({ id: "b", name: "Bravo", price: 1500, stock: 0 }),
    ],
    banner({ coversAll: false, productIds: [] }), // round live but covers nothing → all on-hand
    "₱",
    NOW,
  );
  const [a, b] = view.onHand.lines;
  assert.equal(a.inStock, true);
  assert.equal(a.stockLabel, "12 in stock");
  assert.equal(a.priceLabel, "₱1,000");
  assert.equal(b.inStock, false);
  assert.equal(b.stockLabel, "0 in stock");
});

// 7. Monogram initial falls back for a blank name.
check("initial uses first letter, falls back to a bullet", () => {
  const view = buildTwoWaysHomeView(
    [product({ id: "a", name: "alpha", price: 100 }), product({ id: "z", name: "  ", price: 100 })],
    null,
    "₱",
    NOW,
  );
  assert.equal(view.onHand.lines[0].initial, "A");
  assert.equal(view.onHand.lines[1].initial, "•");
});

// 8. The operator entitlement is the ONLY way in: the feature is sold per tenant
//    (catalog.ts: operator-grantable, default OFF), so an owner-writable
//    branding.config key must never self-enable it. Config can only opt OUT
//    ("classic") while the grant is on.
check("resolveHomeLayout: only the operator entitlement turns the two-ways home on", () => {
  assert.equal(resolveHomeLayout(true, undefined), "two-ways");
  assert.equal(resolveHomeLayout(true, "two-ways"), "two-ways");
  assert.equal(resolveHomeLayout(false, "two-ways"), "classic"); // config alone must NOT bypass the grant
  assert.equal(resolveHomeLayout(false, undefined), "classic");
  assert.equal(resolveHomeLayout(true, "classic"), "classic"); // explicit owner opt-out wins
});

// 8b. WIRING: the two-ways home must offer the same per-product variation picker
//     the classic Catalog gives (5mg/10mg options with their own prices) — a
//     variation product must never silently add at its base price.
check("TwoWaysHome renders the variation picker for option products", () => {
  const src = readFileSync(
    join(__dirname, "..", "src/storefront/components/TwoWaysHome.tsx"),
    "utf8",
  );
  assert.match(src, /shouldShowOptionPicker/, "must gate a picker via shouldShowOptionPicker");
  assert.match(src, /buildProductOptions/, "must build options via buildProductOptions");
});

// 9. The feature is registered in the Group Buy category and operator-grantable,
//    so it surfaces in the Super Admin per-tenant Features panel.
check("GB_TWO_WAYS_HOME is a grantable Group Buy feature", () => {
  assert.equal(FEATURES.GB_TWO_WAYS_HOME, "groupbuy.two_ways_home");
  assert.equal(FEATURE_META[FEATURES.GB_TWO_WAYS_HOME].group, "Group Buy");
  assert.ok(FEATURE_META[FEATURES.GB_TWO_WAYS_HOME].label.length > 0);
  assert.ok(OPERATOR_GRANTABLE.has(FEATURES.GB_TWO_WAYS_HOME));
});

// 10. The live-GB CTA + "Open now" way card route to the dedicated group-buy
//     page so a shopper lands on the open round. With an empty cart the CTA
//     invites joining the round ("groupbuy"); once items are in the cart it
//     switches to reviewing/checkout ("checkout").
check("groupBuyCtaTarget: empty cart → the group-buy page", () => {
  assert.equal(groupBuyCtaTarget(0), "groupbuy");
});
check("groupBuyCtaTarget: items in cart → checkout (open the cart)", () => {
  assert.equal(groupBuyCtaTarget(1), "checkout");
  assert.equal(groupBuyCtaTarget(5), "checkout");
});
check("groupBuyCtaTarget: negative/garbage count is treated as empty", () => {
  assert.equal(groupBuyCtaTarget(-1), "groupbuy");
  assert.equal(groupBuyCtaTarget(Number.NaN), "groupbuy");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
