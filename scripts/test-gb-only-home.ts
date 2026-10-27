/**
 * Gate for the group-buy-only home (src/lib/storefront/gb-only-home.ts): a
 * store that sells ONLY by group buy (on-hand hidden) shows the round on its
 * home, so it must not also advertise a separate "Group Buy" page that lists
 * the same products a second time.
 *
 *   npm run test:gb-only-home
 */
import assert from "node:assert";
import { isGroupBuyOnlyHome } from "../src/lib/storefront/gb-only-home";
import { buildStorefrontNav } from "../src/lib/storefront/nav";
import type { Brand } from "../src/storefront/types";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message.split("\n").slice(0, 6).join("\n    ")}`);
  }
}

const banner = { name: "Batch 10", coversAll: true, productIds: [] } as unknown as NonNullable<Brand["groupBuyBanner"]>;
const teaser = { id: "gb1", name: "Batch 10" } as unknown as NonNullable<Brand["groupBuyTeaser"]>;

// mnm-pepsabuy as an approved member sees it: classic layout, on-hand hidden, live round.
const gbOnly = (over: Partial<Brand> = {}): Brand =>
  ({
    name: "MNM",
    homeLayout: "classic",
    twoWaysMode: { onHand: "hidden", groupBuy: "open" },
    groupBuyBanner: banner,
    groupBuyListingCount: 8,
    nav: [],
    ...over,
  }) as unknown as Brand;

console.log("\nWhen the home IS the group buy");

test("approved member on a group-buy-only store", () => {
  assert.equal(isGroupBuyOnlyHome(gbOnly()), true);
});

test("the two-ways layout with on-hand hidden is the same store", () => {
  assert.equal(isGroupBuyOnlyHome(gbOnly({ homeLayout: "two-ways" })), true);
});

test("between rounds, gb listings still shown view-only", () => {
  assert.equal(isGroupBuyOnlyHome(gbOnly({ groupBuyBanner: undefined, groupBuyListingCount: 3 })), true);
});

test("a closed group-buy way still counts (prices stay browsable)", () => {
  assert.equal(isGroupBuyOnlyHome(gbOnly({ twoWaysMode: { onHand: "hidden", groupBuy: "closed" } })), true);
});

console.log("\nWhen it is not");

test("locked-out visitor keeps the join page (teaser present)", () => {
  assert.equal(isGroupBuyOnlyHome(gbOnly({ groupBuyTeaser: teaser })), false);
});

test("a store that also sells on-hand keeps both ways", () => {
  assert.equal(isGroupBuyOnlyHome(gbOnly({ twoWaysMode: { onHand: "open", groupBuy: "open" } })), false);
  assert.equal(isGroupBuyOnlyHome(gbOnly({ twoWaysMode: { onHand: "closed", groupBuy: "open" } })), false);
});

test("an unset way config is both-ways (every untouched tenant)", () => {
  assert.equal(isGroupBuyOnlyHome(gbOnly({ twoWaysMode: undefined })), false);
});

test("hidden group buy, or nothing to list", () => {
  assert.equal(isGroupBuyOnlyHome(gbOnly({ twoWaysMode: { onHand: "hidden", groupBuy: "hidden" } })), false);
  assert.equal(isGroupBuyOnlyHome(gbOnly({ groupBuyBanner: undefined, groupBuyListingCount: 0 })), false);
});

test("layouts with their own catalog screen keep their design", () => {
  for (const homeLayout of ["boutique", "editorial", "showcase"] as const) {
    assert.equal(isGroupBuyOnlyHome(gbOnly({ homeLayout })), false, homeLayout);
  }
});

console.log("\nNav");

test("no separate Group Buy link when the home is the group buy", () => {
  const nav = buildStorefrontNav(gbOnly());
  assert.equal(nav.some((i) => i.href === "#groupbuy"), false);
});

test("an owner-added #groupbuy link is dropped too (it would only reopen home)", () => {
  const nav = buildStorefrontNav(gbOnly({ nav: [{ label: "Group Buy", href: "#groupbuy" }, { label: "FAQ", href: "#faq" }] }));
  assert.deepEqual(nav.map((i) => i.href).filter((h) => h !== "#calculator"), ["#faq"]);
});

test("both-ways stores still get the Group Buy link", () => {
  const nav = buildStorefrontNav(gbOnly({ twoWaysMode: { onHand: "open", groupBuy: "open" } }));
  assert.equal(nav[0]?.href, "#groupbuy");
});

test("locked-out visitor still gets the link to the join page", () => {
  const nav = buildStorefrontNav(gbOnly({ groupBuyTeaser: teaser, groupBuyBanner: undefined }));
  assert.equal(nav[0]?.href, "#groupbuy");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
