/**
 * Self-contained test for the pure order-status transition core behind BOTH the
 * single-order update and the new BULK "change status" action in the store admin
 * (src/storefront/admin/AdminOrders.tsx → src/actions/orders.ts). The decision of
 * "what changes when this order moves to status X" is extracted so the same rules
 * apply whether one order or fifty are updated at once:
 *
 *   src/lib/storefront/order-status.ts
 *     ORDER_STATUSES            — the six statuses, in fulfillment order.
 *     isOrderStatus(v)          — narrow untrusted input to a valid status.
 *     cleanIdList(ids, cap)     — coerce an untrusted id array (dedupe + cap).
 *     stockCurrentlyDeducted(h) — replay a journey → are the items deducted now?
 *     inventoryMove(cur,h,next) — which stock movement (deduct/restock/none).
 *     planStatusChange(o,s,now) — the whole per-order decision: changed / status /
 *                                 statusHistory (append only on real change) / move.
 *
 *   npm run test:bulk-order-status
 */

import assert from "node:assert";

import type { Order, OrderStatus, OrderStatusEvent } from "../src/storefront/types";
import {
  ORDER_STATUSES,
  isOrderStatus,
  cleanIdList,
  stockCurrentlyDeducted,
  inventoryMove,
  planStatusChange,
} from "../src/lib/storefront/order-status";

// ──────────────────────────── tiny assertion harness ────────────────────────
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

const NOW = "2026-07-06T00:00:00.000Z";
const ev = (status: OrderStatus): OrderStatusEvent => ({ status, at: NOW });

console.log("\nOrder-status transition core — pure\n");

// ── ORDER_STATUSES ────────────────────────────────────────────────────────────
console.log("ORDER_STATUSES");
check("lists the six statuses in fulfillment order", () => {
  assert.deepEqual(
    [...ORDER_STATUSES],
    ["new", "confirmed", "processing", "shipped", "delivered", "cancelled"],
  );
});

// ── isOrderStatus ─────────────────────────────────────────────────────────────
console.log("\nisOrderStatus (server-action guard input)");
check("accepts every canonical status", () => {
  for (const s of ORDER_STATUSES) assert.equal(isOrderStatus(s), true, s);
});
check("rejects unknown / empty / wrong-case / non-string", () => {
  for (const v of ["", "shipped ", "NEW", "done", null, undefined, 3, {}]) {
    assert.equal(isOrderStatus(v), false, String(v));
  }
});

// ── cleanIdList ───────────────────────────────────────────────────────────────
console.log("\ncleanIdList (bulk selection hardening)");
check("keeps non-empty strings, drops blanks and non-strings", () => {
  assert.deepEqual(cleanIdList(["a", "", "b", null, 5, "c"]), ["a", "b", "c"]);
});
check("de-duplicates repeated ids (never process one order twice)", () => {
  assert.deepEqual(cleanIdList(["a", "a", "b", "a"]), ["a", "b"]);
});
check("caps the list length", () => {
  const many = Array.from({ length: 50 }, (_, i) => `id-${i}`);
  assert.equal(cleanIdList(many, 10).length, 10);
});
check("non-array input collapses to an empty list", () => {
  assert.deepEqual(cleanIdList(null), []);
  assert.deepEqual(cleanIdList("a"), []);
  assert.deepEqual(cleanIdList(undefined), []);
});

// ── stockCurrentlyDeducted (journey replay) ──────────────────────────────────
console.log("\nstockCurrentlyDeducted (replay the journey)");
check("empty / legacy journey → not deducted", () => {
  assert.equal(stockCurrentlyDeducted([]), false);
});
check("confirmed → deducted", () => {
  assert.equal(stockCurrentlyDeducted([ev("new"), ev("confirmed")]), true);
});
check("confirmed then cancelled → not deducted", () => {
  assert.equal(stockCurrentlyDeducted([ev("confirmed"), ev("cancelled")]), false);
});
check("confirmed → cancelled → confirmed bounce → deducted again", () => {
  assert.equal(
    stockCurrentlyDeducted([ev("confirmed"), ev("cancelled"), ev("confirmed")]),
    true,
  );
});

// ── inventoryMove ─────────────────────────────────────────────────────────────
console.log("\ninventoryMove (deduct / restock / none)");
check("new → confirmed (never deducted) → deduct", () => {
  assert.equal(inventoryMove("new", [ev("new")], "confirmed"), "deduct");
});
check("confirmed → cancelled (currently deducted) → restock", () => {
  assert.equal(inventoryMove("confirmed", [ev("new"), ev("confirmed")], "cancelled"), "restock");
});
check("no-op when the status does not change", () => {
  assert.equal(inventoryMove("confirmed", [ev("confirmed")], "confirmed"), null);
});
check("non-inventory transitions move nothing (confirmed → shipped)", () => {
  assert.equal(inventoryMove("confirmed", [ev("confirmed")], "shipped"), null);
});
check("cancelling a never-confirmed order invents no stock", () => {
  assert.equal(inventoryMove("new", [ev("new")], "cancelled"), null);
});
check("re-confirming an already-deducted order does not deduct twice", () => {
  // Journey shows a live deduction; confirming again is a no-op move.
  assert.equal(inventoryMove("confirmed", [ev("confirmed")], "confirmed"), null);
});

// ── planStatusChange (the whole per-order decision) ──────────────────────────
console.log("\nplanStatusChange (per-order decision, reused by single + bulk)");

const makeOrder = (over: Partial<Order> = {}): Order =>
  ({
    id: "ord_1",
    orderNumber: "PEP-1001",
    status: "new",
    paymentStatus: "pending",
    paymentMethod: "bank",
    date: NOW,
    customer: { name: "A", email: "a@x.io", phone: "", contactMethod: "" },
    shipping: { address: "", barangay: "", city: "", province: "", postal: "", country: "", region: "", fee: 0 },
    courier: "",
    trackingNumber: "",
    shippingNote: "",
    items: [{ name: "Peptide", qty: 2, price: 100 }],
    statusHistory: [ev("new")],
    paymentProof: null,
    ...over,
  }) as Order;

check("same status → not changed, history untouched, no move", () => {
  const o = makeOrder({ status: "confirmed", statusHistory: [ev("confirmed")] });
  const plan = planStatusChange(o, "confirmed", NOW);
  assert.equal(plan.changed, false);
  assert.equal(plan.status, "confirmed");
  assert.deepEqual(plan.statusHistory, [ev("confirmed")]); // no new event appended
  assert.equal(plan.move, null);
});

check("new → confirmed → changed, appends one event, deducts stock", () => {
  const o = makeOrder({ status: "new", statusHistory: [ev("new")] });
  const plan = planStatusChange(o, "confirmed", NOW);
  assert.equal(plan.changed, true);
  assert.equal(plan.status, "confirmed");
  assert.equal(plan.statusHistory.length, 2);
  assert.deepEqual(plan.statusHistory.at(-1), ev("confirmed"));
  assert.equal(plan.move, "deduct");
});

check("confirmed → shipped → changed + appended, but no inventory move", () => {
  const o = makeOrder({ status: "confirmed", statusHistory: [ev("new"), ev("confirmed")] });
  const plan = planStatusChange(o, "shipped", NOW);
  assert.equal(plan.changed, true);
  assert.equal(plan.move, null);
  assert.equal(plan.statusHistory.length, 3);
});

check("confirmed → cancelled → restocks", () => {
  const o = makeOrder({ status: "confirmed", statusHistory: [ev("new"), ev("confirmed")] });
  const plan = planStatusChange(o, "cancelled", NOW);
  assert.equal(plan.move, "restock");
});

check("tolerates a missing statusHistory (legacy order)", () => {
  const o = makeOrder({ status: "new", statusHistory: undefined });
  const plan = planStatusChange(o, "confirmed", NOW);
  assert.equal(plan.changed, true);
  assert.deepEqual(plan.statusHistory, [ev("confirmed")]);
  assert.equal(plan.move, "deduct");
});

check("BULK: applying one target status across a mixed set only changes the ones that differ", () => {
  const orders = [
    makeOrder({ id: "a", status: "new", statusHistory: [ev("new")] }),
    makeOrder({ id: "b", status: "confirmed", statusHistory: [ev("new"), ev("confirmed")] }),
    makeOrder({ id: "c", status: "new", statusHistory: [ev("new")] }),
  ];
  const plans = orders.map((o) => planStatusChange(o, "confirmed", NOW));
  const changed = plans.filter((p) => p.changed);
  assert.equal(changed.length, 2, "only a and c change; b was already confirmed");
  // Both newly-confirmed orders deduct; the already-confirmed one moves nothing.
  assert.deepEqual(plans.map((p) => p.move), ["deduct", null, "deduct"]);
});

// ──────────────────────────── summary ───────────────────────────────────────
console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed.\n`);
process.exit(failed === 0 ? 0 : 1);
