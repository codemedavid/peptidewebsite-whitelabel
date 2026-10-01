/**
 * Pure-core gate for the order-update bot (src/lib/community/order-bot.ts):
 * when the store moves an order or adds a tracking number, the bot DMs the
 * customer in the store chat and pushes their phone.
 *
 *   npm run test:order-bot
 */
import assert from "node:assert";

import {
  ORDER_BOT_AUTHOR,
  orderBotClientId,
  orderIdFromBotClientId,
  orderUpdateReason,
  orderUpdateText,
  orderUpdatePush,
  isOrderBotMessage,
} from "../src/lib/community/order-bot";
import { STORE_KEY } from "../src/lib/community/keys";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

console.log("\nwhen the bot speaks");
test("a real status change notifies", () => {
  assert.equal(orderUpdateReason({ statusChanged: true, status: "shipped", prevTracking: "", tracking: "" }), "status");
});
test("moving back to 'new' is an internal correction, not news for the buyer", () => {
  assert.equal(orderUpdateReason({ statusChanged: true, status: "new", prevTracking: "", tracking: "" }), null);
});
test("a newly added or changed tracking number notifies without a status change", () => {
  assert.equal(orderUpdateReason({ statusChanged: false, status: "shipped", prevTracking: "", tracking: "JT123" }), "tracking");
  assert.equal(orderUpdateReason({ statusChanged: false, status: "shipped", prevTracking: "JT1", tracking: "JT2" }), "tracking");
});
test("an unchanged save (same status, same tracking) stays silent", () => {
  assert.equal(orderUpdateReason({ statusChanged: false, status: "shipped", prevTracking: "JT1", tracking: " JT1 " }), null);
});
test("clearing a tracking number is not news", () => {
  assert.equal(orderUpdateReason({ statusChanged: false, status: "shipped", prevTracking: "JT1", tracking: "" }), null);
});

console.log("\nwhat the bot says");
test("names the order, the shopper-facing status and the tracking details", () => {
  const text = orderUpdateText({ orderNumber: "PW-1042", status: "shipped", courier: "J&T Express", trackingNumber: "JT0099" });
  assert.match(text, /PW-1042/);
  assert.match(text, /Shipped/);
  assert.match(text, /J&T Express/);
  assert.match(text, /JT0099/);
});
test("uses the shopper's words, not the seller's ('processing' → 'Preparing')", () => {
  assert.match(orderUpdateText({ orderNumber: "A1", status: "processing", courier: "", trackingNumber: "" }), /Preparing/);
});
test("leaves out tracking lines when there is no tracking number", () => {
  const text = orderUpdateText({ orderNumber: "A1", status: "confirmed", courier: "LBC", trackingNumber: "" });
  assert.doesNotMatch(text, /Tracking/i);
});
test("a cancelled order invites the buyer to reply", () => {
  assert.match(orderUpdateText({ orderNumber: "A1", status: "cancelled", courier: "", trackingNumber: "" }), /reply/i);
});

console.log("\npush");
test("the lock screen names the order and status, never the tracking number", () => {
  const p = orderUpdatePush({ orderNumber: "PW-7", status: "shipped", reason: "tracking", trackingNumber: "SECRET9" });
  assert.match(p.body, /PW-7/);
  assert.doesNotMatch(p.body, /SECRET9/);
  assert.match(p.body, /tracking/i);
});

console.log("\nidempotency key");
test("one key per order transition — replaying the same update reuses it", () => {
  const a = orderBotClientId("ord_1", 3, "JT1");
  assert.equal(a, orderBotClientId("ord_1", 3, "JT1"));
  assert.notEqual(a, orderBotClientId("ord_1", 4, "JT1"));
  assert.notEqual(a, orderBotClientId("ord_1", 3, "JT2"));
});
test("fits the 64-char clientId rule and round-trips the order id", () => {
  const id = "c".repeat(25);
  const key = orderBotClientId(id, 12, "X".repeat(120));
  assert.ok(key.length <= 64, `length ${key.length}`);
  assert.match(key, /^[A-Za-z0-9_.:-]{1,64}$/);
  assert.equal(orderIdFromBotClientId(key), id);
  assert.equal(orderIdFromBotClientId("hello"), null);
  assert.equal(orderIdFromBotClientId(null), null);
});

console.log("\nwho counts as the bot");
test("only a store message authored by the bot, of kind 'order'", () => {
  const bot = { senderKey: STORE_KEY, authorKey: ORDER_BOT_AUTHOR, kind: "order" };
  assert.equal(isOrderBotMessage(bot), true);
  assert.equal(isOrderBotMessage({ ...bot, senderKey: "c:abc" }), false);
  assert.equal(isOrderBotMessage({ ...bot, authorKey: "owner" }), false);
  assert.equal(isOrderBotMessage({ ...bot, kind: "text" }), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
