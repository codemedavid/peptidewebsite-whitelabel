/**
 * Tests for the supplier report prep — buildSupplierReport in
 * src/lib/storefront/group-buy.ts. Pure, no I/O.
 *
 * The rule that is easy to get wrong (ported spec §6):
 *   DEMAND    = every order EXCEPT cancelled / canceled / refunded — paid or not.
 *               This is what the supplier order is sized against.
 *   COMMITTED = the subset that is paymentStatus 'paid' OR order status in
 *               confirmed|processing|shipped|delivered|completed.
 *   Headline numbers are DEMAND; committed is reported ALONGSIDE, never instead.
 *
 *   npm run test:gb-report
 */

import assert from "node:assert";

import { buildSupplierReport } from "../src/lib/storefront/group-buy";

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

type O = {
  status: string;
  paymentStatus?: string;
  items: Array<{ name: string; qty: number; price: number; productId?: string }>;
};
const line = (name: string, qty: number, price: number, productId?: string) => ({ name, qty, price, productId });

console.log("\nSupplier report — demand vs committed\n");

check("DEMAND includes an unpaid, brand-new order", () => {
  const orders: O[] = [{ status: "pending", paymentStatus: "unpaid", items: [line("BPC-157", 2, 100, "p1")] }];
  const r = buildSupplierReport("gb1", orders);
  assert.equal(r.totalQty, 2, "unpaid order must still be counted in demand");
  assert.equal(r.orderCount, 1);
});

check("DEMAND excludes cancelled, canceled AND refunded (all spellings)", () => {
  const orders: O[] = [
    { status: "cancelled", items: [line("A", 5, 10, "p1")] },
    { status: "canceled", items: [line("A", 5, 10, "p1")] },
    { status: "refunded", items: [line("A", 5, 10, "p1")] },
    { status: "pending", items: [line("A", 3, 10, "p1")] },
  ];
  const r = buildSupplierReport("gb1", orders);
  assert.equal(r.totalQty, 3, "only the pending order feeds demand");
  assert.equal(r.orderCount, 1);
});

check("COMMITTED counts a paid order", () => {
  const orders: O[] = [{ status: "pending", paymentStatus: "paid", items: [line("A", 4, 10, "p1")] }];
  const r = buildSupplierReport("gb1", orders);
  assert.equal(r.totalQty, 4, "paid order is demand");
  assert.equal(r.committedTotalQty, 4, "paid order is also committed");
  assert.equal(r.committedOrderCount, 1);
});

check("COMMITTED counts a fulfilled status even when unpaid", () => {
  const orders: O[] = [{ status: "shipped", paymentStatus: "unpaid", items: [line("A", 6, 10, "p1")] }];
  const r = buildSupplierReport("gb1", orders);
  assert.equal(r.committedTotalQty, 6);
});

check("COMMITTED is reported ALONGSIDE demand, never instead", () => {
  const orders: O[] = [
    { status: "pending", paymentStatus: "unpaid", items: [line("A", 10, 10, "p1")] }, // demand only
    { status: "delivered", paymentStatus: "paid", items: [line("A", 3, 10, "p1")] }, // demand + committed
  ];
  const r = buildSupplierReport("gb1", orders);
  assert.equal(r.totalQty, 13, "demand headline = both orders");
  assert.equal(r.committedTotalQty, 3, "committed = the delivered/paid subset");
  const l = r.lines.find((x) => x.productId === "p1")!;
  assert.equal(l.qty, 13);
  assert.equal(l.committedQty, 3);
  assert.ok(l.committedQty <= l.qty, "committed can never exceed demand");
});

check("a paid BUT cancelled order counts as neither demand nor committed", () => {
  const orders: O[] = [{ status: "cancelled", paymentStatus: "paid", items: [line("A", 9, 10, "p1")] }];
  const r = buildSupplierReport("gb1", orders);
  assert.equal(r.totalQty, 0, "cancelled is excluded from demand even when paid");
  assert.equal(r.committedTotalQty, 0, "committed is a subset of demand");
});

check("lines stay sorted by demand qty descending", () => {
  const orders: O[] = [
    { status: "pending", items: [line("Low", 1, 10, "p1"), line("High", 9, 10, "p2")] },
  ];
  const r = buildSupplierReport("gb1", orders);
  assert.deepEqual(r.lines.map((l) => l.productId), ["p2", "p1"]);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
