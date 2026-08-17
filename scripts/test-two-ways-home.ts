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
//    round claims its assigned products (they leave the on-hand shelf for the
//    dedicated #groupbuy page) and the rest stay on-hand — regardless of
//    productType tagging. (Fixes: round active in admin but the storefront GB
//    card showed CLOSED because the products weren't tagged "gb".)
check("scoped round claims assigned products, rest stay on-hand", () => {
  const products = [
    product({ id: "a", name: "Alpha", price: 1000 }),
    product({ id: "b", name: "Bravo", price: 1500 }),
    product({ id: "c", name: "Charlie", price: 1000 }), // untagged, no gbPrice
  ];
  const view = buildTwoWaysHomeView(products, banner({ coversAll: false, productIds: ["c"] }), "₱", NOW);
  assert.deepEqual(view.onHand.lines.map((l) => l.product.id), ["a", "b"]);
  assert.equal(view.gb.count, 1);
  assert.deepEqual(view.gb.productIds, ["c"]);
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

// 2. Per-item group-buy PRICING (regular vs gbPrice + saving labels) is no longer
//    a home concern — the round's items render only on the dedicated #groupbuy
//    page. That guarantee is pinned by npm run test:group-buy-page
//    ("each line exposes gb price, regular price and the saving, all labelled").

// 3. No live round (null banner) → the GB path is closed and empty, and a
//    gb-TAGGED product does NOT fall back onto the ships-now shelf. The tag is
//    the intrinsic split (a group-buy listing is a pre-order priced at gbPrice);
//    only genuinely on-hand products may be sold as ships-now between rounds.
check("no live round yields a closed, empty group-buy path", () => {
  const view = buildTwoWaysHomeView(
    [
      product({ id: "c", name: "Charlie", price: 1000, gbPrice: 800, productType: "gb" }),
      product({ id: "oh", name: "Ready stock", price: 1200 }),
    ],
    null,
    "₱",
    NOW,
  );
  assert.equal(view.gb.open, false);
  assert.equal(view.gb.count, 0);
  assert.equal(view.gb.countdown, "");
  // Only the untagged product is on-hand; the gb listing is not ships-now stock.
  assert.deepEqual(view.onHand.lines.map((l) => l.product.id), ["oh"]);
});

// 3b. REGRESSION (k-glow, 2026-08-17): "when the group buy is closed the on-hand
//     page gets the group-buy prices". k-glow's catalog is ~25 productType "gb"
//     PasaBuy listings plus 6 separately-seeded on-hand rows ("-OH" SKUs, no
//     productType — see scripts/seed-kglow-onhand.ts). Membership was resolved
//     from the LIVE ROUND ALONE, so a null banner (round closed) returned every
//     group-buy listing to the ships-now shelf at its group-buy price.
check("a closed round never returns group-buy listings to the on-hand shelf", () => {
  const catalog = [
    product({ id: "gb-tirz", name: "Tirzepatide", price: 3000, productType: "gb" }),
    product({ id: "gb-ghk", name: "GHK-CU", price: 1595, productType: "gb" }),
    product({ id: "oh-tirz", name: "Tirzepatide", price: 3200 }), // the "-OH" row
    product({ id: "oh-ghk", name: "GHK-CU", price: 1800 }),
  ];
  const live = buildTwoWaysHomeView(
    catalog,
    banner({ coversAll: false, productIds: ["gb-tirz", "gb-ghk"] }),
    "₱",
    NOW,
  );
  const shelfWhileLive = live.onHand.lines.map((l) => l.product.id);
  assert.deepEqual(shelfWhileLive, ["oh-tirz", "oh-ghk"]);

  // The round closes. The shelf must not change.
  const closed = buildTwoWaysHomeView(catalog, null, "₱", NOW);
  assert.deepEqual(
    closed.onHand.lines.map((l) => l.product.id),
    shelfWhileLive,
    "closing the round must leave the on-hand shelf exactly as it was",
  );
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

// 5. A scoped round claims only its assigned products for the TEASER — but a
//    gb-tagged product OUTSIDE the round is still not ships-now stock, so it
//    stays off the on-hand shelf too. Round scope drives what the teaser counts;
//    the tag drives what may be sold as on-hand.
check("scoped round claims only assigned products, even among gb-tagged ones", () => {
  const products = [
    product({ id: "c", name: "Charlie", price: 1000, gbPrice: 800, productType: "gb" }),
    product({ id: "d", name: "Delta", price: 900, gbPrice: 700, productType: "gb" }),
    product({ id: "e", name: "Echo", price: 500 }),
  ];
  const view = buildTwoWaysHomeView(
    products,
    banner({ coversAll: false, productIds: ["c"] }),
    "₱",
    NOW,
  );
  assert.equal(view.gb.count, 1);
  assert.deepEqual(view.gb.productIds, ["c"]);
  assert.deepEqual(view.onHand.lines.map((l) => l.product.id), ["e"]);
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

// ── An open round never shares the home page with the on-hand shelf ──────────
// Owner decision (k-glow): while a round is LIVE its products belong on the
// dedicated #groupbuy page ONLY. The home keeps the on-hand shelf ("ships
// today") plus the round's chrome as a teaser that links out — it must never
// render the round's products (and therefore never offers add-to-cart for
// them), so a shopper can't build a mixed on-hand/group-buy cart from one page.

console.log("\nan open round's products stay off the home (dedicated #groupbuy page)\n");

/** The gb path as the home may expose it, without asserting the old shape. */
function gbPath(view: ReturnType<typeof buildTwoWaysHomeView>) {
  return view.gb as typeof view.gb & { productIds?: string[]; lines?: unknown[] };
}

check("a live round contributes NO product lines to the home view", () => {
  const products = [
    product({ id: "a", name: "Alpha", price: 1000 }),
    product({ id: "b", name: "Bravo", price: 1500 }),
    product({ id: "c", name: "Charlie", price: 1000, gbPrice: 800, productType: "gb" }),
  ];
  const gb = gbPath(
    buildTwoWaysHomeView(products, banner({ coversAll: false, productIds: ["c"] }), "₱", NOW),
  );
  assert.equal(gb.lines, undefined, "the home must not carry group-buy product lines");
});

check("the round's products are absent from the home's on-hand shelf too", () => {
  const products = [
    product({ id: "a", name: "Alpha", price: 1000 }),
    product({ id: "c", name: "Charlie", price: 1000, gbPrice: 800, productType: "gb" }),
  ];
  const view = buildTwoWaysHomeView(
    products,
    banner({ coversAll: false, productIds: ["c"] }),
    "₱",
    NOW,
  );
  // "c" is in the round → it appears in NO list on the home.
  assert.deepEqual(view.onHand.lines.map((l) => l.product.id), ["a"]);
});

check("the home still names the round's products so the page cross-check holds", () => {
  const products = [
    product({ id: "a", name: "Alpha", price: 1000 }),
    product({ id: "c", name: "Charlie", price: 1000, productType: "gb" }),
    product({ id: "d", name: "Delta", price: 900, productType: "gb" }),
  ];
  const gb = gbPath(
    buildTwoWaysHomeView(products, banner({ coversAll: false, productIds: ["c", "d"] }), "₱", NOW),
  );
  assert.deepEqual(gb.productIds, ["c", "d"]);
  assert.equal(gb.count, 2, "the teaser still reports how many items are in the round");
});

check("a catalog-wide round empties the home's on-hand shelf, listing nothing itself", () => {
  const products = [
    product({ id: "a", name: "Alpha", price: 1000 }),
    product({ id: "b", name: "Bravo", price: 1500, gbPrice: 1200 }),
  ];
  const view = buildTwoWaysHomeView(products, banner({ coversAll: true }), "₱", NOW);
  assert.equal(view.onHand.count, 0);
  assert.equal(gbPath(view).lines, undefined);
  assert.equal(view.gb.count, 2);
});

check("the home keeps the round chrome so the teaser can link to the group-buy page", () => {
  const view = buildTwoWaysHomeView(
    [product({ id: "c", name: "Charlie", price: 1000, productType: "gb" })],
    banner({ name: "June GB", endsAt: "2026-07-25T00:00:00.000Z", slotGoal: 30, filled: 18 }),
    "₱",
    NOW,
  );
  assert.equal(view.gb.open, true);
  assert.equal(view.gb.name, "June GB");
  assert.equal(view.gb.countdown, "Closes in 3 days");
  assert.equal(view.gb.deliveryEta, "3–4 weeks after close");
  assert.equal(view.gb.slots.pct, 60);
});

// ── Per-way management (./two-ways-mode) ────────────────────────────────────
// A store may sell only one way (Dragon Peptides: group buy only). The home
// view-model has to honour that WITHOUT changing anything for the tenants that
// never touch the setting.

const SHELF = [
  product({ id: "a", name: "Alpha", price: 1000 }),
  product({ id: "b", name: "Bravo", price: 2000 }),
];

check("omitting the ways argument keeps today's home exactly as it was", () => {
  const view = buildTwoWaysHomeView(SHELF, null, "₱", NOW);
  assert.equal(view.onHand.count, 2);
  assert.equal(view.onHand.state, "open");
  assert.equal(view.onHand.lines[0].buyable, true);
  assert.equal(view.gb.state, "open");
  assert.equal(view.visibleWays, 2);
  assert.equal(view.heading, "Two ways to order");
});

check("a HIDDEN on-hand way empties the shelf entirely", () => {
  const view = buildTwoWaysHomeView(SHELF, null, "₱", NOW, "catalog", {
    onHand: "hidden",
    groupBuy: "open",
  });
  assert.equal(view.onHand.state, "hidden");
  assert.equal(view.onHand.count, 0);
  assert.deepEqual(view.onHand.lines, []);
  assert.equal(view.visibleWays, 1);
  assert.equal(view.heading, "How to order");
});

check("a CLOSED on-hand way still lists the shelf, but nothing is buyable", () => {
  const view = buildTwoWaysHomeView(SHELF, null, "₱", NOW, "catalog", {
    onHand: "closed",
    groupBuy: "open",
  });
  assert.equal(view.onHand.state, "closed");
  assert.equal(view.onHand.count, 2, "a paused shelf is still shown");
  assert.equal(view.onHand.lines.every((l) => l.buyable === false), true);
  assert.equal(view.onHand.lines[0].inStock, true, "stock is unchanged — only the way is shut");
  assert.equal(view.visibleWays, 2, "a closed way is still visible");
});

check("an out-of-stock line is never buyable even while the way is open", () => {
  const view = buildTwoWaysHomeView(
    [product({ id: "z", name: "Zulu", price: 500, stock: 0 })],
    null,
    "₱",
    NOW,
  );
  assert.equal(view.onHand.lines[0].inStock, false);
  assert.equal(view.onHand.lines[0].buyable, false);
});

check("a HIDDEN group-buy way closes the GB path even with a live round", () => {
  const view = buildTwoWaysHomeView(
    [product({ id: "a", name: "Alpha", price: 1000 }), product({ id: "c", name: "Charlie", price: 900 })],
    banner({ coversAll: false, productIds: ["c"] }),
    "₱",
    NOW,
    "catalog",
    { onHand: "open", groupBuy: "hidden" },
  );
  assert.equal(view.gb.state, "hidden");
  assert.equal(view.gb.open, false, "the teaser must not render");
  assert.equal(view.visibleWays, 1);
  assert.equal(view.heading, "How to order");
});

// The round's products are PRE-ORDERS priced at gbPrice — hiding the group-buy
// way must never dump them onto the ships-now shelf at their on-hand price.
check("hiding the group-buy way does NOT spill the round's products onto the shelf", () => {
  const view = buildTwoWaysHomeView(
    [product({ id: "a", name: "Alpha", price: 1000 }), product({ id: "c", name: "Charlie", price: 900 })],
    banner({ coversAll: false, productIds: ["c"] }),
    "₱",
    NOW,
    "catalog",
    { onHand: "open", groupBuy: "hidden" },
  );
  assert.deepEqual(view.onHand.lines.map((l) => l.product.id), ["a"]);
});

check("a CLOSED group-buy way keeps the round chrome but stops the join path", () => {
  const view = buildTwoWaysHomeView(
    [product({ id: "c", name: "Charlie", price: 900 })],
    banner({ coversAll: false, productIds: ["c"], name: "June GB" }),
    "₱",
    NOW,
    "catalog",
    { onHand: "open", groupBuy: "closed" },
  );
  assert.equal(view.gb.state, "closed");
  assert.equal(view.gb.open, false, "a closed way must not offer the join CTA");
  assert.equal(view.visibleWays, 2, "but the card is still shown, marked closed");
});

check("junk in the ways argument falls back to both ways open", () => {
  const view = buildTwoWaysHomeView(
    SHELF,
    null,
    "₱",
    NOW,
    "catalog",
    { onHand: "gone", groupBuy: null } as never,
  );
  assert.equal(view.onHand.state, "open");
  assert.equal(view.onHand.count, 2);
  assert.equal(view.gb.state, "open");
});

check("the ways argument is never mutated", () => {
  const ways = { onHand: "closed", groupBuy: "open" } as const;
  buildTwoWaysHomeView(SHELF, null, "₱", NOW, "catalog", ways);
  assert.equal(ways.onHand, "closed");
});

// WIRING: a hidden group-buy way must remove the GB surfaces WITHOUT dropping
// brand.groupBuyBanner. The banner is what tells the home which products belong
// to the round; deleting it would return those pre-orders to the ships-now shelf
// at their on-hand price. So the components gate on the way state instead.
check("the storefront page never deletes the banner to hide the group-buy way", () => {
  const src = readFileSync(
    join(__dirname, "..", "src/app/(tenant)/(storefront)/page.tsx"),
    "utf8",
  );
  assert.doesNotMatch(
    src,
    /delete\s*\(?[^\n]*groupBuyBanner/,
    "deleting the banner would spill the round's pre-orders onto the on-hand shelf",
  );
  assert.match(src, /resolveWays\(/, "the page must resolve the effective per-way states");
});

check("the header hides the Group Buy nav item when the way is hidden", () => {
  const src = readFileSync(join(__dirname, "..", "src/storefront/components/Header.tsx"), "utf8");
  assert.match(
    src,
    /twoWaysMode[^\n]*groupBuy/,
    "the Group Buy nav item must be gated on the group-buy way state",
  );
});

check("TwoWaysHome reads the resolved ways rather than assuming two", () => {
  const src = readFileSync(
    join(__dirname, "..", "src/storefront/components/TwoWaysHome.tsx"),
    "utf8",
  );
  assert.match(src, /view\.heading/, "the heading must come from the view-model");
  assert.doesNotMatch(
    src,
    />\s*Two ways to order\s*</,
    "the heading must not be hardcoded — a one-way store never claims two",
  );
  assert.match(src, /onHand\.state/, "the on-hand section must respect its way state");
});

// WIRING: the component must not render the round's item rows / add-to-cart.
check("TwoWaysHome renders no group-buy item rows and routes to the group-buy page", () => {
  const src = readFileSync(
    join(__dirname, "..", "src/storefront/components/TwoWaysHome.tsx"),
    "utf8",
  );
  assert.doesNotMatch(src, /sf-twh__gb-items/, "the home must not render a group-buy item list");
  assert.doesNotMatch(src, /GbItemRow/, "the home must not render group-buy product rows");
  assert.match(src, /onOpenGroupBuy/, "the live round must link out to the group-buy page");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
