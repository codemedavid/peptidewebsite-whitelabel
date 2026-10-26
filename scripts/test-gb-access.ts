/**
 * Pure gate for group-buy access — WHO may see a gated round and WHAT a
 * locked viewer's catalog looks like (src/lib/storefront/gb-access.ts). No DB,
 * no Next runtime; the wiring is proven by test:gb-access-flow.
 *
 *   npm run test:gb-access
 *
 * Covers: which round governs the storefront (live → upcoming → last closed);
 * the lock decision applied to Paid Access's answer (gated?, admin, canAccess); the
 * locked catalog (round products and gb listings removed, gbPrice stripped
 * from everything left, inputs untouched); and the teaser, which carries no
 * product or price — and no description unless visibility is "summary".
 */
import assert from "node:assert";

import {
  governingGroupBuy,
  isGroupBuyLocked,
  lockGroupBuyCatalog,
  buildGroupBuyTeaser,
  type GroupBuyViewer,
} from "../src/lib/storefront/gb-access";
import { GROUP_BUY_CAPS_OFF, normalizeGroupBuy, type GroupBuy, type GroupBuyCapabilities } from "../src/lib/storefront/group-buy";
import type { Product } from "../src/storefront/types";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

const NOW = new Date("2026-10-25T12:00:00Z");
const day = 86_400_000;
const iso = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * day).toISOString();

const CAPS: GroupBuyCapabilities = { ...GROUP_BUY_CAPS_OFF, enabled: true, scheduled: true, productAssignment: true, paidAccess: true };

const round = (over: Partial<GroupBuy> & { id: string }): GroupBuy =>
  normalizeGroupBuy({ name: over.id, status: "active", createdAt: iso(-10), ...over });

const paidLive = round({ id: "gb_live", productIds: ["p_round"], endsAt: iso(3), description: "Secret supplier batch" });

const product = (id: string, over: Partial<Product> = {}): Product =>
  ({ id, name: id, price: 1000, category: "c", available: true, ...over }) as Product;

const catalog: Product[] = [
  product("p_round", { productType: "gb", gbPrice: 690 }),
  product("p_tagged", { productType: "gb", gbPrice: 590 }),
  product("p_onhand", { gbPrice: 800, variations: [{ name: "5mg", price: 1000, gbPrice: 700 }, { name: "10mg", price: 1800 }] } as Partial<Product>),
  product("p_plain"),
];

const anon: GroupBuyViewer = { kind: "anonymous" };
const ana: GroupBuyViewer = { kind: "customer", customerId: "c_ana" };
const admin: GroupBuyViewer = { kind: "admin" };

console.log("governing round");

test("the live round governs", () => {
  const upcoming = round({ id: "gb_next", status: "scheduled", startsAt: iso(5) });
  assert.strictEqual(governingGroupBuy([upcoming, paidLive], CAPS, NOW)?.id, "gb_live");
});

test("no live round → the soonest upcoming one", () => {
  const later = round({ id: "gb_later", status: "scheduled", startsAt: iso(9) });
  const sooner = round({ id: "gb_sooner", status: "scheduled", startsAt: iso(2) });
  assert.strictEqual(governingGroupBuy([later, sooner], CAPS, NOW)?.id, "gb_sooner");
});

test("nothing live or upcoming → the most recently closed (its view-only page still shows prices)", () => {
  const old = round({ id: "gb_old", status: "closed", closedAt: iso(-20) });
  const recent = round({ id: "gb_recent", status: "closed", closedAt: iso(-2) });
  const lapsed = round({ id: "gb_lapsed", status: "active", endsAt: iso(-5) }); // closes on read
  assert.strictEqual(governingGroupBuy([old, recent, lapsed], CAPS, NOW)?.id, "gb_recent");
});

test("drafts, cancelled and archived rounds never govern", () => {
  const list = [round({ id: "d", status: "draft" }), round({ id: "x", status: "cancelled" }), round({ id: "a", status: "archived" })];
  assert.strictEqual(governingGroupBuy(list, CAPS, NOW), null);
  assert.strictEqual(governingGroupBuy([], CAPS, NOW), null);
});

console.log("lock decision");

test("an Open (ungated) round is never locked, for anyone", () => {
  for (const viewer of [anon, ana, admin]) assert.ok(!isGroupBuyLocked({ gated: false, viewer, canAccess: false }));
});

test("a gated round is locked for anonymous visitors and customers who aren't in", () => {
  assert.ok(isGroupBuyLocked({ gated: true, viewer: anon, canAccess: false }));
  assert.ok(isGroupBuyLocked({ gated: true, viewer: ana, canAccess: false }));
});

test("Paid Access's canAccess is what opens it for a customer", () => {
  assert.ok(!isGroupBuyLocked({ gated: true, viewer: ana, canAccess: true }));
});

test("store admins always see the round (they edit its prices)", () => {
  assert.ok(!isGroupBuyLocked({ gated: true, viewer: admin, canAccess: false }));
});

console.log("locked catalog");

test("removes the round's products and every gb listing; keeps on-hand items", () => {
  const out = lockGroupBuyCatalog(catalog, paidLive, CAPS, NOW);
  assert.deepStrictEqual(out.map((p) => p.id), ["p_onhand", "p_plain"]);
});

test("strips gbPrice from what's left, including per-variation gbPrice", () => {
  const out = lockGroupBuyCatalog(catalog, paidLive, CAPS, NOW);
  const onhand = out.find((p) => p.id === "p_onhand")!;
  assert.ok(!("gbPrice" in onhand));
  assert.ok(onhand.variations!.every((v) => !("gbPrice" in v)));
  assert.strictEqual(onhand.variations![0].price, 1000, "regular prices untouched");
  assert.ok(!JSON.stringify(out).includes("gbPrice"));
});

test("a round with no assignment covers the whole catalog → nothing is left", () => {
  assert.deepStrictEqual(lockGroupBuyCatalog(catalog, { ...paidLive, productIds: [] }, CAPS, NOW), []);
  assert.deepStrictEqual(lockGroupBuyCatalog(catalog, paidLive, { ...CAPS, productAssignment: false }, NOW), []);
});

test("once the round is over, only gb listings + prices stay hidden — normal shopping resumes", () => {
  const closedAll = round({ id: "gb_done", status: "closed", productIds: [] });
  const out = lockGroupBuyCatalog(catalog, closedAll, CAPS, NOW);
  assert.deepStrictEqual(out.map((p) => p.id), ["p_onhand", "p_plain"]);
  assert.ok(!JSON.stringify(out).includes("gbPrice"));
  const upcoming = round({ id: "gb_soon", status: "scheduled", startsAt: iso(2), productIds: ["p_plain"] });
  assert.deepStrictEqual(lockGroupBuyCatalog(catalog, upcoming, CAPS, NOW).map((p) => p.id), ["p_onhand", "p_plain"], "not started → its products still sell as regular stock");
});

test("never mutates its input", () => {
  const before = JSON.stringify(catalog);
  lockGroupBuyCatalog(catalog, paidLive, CAPS, NOW);
  assert.strictEqual(JSON.stringify(catalog), before);
});

console.log("teaser");

const TEASER = {
  visibility: "nothing" as const,
  steps: ["Pay ₱500", "Admin approval", "Access"],
  joinFeeCents: 50000,
  amountLabel: "₱500",
  productCount: 1,
  maxSlots: 30,
  slotsTaken: 12,
  membership: null,
};

test("'nothing' visibility: name, dates, the way in — no description, products or prices", () => {
  const t = buildGroupBuyTeaser(paidLive, CAPS, TEASER, NOW);
  assert.deepStrictEqual(t, {
    id: "gb_live",
    name: "gb_live",
    startsAt: null,
    endsAt: paidLive.endsAt,
    state: "live",
    visibility: "nothing",
    summary: null,
    steps: ["Pay ₱500", "Admin approval", "Access"],
    joinFeeCents: 50000,
    amountLabel: "₱500",
    membership: null,
  });
  const s = JSON.stringify(t);
  assert.ok(!s.includes("Secret supplier batch") && !s.includes("p_round"), "no description, no product ids");
});

test("'summary' visibility adds description, ETA, product count and slots — still no products or prices", () => {
  const t = buildGroupBuyTeaser(paidLive, CAPS, { ...TEASER, visibility: "summary" }, NOW);
  assert.deepStrictEqual(t.summary, { description: "Secret supplier batch", deliveryEta: "", productCount: 1, maxSlots: 30, slotsTaken: 12 });
  assert.ok(!JSON.stringify(t).includes("p_round"));
});

test("upcoming and closed rounds say so", () => {
  assert.strictEqual(buildGroupBuyTeaser(round({ id: "u", status: "scheduled", startsAt: iso(2) }), CAPS, TEASER, NOW).state, "upcoming");
  assert.strictEqual(buildGroupBuyTeaser(round({ id: "c", status: "closed" }), CAPS, TEASER, NOW).state, "closed");
});

test("the viewer's own membership rides along (with their reason and headline)", () => {
  const membership = { status: "rejected", reviewReason: "Wrong amount", headline: "Not approved: Wrong amount" };
  assert.deepStrictEqual(buildGroupBuyTeaser(paidLive, CAPS, { ...TEASER, membership }, NOW).membership, membership);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
