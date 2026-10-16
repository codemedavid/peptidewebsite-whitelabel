/**
 * Group buy in the Pepweb app — the pure core (no DB):
 *
 *   - buildShopGroupBuy:      the live round as the shop catalog sends it (+ the live strip)
 *   - groupBuyCardFrom:       the round as a chat card (live / view-only / ended)
 *   - parseGroupBuyBroadcast: the moderator's "send to everyone" input
 *
 *   npm run test:group-buy-share
 */
import assert from "node:assert";

import { buildShopGroupBuy, endedGroupBuyCard, groupBuyCardFrom } from "../src/lib/mobile/group-buy-share";
import { parseGroupBuyBroadcast } from "../src/lib/community/validate";
import type { GroupBuyBanner } from "../src/lib/storefront/group-buy-banner";
import type { ShopProduct } from "../src/lib/mobile/shop-contract";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

const banner = (over: Partial<GroupBuyBanner> = {}): GroupBuyBanner => ({
  id: "gb1",
  name: "GB #5",
  description: "October round",
  deliveryEta: "3–4 weeks after close",
  productIds: [],
  coversAll: true,
  slotGoal: 30,
  endsAt: "2026-10-10T00:00:00.000Z",
  filled: 12,
  ...over,
});

const product = (id: string, over: Partial<ShopProduct> = {}): ShopProduct => ({
  id,
  name: id.toUpperCase(),
  category: "",
  description: "",
  image: `https://img/${id}.jpg`,
  extraImages: [],
  price: 1000,
  compareAtPrice: null,
  stock: null,
  purchasable: true,
  isGroupBuy: true,
  baseSelectable: true,
  variations: [],
  ...over,
});

const content = { howTitle: "How it works", steps: ["Pay to lock a slot.", "Ships {eta}."], terms: "Ships {eta}." };
const OPEN = { onHand: "open", groupBuy: "open" } as const;

console.log("\nbuildShopGroupBuy");
test("no live round → null", () => {
  assert.equal(buildShopGroupBuy({ banner: null, content, ways: OPEN, products: [product("a")] }), null);
});
test("a hidden group-buy way → null (the shop never mentions it)", () => {
  const ways = { onHand: "open", groupBuy: "hidden" } as const;
  assert.equal(buildShopGroupBuy({ banner: banner(), content, ways, products: [product("a")] }), null);
});
test("a round with no listed group-buy products → null (nothing to join)", () => {
  assert.equal(buildShopGroupBuy({ banner: banner(), content, ways: OPEN, products: [product("a", { isGroupBuy: false })] }), null);
});
test("carries the round, its products, the lowest price and the copy with {eta} filled in", () => {
  const gb = buildShopGroupBuy({
    banner: banner(),
    content,
    ways: OPEN,
    products: [
      product("a", { price: 900 }),
      product("b", { isGroupBuy: false, price: 10 }),
      product("c", { price: 1200, variations: [{ name: "10mg", price: 700, compareAtPrice: null, stock: null, image: null }] }),
    ],
  });
  assert.ok(gb);
  assert.equal(gb.id, "gb1");
  assert.equal(gb.name, "GB #5");
  assert.equal(gb.ordering, "open");
  assert.deepEqual(gb.productIds, ["a", "c"]);
  assert.equal(gb.fromPrice, 700);
  assert.deepEqual(gb.images, ["https://img/a.jpg", "https://img/c.jpg"]);
  assert.equal(gb.slotGoal, 30);
  assert.equal(gb.filled, 12);
  assert.deepEqual(gb.steps, ["Pay to lock a slot.", "Ships 3–4 weeks after close."]);
  assert.equal(gb.terms, "Ships 3–4 weeks after close.");
  assert.equal(gb.howTitle, "How it works");
});
test("an owner who closed ordering → view-only round", () => {
  const ways = { onHand: "open", groupBuy: "closed" } as const;
  const gb = buildShopGroupBuy({ banner: banner(), content, ways, products: [product("a")] });
  assert.equal(gb?.ordering, "closed");
});
test("missing copy falls back to the built-in default, never blank", () => {
  const gb = buildShopGroupBuy({ banner: banner({ deliveryEta: "" }), content: undefined, ways: undefined, products: [product("a")] });
  assert.ok(gb);
  assert.ok(gb.steps.length > 0);
  assert.ok(gb.terms.includes("after the round closes"));
});
test("images skip products without one and stop at four", () => {
  const list = ["a", "b", "c", "d", "e", "f"].map((id) => product(id, id === "b" ? { image: null } : {}));
  const gb = buildShopGroupBuy({ banner: banner(), content, ways: OPEN, products: list });
  assert.deepEqual(gb?.images, ["https://img/a.jpg", "https://img/c.jpg", "https://img/d.jpg", "https://img/e.jpg"]);
});
test("carries the live strip with automatic text when the owner left it blank", () => {
  const gb = buildShopGroupBuy({ banner: banner(), content, ways: OPEN, products: [product("a")] });
  assert.deepEqual(gb?.liveBanner, { headline: "GB #5 is live", message: "October round", ctaLabel: "Join now" });
});
test("the owner's strip text, placeholders filled", () => {
  const liveBanner = { enabled: true, headline: "{name} is OPEN", message: "Ships {eta}", ctaLabel: "Grab a slot" };
  const gb = buildShopGroupBuy({ banner: banner(), content, liveBanner, ways: OPEN, products: [product("a")] });
  assert.deepEqual(gb?.liveBanner, { headline: "GB #5 is OPEN", message: "Ships 3–4 weeks after close", ctaLabel: "Grab a slot" });
});
test("strip switched off → liveBanner null, the round itself still shows", () => {
  const gb = buildShopGroupBuy({ banner: banner(), content, liveBanner: { enabled: false }, ways: OPEN, products: [product("a")] });
  assert.ok(gb);
  assert.strictEqual(gb.liveBanner, null);
});
test("never mutates its input", () => {
  const list = Object.freeze([Object.freeze(product("a"))]) as unknown as ShopProduct[];
  const b = Object.freeze(banner());
  assert.doesNotThrow(() => buildShopGroupBuy({ banner: b, content, ways: OPEN, products: list }));
});

console.log("\ngroupBuyCardFrom");
const live = buildShopGroupBuy({ banner: banner(), content, ways: OPEN, products: [product("a", { price: 1500 })] })!;
test("a live round → an open card with the price label in the store's currency", () => {
  const card = groupBuyCardFrom(live, "₱");
  assert.equal(card.status, "open");
  assert.equal(card.productCount, 1);
  assert.equal(card.fromPriceLabel, "₱1,500");
  assert.equal(card.filled, 12);
  assert.equal(card.endsAt, "2026-10-10T00:00:00.000Z");
});
test("a view-only round → a closed card", () => {
  assert.equal(groupBuyCardFrom({ ...live, ordering: "closed" }, "₱").status, "closed");
});
test("an ended round keeps its name and drops everything live", () => {
  const card = endedGroupBuyCard({ id: "old", name: "GB #4" });
  assert.equal(card.status, "ended");
  assert.equal(card.name, "GB #4");
  assert.equal(card.endsAt, null);
  assert.equal(card.fromPriceLabel, null);
  assert.deepEqual(card.images, []);
});

console.log("\nparseGroupBuyBroadcast");
test("needs at least one channel", () => {
  assert.equal(parseGroupBuyBroadcast({ clientId: "c1", channelIds: [] }).ok, false);
  assert.equal(parseGroupBuyBroadcast({ clientId: "c1" }).ok, false);
  assert.equal(parseGroupBuyBroadcast(null).ok, false);
});
test("dedupes channels and trims the note", () => {
  const r = parseGroupBuyBroadcast({ clientId: "c1", channelIds: ["a", "a", "b"], note: "  last call  " });
  assert.ok(r.ok);
  assert.deepEqual(r.value, { clientId: "c1", channelIds: ["a", "b"], note: "last call" });
});
test("an empty note is null", () => {
  const r = parseGroupBuyBroadcast({ clientId: "c1", channelIds: ["a"], note: "   " });
  assert.ok(r.ok && r.value.note === null);
});
test("refuses a missing or malformed clientId (retries must not post twice)", () => {
  assert.equal(parseGroupBuyBroadcast({ channelIds: ["a"] }).ok, false);
  assert.equal(parseGroupBuyBroadcast({ clientId: "bad id!", channelIds: ["a"] }).ok, false);
});
test("caps channels and the note", () => {
  const many = Array.from({ length: 21 }, (_, i) => `ch${i}`);
  assert.equal(parseGroupBuyBroadcast({ clientId: "c1", channelIds: many }).ok, false);
  assert.equal(parseGroupBuyBroadcast({ clientId: "c1", channelIds: ["a"], note: "x".repeat(501) }).ok, false);
});
test("refuses non-string channel ids", () => {
  assert.equal(parseGroupBuyBroadcast({ clientId: "c1", channelIds: [42] }).ok, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
