/**
 * Self-contained test for orders filed per group buy (src/lib/storefront/
 * order-folders.ts): the folder list a GB store's Orders screen opens on, and
 * what the ChatGPT connector's list_group_buy_orders reads.
 *
 *   npm run test:order-folders
 */

import assert from "node:assert";

import { normalizeGroupBuy, type GroupBuy } from "../src/lib/storefront/group-buy";
import type { LinkableOrder } from "../src/lib/storefront/group-buy-orders";
import { buildOrderFolders, filedOrderIds, findOrderFolder } from "../src/lib/storefront/order-folders";

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

const NOW = new Date("2026-11-10T00:00:00.000Z");

function round(over: Partial<GroupBuy> & { id: string }): GroupBuy {
  return normalizeGroupBuy({
    name: over.id.toUpperCase(),
    status: "closed",
    startsAt: "2026-10-01T00:00:00.000Z",
    endsAt: "2026-10-05T00:00:00.000Z",
    createdAt: "2026-09-30T00:00:00.000Z",
    ...over,
  });
}

let n = 0;
function order(over: Partial<LinkableOrder>): LinkableOrder {
  n++;
  return {
    id: `o${n}`,
    orderNumber: `MNM-${1000 + n}`,
    date: "2026-10-02T08:00:00.000Z",
    status: "new",
    paymentStatus: "pending",
    customer: { name: `Buyer ${n}`, email: `b${n}@x.com` },
    items: [{ name: "TR30", productId: "tr30", qty: 1, price: 2000 }],
    ...over,
  };
}

console.log("\nOrders per group buy (order-folders)\n");

const live = round({ id: "live", status: "active", startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-11-20T00:00:00.000Z" });
const older = round({ id: "older", closedAt: "2026-10-05T00:00:00.000Z" });
const newer = round({
  id: "newer",
  startsAt: "2026-10-10T00:00:00.000Z",
  endsAt: "2026-10-15T00:00:00.000Z",
  closedAt: "2026-10-15T00:00:00.000Z",
  batchNumber: "TR30-B2",
});
const soon = round({ id: "soon", status: "scheduled", startsAt: "2026-12-01T00:00:00.000Z", endsAt: "2026-12-05T00:00:00.000Z" });
const old = round({ id: "old", status: "archived" });

const orders = [
  order({ groupBuyId: "live", date: "2026-11-02T00:00:00.000Z", paymentStatus: "paid", status: "confirmed" }),
  order({ groupBuyId: "live", date: "2026-11-03T00:00:00.000Z" }),
  order({ groupBuyId: "live", date: "2026-11-03T00:00:00.000Z", status: "cancelled" }),
  order({ date: "2026-10-12T00:00:00.000Z" }), // unattributed, inside "newer"'s window
  order({ groupBuyId: "older" }),
  order({ date: "2026-08-01T00:00:00.000Z" }), // in no window — on-hand
];

const folders = buildOrderFolders([older, live, soon, newer, old], orders, { scheduledEnabled: true, now: NOW });

check("the live round is its own bucket, ahead of everything", () => {
  assert.deepStrictEqual(folders.live.map((f) => f.id), ["live"]);
});

check("finished rounds sort most-recently-closed first", () => {
  assert.deepStrictEqual(folders.recent.map((f) => f.id), ["newer", "older"]);
});

check("scheduled rounds are upcoming, archived are kept apart", () => {
  assert.deepStrictEqual(folders.upcoming.map((f) => f.id), ["soon"]);
  assert.deepStrictEqual(folders.archived.map((f) => f.id), ["old"]);
});

check("a folder carries the ids of exactly the orders its round owns", () => {
  assert.deepStrictEqual(folders.live[0].orderIds, ["o1", "o2", "o3"]);
  assert.deepStrictEqual(folders.recent[0].orderIds, ["o4"]); // window fallback, not groupBuyId
});

check("to-do counts: new, unpaid (cancelled excluded), cancelled", () => {
  const f = folders.live[0];
  assert.strictEqual(f.newOrders, 1);
  assert.strictEqual(f.unpaidOrders, 1);
  assert.strictEqual(f.cancelledOrders, 1);
});

check("money matches the round dashboard: cancelled out, paid = collected", () => {
  const f = folders.live[0];
  assert.strictEqual(f.grossIncome, 4000);
  assert.strictEqual(f.collected, 2000);
  assert.strictEqual(f.outstanding, 2000);
});

check("a round past its endsAt files as recent without a write", () => {
  const stale = round({ id: "stale", status: "active", startsAt: "2026-10-20T00:00:00.000Z", endsAt: "2026-10-25T00:00:00.000Z" });
  const f = buildOrderFolders([stale], [], { scheduledEnabled: true, now: NOW });
  assert.strictEqual(f.live.length, 0);
  assert.strictEqual(f.recent[0].status, "closed");
});

check("an order in no round is left OUT of every folder (the 'outside' folder)", () => {
  const filed = filedOrderIds(folders);
  assert.ok(!filed.has("o6"));
  assert.strictEqual(filed.size, 5);
});

check("find by batch label, by name; blank finds nothing; ambiguous returns all", () => {
  assert.deepStrictEqual(findOrderFolder(folders, "tr30-b2").map((f) => f.id), ["newer"]);
  assert.deepStrictEqual(findOrderFolder(folders, "LIVE").map((f) => f.id), ["live"]);
  assert.strictEqual(findOrderFolder(folders, "  ").length, 0);
  assert.ok(findOrderFolder(folders, "o").length > 1);
});

check("inputs are not mutated", () => {
  const before = JSON.stringify(orders);
  buildOrderFolders([live], orders, { scheduledEnabled: true, now: NOW });
  assert.strictEqual(JSON.stringify(orders), before);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
