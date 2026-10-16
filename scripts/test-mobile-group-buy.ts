/**
 * Group buy in the Expo app — the pure helpers behind the shop banner, the
 * group-buy screen and the chat card (mobile/src/features/.../group-buy.ts):
 *
 *   - slotMeter:      "12 of 30 slots" progress, goal reached, no goal
 *   - roundUrgency:   the countdown's tone + words
 *   - roundProducts:  the round's products, in the round's order
 *   - liveStrip:      whether the pinned LIVE strip shows, and what it says
 *   - shareTargets:   the chats a member can drop the card into
 *   - pushTarget / attachmentLabel / makeOptimistic: the chat plumbing
 *
 *   npm run test:mobile-group-buy
 */
import assert from "node:assert";

import type { CommunityChannel, CommunityConversation, GroupBuyCard, InboxResponse, Participant } from "../src/lib/mobile/contract";
import type { ShopCatalog, ShopProduct } from "../src/lib/mobile/shop-contract";
import { liveStrip, roundProducts, roundUrgency, slotMeter } from "../mobile/src/features/shop/lib/group-buy";
import { shareTargets } from "../mobile/src/features/community/lib/group-buy";
import { pushTarget } from "../mobile/src/features/community/lib/pushTarget";
import { attachmentLabel } from "../mobile/src/features/community/lib/attachments";
import { makeOptimistic } from "../mobile/src/features/community/lib/messages";

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

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
const at = (ms: number) => new Date(NOW + ms).toISOString();

console.log("\nslotMeter");
test("no goal → no bar", () => {
  const m = slotMeter(0, 7);
  assert.equal(m.enabled, false);
  assert.equal(m.label, "7 joined");
});
test("part-filled → pct, slots left, and words", () => {
  const m = slotMeter(30, 12);
  assert.equal(m.enabled, true);
  assert.equal(m.pct, 40);
  assert.equal(m.left, 18);
  assert.equal(m.label, "12 of 30 slots filled");
  assert.equal(m.hint, "18 slots left");
  assert.equal(m.reached, false);
});
test("one slot left reads singular", () => {
  assert.equal(slotMeter(10, 9).hint, "1 slot left");
});
test("goal reached caps at 100% and says so", () => {
  const m = slotMeter(10, 14);
  assert.equal(m.pct, 100);
  assert.equal(m.left, 0);
  assert.equal(m.reached, true);
  assert.equal(m.hint, "Goal reached — still open");
});
test("junk input never yields NaN", () => {
  const m = slotMeter(Number.NaN, -3);
  assert.equal(m.enabled, false);
  assert.equal(m.filled, 0);
});

console.log("\nroundUrgency");
test("open-ended round", () => {
  assert.deepEqual(roundUrgency(null, NOW), { tone: "calm", label: "Open now", ended: false });
});
test("more than three days → calm, in days", () => {
  assert.deepEqual(roundUrgency(at(5 * 24 * HOUR + HOUR), NOW), { tone: "calm", label: "Closes in 6 days", ended: false });
});
test("within three days → soon", () => {
  assert.equal(roundUrgency(at(30 * HOUR), NOW).tone, "soon");
  assert.equal(roundUrgency(at(30 * HOUR), NOW).label, "Closes in 2 days");
});
test("final day → last, in hours", () => {
  assert.deepEqual(roundUrgency(at(5 * HOUR + 12 * 60_000), NOW), { tone: "last", label: "Last day · 5h 12m left", ended: false });
});
test("past the deadline → ended", () => {
  assert.deepEqual(roundUrgency(at(-1), NOW), { tone: "ended", label: "Closed", ended: true });
});
test("an unparseable date reads as open-ended", () => {
  assert.equal(roundUrgency("not-a-date", NOW).label, "Open now");
});

console.log("\nliveStrip");
{
  const NOW = Date.parse("2026-10-08T00:00:00.000Z");
  const text = { headline: "GB #5 is live", message: "October round", ctaLabel: "Join now" };
  const round = (over: Record<string, unknown> = {}) =>
    ({ id: "gb1", name: "GB #5", ordering: "open", endsAt: "2026-10-20T00:00:00.000Z", liveBanner: text, ...over }) as unknown as ShopCatalog["groupBuy"];
  test("an open round with the strip on → its text and countdown", () => {
    const s = liveStrip(round(), NOW);
    assert.ok(s);
    assert.equal(s.headline, "GB #5 is live");
    assert.equal(s.message, "October round");
    assert.equal(s.ctaLabel, "Join now");
    assert.equal(s.urgency.label, "Closes in 12 days");
    assert.ok(s.a11y.includes("GB #5 is live") && s.a11y.includes("Closes in 12 days"));
  });
  test("no round → nothing", () => {
    assert.equal(liveStrip(null, NOW), null);
    assert.equal(liveStrip(undefined, NOW), null);
  });
  test("owner switched the strip off → nothing", () => {
    assert.equal(liveStrip(round({ liveBanner: null }), NOW), null);
  });
  test("a server that predates the strip (no field) → nothing", () => {
    assert.equal(liveStrip(round({ liveBanner: undefined }), NOW), null);
  });
  test("ordering paused → not LIVE, nothing", () => {
    assert.equal(liveStrip(round({ ordering: "closed" }), NOW), null);
  });
  test("past the close while the app sat open → nothing", () => {
    assert.equal(liveStrip(round({ endsAt: "2026-10-07T00:00:00.000Z" }), NOW), null);
  });
  test("open-ended round still shows", () => {
    assert.equal(liveStrip(round({ endsAt: null }), NOW)?.urgency.label, "Open now");
  });
}

console.log("\nroundProducts");
const product = (id: string): ShopProduct => ({
  id, name: id, category: "", description: "", image: null, extraImages: [], price: 1, compareAtPrice: null,
  stock: null, purchasable: true, isGroupBuy: true, baseSelectable: true, variations: [],
});
test("the round's products in the round's order; unknown ids skipped", () => {
  const catalog = {
    products: [product("a"), product("b"), product("c")],
    groupBuy: { productIds: ["c", "zz", "a"] },
  } as unknown as ShopCatalog;
  assert.deepEqual(roundProducts(catalog).map((p) => p.id), ["c", "a"]);
});
test("no round → empty", () => {
  assert.deepEqual(roundProducts({ products: [product("a")], groupBuy: null } as unknown as ShopCatalog), []);
  assert.deepEqual(roundProducts(undefined), []);
});

console.log("\nshareTargets");
const peer: Participant = { key: "c:1", name: "Ana Cruz", avatarHue: 10, imageUrl: null, isTeam: false };
const channel = (id: string, canPost: boolean, last: string | null): CommunityChannel => ({
  id, name: `#${id}`, description: null, emoji: "💬", imageUrl: null, postRole: "everyone", sortOrder: 0, topicCount: 1,
  generalTopicId: `g-${id}`, lastMessageAt: last, preview: null, previewTopic: null, unread: 0, canPost, canManage: false,
});
const dm = (id: string, last: string | null): CommunityConversation => ({ id, peer, lastMessageAt: last, messageCount: 1, preview: null, unread: 0 });
test("channels you can post in + your DMs, most recent first; blocked peers dropped", () => {
  const inbox = {
    channels: [channel("news", false, at(-1)), channel("chat", true, at(-5 * HOUR))],
    conversations: [dm("d1", at(-HOUR)), { ...dm("d2", at(-2 * HOUR)), peer: { ...peer, key: "c:blocked" } }],
    drops: [],
    unreadChats: 0,
  } as InboxResponse;
  const targets = shareTargets(inbox, new Set(["c:blocked"]));
  assert.deepEqual(
    targets.map((t) => [t.type, t.id, t.title]),
    [
      ["dm", "d1", "Ana Cruz"],
      ["topic", "g-chat", "#chat"],
    ],
  );
});
test("no inbox → nothing to share to", () => {
  assert.deepEqual(shareTargets(undefined, new Set()), []);
});

console.log("\nchat plumbing");
test("a group-buy push opens the channel it landed in", () => {
  assert.deepEqual(pushTarget({ type: "group_buy", threadId: "t9" }), { screen: "topic", id: "t9" });
  assert.equal(pushTarget({ type: "group_buy", threadId: "../x" }), null);
});
test("replies and menus name it", () => {
  assert.equal(attachmentLabel("groupbuy"), "👥 Group buy");
});
test("the optimistic bubble is a group-buy card", () => {
  const card: GroupBuyCard = {
    id: "gb1", name: "GB #5", description: "", deliveryEta: "", endsAt: null, status: "open", slotGoal: 0, filled: 0,
    productCount: 3, fromPriceLabel: "₱900", images: [], terms: "",
  };
  const m = makeOptimistic({
    clientId: "c1", threadType: "topic", threadId: "t1", sender: peer, body: null, now: at(0), replyTo: null, groupBuy: card,
  });
  assert.equal(m.kind, "groupbuy");
  assert.equal(m.groupBuy?.id, "gb1");
  assert.equal(m.pending, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
