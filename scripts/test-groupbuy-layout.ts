/**
 * Gate for the "groupbuy" home layout — the group-buy-only website.
 *
 * A layout, not a switch combination: picking it makes the store sell by group
 * buy ONLY, everywhere (home, cart, server checkout), so the per-way "Ways to
 * order" switches have nothing left to decide and go away.
 *
 *   npm run test:groupbuy-layout
 */
import assert from "node:assert";
import { HOME_LAYOUTS, isGroupBuyLayout } from "../src/lib/storefront/home-layout";
import { resolveHomeLayout } from "../src/lib/storefront/two-ways-home";
import {
  GROUP_BUY_ONLY_WAYS,
  isOnHandHidden,
  storedTwoWaysMode,
  waysAreLayoutOwned,
} from "../src/lib/storefront/two-ways-mode";
import { isGroupBuyOnlyHome } from "../src/lib/storefront/gb-only-home";
import { buildStorefrontNav } from "../src/lib/storefront/nav";
import { applyTenantPreset, getTenantPreset, removeTenantPreset } from "../src/lib/tenant/presets";
import { FEATURES } from "../src/lib/features/catalog";
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

const gbLayout = (over: Partial<Brand> = {}): Brand =>
  ({
    name: "Store",
    homeLayout: "groupbuy",
    twoWaysMode: { ...GROUP_BUY_ONLY_WAYS },
    groupBuyBanner: banner,
    groupBuyListingCount: 8,
    nav: [],
    ...over,
  }) as unknown as Brand;

console.log("layout enum");
test("groupbuy is a selectable home layout", () => {
  assert.ok((HOME_LAYOUTS as readonly string[]).includes("groupbuy"));
});
test("isGroupBuyLayout matches the exact stored value only", () => {
  assert.equal(isGroupBuyLayout("groupbuy"), true);
  for (const v of ["Groupbuy", " groupbuy", "group-buy", "two-ways", undefined, null, 1]) {
    assert.equal(isGroupBuyLayout(v), false, String(v));
  }
});

console.log("resolveHomeLayout");
test("groupbuy resolves when the Group Buy module is on", () => {
  assert.equal(resolveHomeLayout(false, "groupbuy", true), "groupbuy");
  assert.equal(resolveHomeLayout(true, "groupbuy", true), "groupbuy");
});
test("without the module it fails closed to classic, never two-ways", () => {
  assert.equal(resolveHomeLayout(false, "groupbuy", false), "classic");
  // The entitled-but-unrecognised branch used to turn ANY value into two-ways.
  assert.equal(resolveHomeLayout(true, "groupbuy", false), "classic");
  assert.equal(resolveHomeLayout(true, "groupbuy"), "classic");
});
test("other layouts are unchanged by the new argument", () => {
  assert.equal(resolveHomeLayout(true, undefined, true), "two-ways");
  assert.equal(resolveHomeLayout(true, "classic", true), "classic");
  assert.equal(resolveHomeLayout(false, "showcase", true), "showcase");
  assert.equal(resolveHomeLayout(false, "two-ways", true), "classic");
});

console.log("storedTwoWaysMode — the layout owns the ways");
test("groupbuy layout forces on-hand hidden whatever is stored", () => {
  for (const stored of [undefined, { onHand: "open", groupBuy: "open" }, { onHand: "closed", groupBuy: "hidden" }, "junk"]) {
    assert.deepEqual(storedTwoWaysMode({ homeLayout: "groupbuy", twoWaysMode: stored }), GROUP_BUY_ONLY_WAYS);
  }
});
test("GROUP_BUY_ONLY_WAYS = on-hand hidden, group buy open", () => {
  assert.deepEqual(GROUP_BUY_ONLY_WAYS, { onHand: "hidden", groupBuy: "open" });
});
test("every other layout reads the owner's stored switches", () => {
  const stored = { onHand: "closed", groupBuy: "open" };
  assert.deepEqual(storedTwoWaysMode({ homeLayout: "two-ways", twoWaysMode: stored }), stored);
  assert.deepEqual(storedTwoWaysMode({ twoWaysMode: stored }), stored);
  assert.deepEqual(storedTwoWaysMode({}), { onHand: "open", groupBuy: "open" });
});
test("server gates see on-hand as hidden on the groupbuy layout", () => {
  assert.equal(isOnHandHidden(storedTwoWaysMode({ homeLayout: "groupbuy" })), true);
});
test("returns a fresh object (never the shared constant)", () => {
  assert.notStrictEqual(storedTwoWaysMode({ homeLayout: "groupbuy" }), GROUP_BUY_ONLY_WAYS);
});
test("waysAreLayoutOwned flags the layout whose Ways to order panel goes", () => {
  assert.equal(waysAreLayoutOwned("groupbuy"), true);
  assert.equal(waysAreLayoutOwned("two-ways"), false);
  assert.equal(waysAreLayoutOwned("classic"), false);
  assert.equal(waysAreLayoutOwned(undefined), false);
});

console.log("home = the group buy");
test("the groupbuy layout renders the round as the home", () => {
  assert.equal(isGroupBuyOnlyHome(gbLayout()), true);
});
test("…even between rounds with nothing listed (the page shows its empty state)", () => {
  assert.equal(isGroupBuyOnlyHome(gbLayout({ groupBuyBanner: undefined, groupBuyListingCount: 0 })), true);
});
test("a visitor a paid round locked out still gets the join page", () => {
  assert.equal(isGroupBuyOnlyHome(gbLayout({ groupBuyTeaser: teaser })), false);
});
test("no separate Group Buy nav link on the groupbuy layout", () => {
  const nav = buildStorefrontNav(
    gbLayout({ nav: [{ label: "Group Buy", href: "#groupbuy" }, { label: "FAQ", href: "#faq" }] } as Partial<Brand>),
  );
  assert.ok(!nav.some((l) => l.href === "#groupbuy"), JSON.stringify(nav));
  assert.ok(nav.some((l) => l.href === "#faq"));
});

console.log("groupbuy-only preset (the package)");
const preset = getTenantPreset("groupbuy-only");
test("preset exists", () => assert.ok(preset));
test("preset sets the layout and grants the group buy module", () => {
  assert.equal(preset!.config.homeLayout, "groupbuy");
  assert.ok(preset!.features.includes(FEATURES.GB_MODULE));
});
test("preset never ships the two-ways grant or on-hand switches", () => {
  assert.ok(!preset!.features.includes(FEATURES.GB_TWO_WAYS_HOME));
  assert.equal("groupBuyAllowOnHand" in preset!.config, false);
});
test("apply → remove round-trips the layout back to classic", () => {
  const applied = applyTenantPreset({ config: { homeLayout: "showcase", name: "X" } }, preset!);
  assert.equal(applied.config.homeLayout, "groupbuy");
  assert.equal(applied.config.name, "X");
  const removed = removeTenantPreset({ config: applied.config, enabledFeatures: preset!.features }, preset!);
  assert.equal(removed.config.homeLayout, "classic");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
