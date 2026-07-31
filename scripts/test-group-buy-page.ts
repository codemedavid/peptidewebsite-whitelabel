/**
 * Tests for the K Glow "Group Buy" page core — src/lib/storefront/group-buy-page.ts
 * plus the group-buy pricing that makes the page truthful: a group-buy product is
 * CHARGED its gbPrice while a round is live (storefront/checkout.ts unitPrice /
 * cartTotal / authoritativeItemPrice), so the single price the page shows is the
 * price the cart and the server both charge.
 *
 * The page is the presentation of the live Group Buy round for the kglow tenant
 * (design: "Group Buy Page.dc.html"). It lists the round's group-buy products at
 * one price each (no on-hand-vs-GB comparison), under the live round's chrome:
 * countdown (from endsAt), slot-goal progress (slotProgress) and delivery ETA.
 *
 * Pure functions under test:
 *   gbCountdownLabel     — "Closes in 5 days" from the round's endsAt; "" when
 *                          open-ended, "Closed" once the boundary passed.
 *   productInitial       — the card's monogram tile (first letter, uppercased).
 *   formatGbMoney        — "₱1,200" currency glyph + grouped amount.
 *   buildGroupBuyPageView— the page view-model: GB products (scoped to the round)
 *                          priced at gbPrice, plus name / countdown / slots.
 *   unitPrice(p,q,live)  — charges gbPrice for a GB product while a round is live.
 *   cartTotal(l,live)    — sums the cart at the live group-buy prices.
 *   authoritativeItemPrice(item,catalog,live) — the server's per-unit GB price.
 *   buildGroupBuyBanner  — now surfaces the round's endsAt for the countdown.
 *
 *   npm run test:group-buy-page
 */

import assert from "node:assert";

import {
  gbCountdownLabel,
  productInitial,
  formatGbMoney,
  gbDisplayName,
  buildGroupBuyPageView,
  groupBuyCartSummary,
} from "../src/lib/storefront/group-buy-page";
import { buildTwoWaysHomeView } from "../src/lib/storefront/two-ways-home";
import {
  unitPrice,
  cartTotal,
  authoritativeItemPrice,
  liveCartLines,
} from "../src/storefront/checkout";
import { normalizeGroupBuy, type GroupBuy } from "../src/lib/storefront/group-buy";
import type { GroupBuyPriceScope } from "../src/lib/storefront/two-ways";
import {
  buildGroupBuyBanner,
  type GroupBuyBanner,
} from "../src/lib/storefront/group-buy-banner";
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

// A minimal but real storefront Product (the page + pricing read name/price/
// gbPrice/productType/id/currency).
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

const NOW = new Date("2026-06-10T12:00:00.000Z");

function main() {
  console.log("\ngbCountdownLabel\n");

  check("no endsAt (open-ended round) → empty string", () => {
    assert.equal(gbCountdownLabel(null, NOW), "");
    assert.equal(gbCountdownLabel(undefined, NOW), "");
  });
  check("invalid date → empty string", () => {
    assert.equal(gbCountdownLabel("not-a-date", NOW), "");
  });
  check("~5 days out → 'Closes in 5 days'", () => {
    assert.equal(gbCountdownLabel("2026-06-15T12:00:00.000Z", NOW), "Closes in 5 days");
  });
  check("within the last day → 'Closes in 1 day' (singular)", () => {
    assert.equal(gbCountdownLabel("2026-06-11T06:00:00.000Z", NOW), "Closes in 1 day");
  });
  check("boundary passed → 'Closed'", () => {
    assert.equal(gbCountdownLabel("2026-06-09T12:00:00.000Z", NOW), "Closed");
  });

  console.log("\nproductInitial\n");

  check("first letter, uppercased", () => {
    assert.equal(productInitial("Retatrutide"), "R");
    assert.equal(productInitial("glow serum"), "G");
  });
  check("trims leading whitespace", () => {
    assert.equal(productInitial("  klow"), "K");
  });
  check("empty / missing name → a neutral placeholder", () => {
    assert.equal(productInitial(""), "•");
    assert.equal(productInitial("   "), "•");
  });

  console.log("\nformatGbMoney\n");

  check("currency glyph + grouped thousands", () => {
    assert.equal(formatGbMoney("₱", 1200), "₱1,200");
    assert.equal(formatGbMoney("$", 560), "$560");
  });
  check("negative amounts are clamped to 0", () => {
    assert.equal(formatGbMoney("₱", -50), "₱0");
  });

  // The k-glow catalog keeps the dose in metadata.variations, NOT in the product
  // name ("Semaglutide" + a "5mg × 10 vials" variation). The group-buy page is the
  // only surface that lists a round's products, and it rendered the bare name — so
  // during an open round every card read "Semaglutide" with the mg nowhere on it.
  console.log("\ngbDisplayName — the card name carries the dose\n");

  check("no variations → name unchanged", () => {
    assert.equal(gbDisplayName("KPV", undefined), "KPV");
    assert.equal(gbDisplayName("Selank", []), "Selank");
  });

  check("one variation → its full name is appended (pack size kept)", () => {
    assert.equal(
      gbDisplayName("Semaglutide", [{ name: "5mg × 10 vials", price: 4200 }]),
      "Semaglutide 5mg × 10 vials",
    );
  });

  check("several variations → just the dose tokens, joined", () => {
    assert.equal(
      gbDisplayName("Cagrilintide", [
        { name: "5mg", price: 3000 },
        { name: "10mg", price: 5000 },
      ]),
      "Cagrilintide 5mg / 10mg",
    );
    // The 9-dose k-glow Tirzepatide: full variation names would run past 140
    // characters, so the shared "× 10 vials" suffix is dropped.
    assert.equal(
      gbDisplayName("Tirzepatide", [
        { name: "5mg × 10 vials", price: 1 },
        { name: "10mg × 10 vials", price: 2 },
        { name: "15mg × 10 vials", price: 3 },
      ]),
      "Tirzepatide 5mg / 10mg / 15mg",
    );
  });

  check("non-mg units (ml) are treated as doses too", () => {
    assert.equal(
      gbDisplayName("Bacteriostatic Water", [
        { name: "3ml", price: 1 },
        { name: "5ml", price: 2 },
        { name: "10ml", price: 3 },
      ]),
      "Bacteriostatic Water 3ml / 5ml / 10ml",
    );
  });

  check("a name that ALREADY carries a dose is left alone (no duplication)", () => {
    // Real k-glow rows — appending would read "Lemon Bottle 10ml 10ml / 50ml".
    assert.equal(
      gbDisplayName("Lemon Bottle 10ml", [
        { name: "10ml", price: 1 },
        { name: "50ml", price: 2 },
      ]),
      "Lemon Bottle 10ml",
    );
    assert.equal(
      gbDisplayName("BPC 10mg + TB 10mg", [{ name: "20mg × 10 vials", price: 1 }]),
      "BPC 10mg + TB 10mg",
    );
  });

  check("variations with no dose token fall back to their full names", () => {
    assert.equal(
      gbDisplayName("Starter kit", [
        { name: "Vials only", price: 1 },
        { name: "Complete set", price: 2 },
      ]),
      "Starter kit Vials only / Complete set",
    );
  });

  check("blank / whitespace variation names are ignored", () => {
    assert.equal(gbDisplayName("Epithalon", [{ name: "   ", price: 1 }]), "Epithalon");
  });

  check("the page view-model exposes displayName on every line", () => {
    const catalog = [
      product({
        id: "gb-1",
        name: "Semaglutide",
        price: 4900,
        gbPrice: 4200,
        productType: "gb",
        variations: [{ name: "5mg × 10 vials", price: 4200 }],
      }),
      product({ id: "gb-2", name: "KPV", price: 900, gbPrice: 800, productType: "gb" }),
    ];
    const banner: GroupBuyBanner = {
      id: "gb-round",
      name: "check out now",
      description: "",
      deliveryEta: "",
      endsAt: null,
      slotGoal: 0,
      filled: 0,
      coversAll: true,
      productIds: [],
    };
    const view = buildGroupBuyPageView(catalog, banner, "₱", NOW);
    assert.equal(view.lines[0].displayName, "Semaglutide 5mg × 10 vials");
    assert.equal(view.lines[1].displayName, "KPV");
  });

  console.log("\nunitPrice — charges gbPrice while a round is live\n");

  const gbProduct = product({ id: "gb-1", price: 700, gbPrice: 560, productType: "gb" });
  const onHand = product({ id: "oh-1", price: 850, productType: "onhand" });
  // A live round covering the whole catalog (every gb product is in scope).
  const LIVE: GroupBuyPriceScope = { coversAll: true, productIds: [] };

  check("GB product + round live → gbPrice", () => {
    assert.equal(unitPrice(gbProduct, 1, LIVE), 560);
  });
  check("GB product + NO live round → regular price (default flag off)", () => {
    assert.equal(unitPrice(gbProduct, 1, null), 700);
    assert.equal(unitPrice(gbProduct, 1), 700);
  });
  check("on-hand product is never GB-priced, live or not", () => {
    assert.equal(unitPrice(onHand, 1, LIVE), 850);
    assert.equal(unitPrice(onHand, 1, null), 850);
  });
  check("GB product with no/invalid gbPrice → stays at regular even when live", () => {
    const noGb = product({ id: "gb-2", price: 700, productType: "gb" });
    const badGb = product({ id: "gb-3", price: 700, gbPrice: 900, productType: "gb" });
    assert.equal(unitPrice(noGb, 1, LIVE), 700);
    assert.equal(unitPrice(badGb, 1, LIVE), 700);
  });

  console.log("\ncartTotal / authoritativeItemPrice honor the live GB price\n");

  check("cartTotal sums the live group-buy prices", () => {
    const lines = liveCartLines([gbProduct, gbProduct, onHand], [gbProduct, onHand]);
    // 2×560 (gb) + 1×850 (on-hand) = 1970
    assert.equal(cartTotal(lines, LIVE), 1970);
    // Not live: 2×700 + 850 = 2250
    assert.equal(cartTotal(lines, null), 2250);
  });

  check("authoritativeItemPrice re-derives the GB price server-side when live", () => {
    const item = { productId: "gb-1", name: "Product", qty: 1 };
    assert.equal(authoritativeItemPrice(item, [gbProduct, onHand], LIVE), 560);
    assert.equal(authoritativeItemPrice(item, [gbProduct, onHand], null), 700);
  });

  console.log("\nbuildGroupBuyBanner surfaces endsAt for the countdown\n");

  function gb(partial: Partial<GroupBuy> & Record<string, unknown>): GroupBuy {
    return normalizeGroupBuy({ id: "gb1", name: "June GB", status: "active", ...partial });
  }

  check("banner carries the live round's endsAt", () => {
    const banner = buildGroupBuyBanner(
      [
        gb({
          createdAt: "2026-06-01T00:00:00.000Z",
          endsAt: "2026-06-15T12:00:00.000Z",
          productIds: ["gb-1"],
          slotGoal: 30,
        }),
      ],
      { scheduled: true, productAssignment: true },
      NOW,
    );
    assert.ok(banner);
    assert.equal(banner!.endsAt, "2026-06-15T12:00:00.000Z");
    assert.equal(banner!.filled, 0); // default until page.tsx counts the round's orders
  });

  console.log("\nbuildGroupBuyPageView\n");

  const catalog = [
    product({ id: "gb-1", name: "Retatrutide", price: 700, gbPrice: 560, productType: "gb" }),
    product({ id: "gb-2", name: "Semaglutide", price: 1050, gbPrice: 840, productType: "gb" }),
    product({ id: "oh-1", name: "Bac Water", price: 120, productType: "onhand" }),
  ];

  const scopedBanner: GroupBuyBanner = {
    id: "gb1",
    name: "June GB",
    description: "Live round",
    deliveryEta: "3–4 weeks after close",
    productIds: ["gb-1"], // round only assigns gb-1
    coversAll: false,
    slotGoal: 30,
    endsAt: "2026-06-15T12:00:00.000Z",
    filled: 18,
  };

  check("lists only the round's group-buy products, priced at gbPrice", () => {
    const view = buildGroupBuyPageView(catalog, scopedBanner, "₱", NOW);
    assert.equal(view.live, true);
    assert.equal(view.count, 1);
    assert.deepEqual(view.lines.map((l) => l.product.id), ["gb-1"]);
    assert.equal(view.lines[0].priceLabel, "₱560");
    assert.equal(view.lines[0].initial, "R");
  });

  check("covers-all round → the whole catalog is the run (matches the two-ways home)", () => {
    const banner: GroupBuyBanner = { ...scopedBanner, productIds: [], coversAll: true };
    const view = buildGroupBuyPageView(catalog, banner, "₱", NOW);
    // coversAll means every product is part of the run — same as the home, which
    // puts nothing on-hand when coversAll is true.
    assert.deepEqual(view.lines.map((l) => l.product.id), ["gb-1", "gb-2", "oh-1"]);
    assert.equal(view.lines[1].priceLabel, "₱840");
    const home = buildTwoWaysHomeView(catalog, banner, "₱", NOW);
    assert.deepEqual(view.lines.map((l) => l.product.id), home.gb.productIds);
  });

  check("surfaces the round chrome: name, countdown, delivery, slot progress", () => {
    const view = buildGroupBuyPageView(catalog, scopedBanner, "₱", NOW);
    assert.equal(view.name, "June GB");
    assert.equal(view.countdown, "Closes in 5 days");
    assert.equal(view.deliveryEta, "3–4 weeks after close");
    assert.equal(view.slots.enabled, true);
    assert.equal(view.slots.goal, 30);
    assert.equal(view.slots.filled, 18);
    assert.equal(view.slots.pct, 60);
  });

  check("no live round (null banner) → not live, empty listing", () => {
    const view = buildGroupBuyPageView(catalog, null, "₱", NOW);
    assert.equal(view.live, false);
    assert.equal(view.count, 0);
    assert.deepEqual(view.lines, []);
  });

  console.log("\nlive-round membership drives the page (consistent with the two-ways home)\n");

  // Reproduces the reported bug: the home advertises the round as open, but the
  // dedicated page said "No group buy right now" because the round's assigned
  // products were never tagged productType 'gb'. The page must list a round's
  // assigned products by membership — exactly like the home — regardless of tag.
  check("lists the round's assigned products even when they are not tagged productType 'gb'", () => {
    const untagged = [
      product({ id: "p1", name: "Tirzepatide 30mg", price: 1050 }), // no productType, no gbPrice
      product({ id: "p2", name: "GHK-Cu 100mg", price: 700 }),
      product({ id: "p3", name: "Bac Water", price: 120 }), // not in the round
    ];
    const banner: GroupBuyBanner = { ...scopedBanner, productIds: ["p1", "p2"], coversAll: false };
    const view = buildGroupBuyPageView(untagged, banner, "₱", NOW);
    assert.equal(view.live, true);
    assert.deepEqual(view.lines.map((l) => l.product.id), ["p1", "p2"]); // p3 excluded (not assigned)
  });

  check("the page and the two-ways home agree on which products are in the round", () => {
    const untagged = [
      product({ id: "p1", name: "Tirzepatide 30mg", price: 1050 }),
      product({ id: "p2", name: "GHK-Cu 100mg", price: 700 }),
      product({ id: "p3", name: "Bac Water", price: 120 }),
    ];
    const banner: GroupBuyBanner = { ...scopedBanner, productIds: ["p1", "p2"], coversAll: false };
    const page = buildGroupBuyPageView(untagged, banner, "₱", NOW);
    const home = buildTwoWaysHomeView(untagged, banner, "₱", NOW);
    // The home no longer LISTS the round's items (they live on this page only),
    // but it must still agree on which products the round covers — otherwise the
    // teaser advertises a round the page renders empty.
    assert.deepEqual(page.lines.map((l) => l.product.id), home.gb.productIds);
    assert.ok(page.count > 0); // both non-empty → no "open on home, empty on page" split
  });

  console.log("\nline surfaces the regular-vs-GB saving (design: save badge + strikethrough)\n");

  check("each line exposes gb price, regular price and the saving, all labelled", () => {
    const view = buildGroupBuyPageView(catalog, scopedBanner, "₱", NOW);
    const line = view.lines[0]; // gb-1: Retatrutide, price 700, gbPrice 560
    assert.equal(line.price, 560);
    assert.equal(line.priceLabel, "₱560"); // gb price is still the primary price
    assert.equal(line.regularPrice, 700);
    assert.equal(line.regularLabel, "₱700");
    assert.equal(line.savings, 140);
    assert.equal(line.saveLabel, "₱140");
    assert.equal(line.hasSavings, true);
  });

  check("a GB product with no valid gbPrice shows no saving (badge hidden)", () => {
    const noSaveCatalog = [
      product({ id: "gb-x", name: "Flat", price: 700, productType: "gb" }),
    ];
    const banner: GroupBuyBanner = { ...scopedBanner, productIds: [], coversAll: true };
    const view = buildGroupBuyPageView(noSaveCatalog, banner, "₱", NOW);
    const line = view.lines[0];
    assert.equal(line.hasSavings, false);
    assert.equal(line.savings, 0);
    assert.equal(line.price, line.regularPrice);
  });

  console.log("\ngroupBuyCartSummary — sticky cart bar total + saving\n");

  // The summary now takes CART ENTRIES (one per unit, with the unit price the
  // checkout actually charges + the entry's own regular price) instead of a
  // qty-by-base-id map — so a variation clone (own price) is counted at ITS
  // price, and the bar's total always matches what checkout charges.

  check("sums the live GB prices and the saving vs regular across the cart", () => {
    const view = buildGroupBuyPageView(catalog, scopedBanner, "₱", NOW);
    // 2× Retatrutide (gb 560 / reg 700) in cart — one entry per cart unit.
    const entry = { id: "gb-1", unit: 560, regular: 700 };
    const summary = groupBuyCartSummary(view.lines, [entry, entry], "₱");
    assert.equal(summary.totalQty, 2);
    assert.equal(summary.total, 1120); // 2 × 560
    assert.equal(summary.regularTotal, 1400); // 2 × 700
    assert.equal(summary.savings, 280); // 2 × 140
    assert.equal(summary.totalLabel, "₱1,120");
    assert.equal(summary.savingsLabel, "₱280");
    assert.equal(summary.hasItems, true);
  });

  check("empty cart → zeroed summary, hasItems false (cart bar hidden)", () => {
    const view = buildGroupBuyPageView(catalog, scopedBanner, "₱", NOW);
    const summary = groupBuyCartSummary(view.lines, [], "₱");
    assert.equal(summary.totalQty, 0);
    assert.equal(summary.total, 0);
    assert.equal(summary.savings, 0);
    assert.equal(summary.hasItems, false);
  });

  check("ignores entries for products not on the page (out-of-scope ids)", () => {
    const view = buildGroupBuyPageView(catalog, scopedBanner, "₱", NOW);
    // gb-2 is not in the scoped round; a stray entry for it must not be counted.
    const summary = groupBuyCartSummary(
      view.lines,
      [
        { id: "gb-1", unit: 560, regular: 700 },
        { id: "gb-2", unit: 999, regular: 999 },
      ],
      "₱",
    );
    assert.equal(summary.totalQty, 1);
    assert.equal(summary.total, 560);
  });

  check("a variation entry counts at ITS charged price, not the base line price", () => {
    const view = buildGroupBuyPageView(catalog, scopedBanner, "₱", NOW);
    // A 10mg variation of Retatrutide priced ₱500 — checkout charges ₱500
    // (min(gbPrice, variation price)); the bar must show the same, with the
    // saving derived from the entry's own regular (₱500), not the base ₱700.
    const summary = groupBuyCartSummary(
      view.lines,
      [{ id: "gb-1", unit: 500, regular: 500 }],
      "₱",
    );
    assert.equal(summary.totalQty, 1);
    assert.equal(summary.total, 500);
    assert.equal(summary.regularTotal, 500);
    assert.equal(summary.savings, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
