/**
 * Per-round order IDs: the owner types "MNMGB123" when opening a group buy and
 * that round's orders are numbered MNMGB123-0001, MNMGB123-0002…
 *
 *   npm run test:gb-order-prefix
 */
import assert from "node:assert/strict";

import {
  formatGroupBuyOrderNumber,
  normalizeGroupBuyOrderPrefix,
  validateGroupBuyOrderPrefix,
} from "../src/lib/orders/order-number-format";
import { dbGroupBuyToStorefront, groupBuyToDbWrite, normalizeGroupBuy } from "../src/lib/storefront/group-buy";

let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log("Group-buy order IDs");

check("numbers are the order ID, a dash, and a 4-digit counter", () => {
  assert.equal(formatGroupBuyOrderNumber("MNMGB123", 1), "MNMGB123-0001");
  assert.equal(formatGroupBuyOrderNumber("MNMGB123", 42), "MNMGB123-0042");
  assert.equal(formatGroupBuyOrderNumber("MNMGB123", 12345), "MNMGB123-12345");
});

check("what the owner types is cleaned up: case, spaces and dashes", () => {
  assert.equal(normalizeGroupBuyOrderPrefix("mnmgb123"), "MNMGB123");
  assert.equal(normalizeGroupBuyOrderPrefix(" MNMGB 123 "), "MNMGB123");
  assert.equal(normalizeGroupBuyOrderPrefix("MNMGB123 - "), "MNMGB123");
  assert.equal(normalizeGroupBuyOrderPrefix(undefined), "");
  assert.equal(normalizeGroupBuyOrderPrefix(123), "");
});

check("blank is allowed (the round keeps the store's numbers)", () => {
  assert.equal(validateGroupBuyOrderPrefix(""), null);
});

check("bad IDs are refused with a readable message", () => {
  assert.equal(validateGroupBuyOrderPrefix("MNMGB123"), null);
  assert.ok(validateGroupBuyOrderPrefix("M"), "too short");
  assert.ok(validateGroupBuyOrderPrefix("A".repeat(17)), "too long");
  assert.ok(validateGroupBuyOrderPrefix("MNM#1"), "symbol");
});

check("the order ID survives the save → DB → screen round trip", () => {
  const gb = normalizeGroupBuy({ name: "Nov round", orderPrefix: "mnmgb123" });
  assert.equal(gb.orderPrefix, "MNMGB123");
  const write = groupBuyToDbWrite(gb);
  assert.equal(write.orderPrefix, "MNMGB123");
  const now = new Date();
  const back = dbGroupBuyToStorefront({
    id: "gb1",
    name: "Nov round",
    description: "",
    status: "active",
    startsAt: null,
    endsAt: null,
    deliveryEta: "",
    productIds: [],
    orderPrefix: "MNMGB123",
    createdAt: now,
    updatedAt: now,
  });
  assert.equal(back.orderPrefix, "MNMGB123");
});

check("a round without an order ID writes NULL, not an empty string", () => {
  // NULL is what lets many ID-less rounds sit under @@unique([tenantId, orderPrefix]).
  assert.equal(groupBuyToDbWrite(normalizeGroupBuy({ name: "x" })).orderPrefix, null);
});

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exit(1);
