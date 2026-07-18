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
import { prepareReport } from "../src/lib/storefront/group-buy-report";

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

// ── prepareReport: the 3-sheet workbook data (pure, no exceljs) ──────────────
console.log("\nprepareReport — 3-sheet workbook data\n");

const round = {
  name: "Holiday Round",
  status: "closed",
  startsAt: "2026-06-01T00:00:00.000Z",
  endsAt: "2026-06-30T00:00:00.000Z",
};
const reportOrders = [
  { orderNumber: "A1", status: "pending", paymentStatus: "unpaid", customer: { name: "Ann", email: "ann@x.io" }, items: [line("BPC-157", 2, 100, "p1")] },
  { orderNumber: "A2", status: "delivered", paymentStatus: "paid", customer: { name: "Bo", email: "bo@x.io" }, items: [line("BPC-157", 1, 100, "p1"), line("TB-500", 4, 50, "p2")] },
  { orderNumber: "A3", status: "cancelled", paymentStatus: "unpaid", customer: { name: "Cy", email: "cy@x.io" }, items: [line("TB-500", 9, 50, "p2")] },
];

check("filename is GB-{slug(name)}-report.xlsx", () => {
  const p = prepareReport(round, reportOrders);
  assert.equal(p.filename, "GB-holiday-round-report.xlsx");
});

check("Product Summary: one row per product, demand desc, with committed subset", () => {
  const p = prepareReport(round, reportOrders);
  // demand: p1 = 2+1 = 3 ; p2 = 4 (A3 cancelled excluded). p2 > p1.
  assert.deepEqual(p.summary.map((s) => s.productId), ["p2", "p1"]);
  const p1 = p.summary.find((s) => s.productId === "p1")!;
  assert.equal(p1.demandQty, 3);
  assert.equal(p1.committedQty, 1, "only the delivered/paid A2 line is committed");
  assert.equal(p1.orders, 2, "p1 appears on A1 and A2");
});

check("Orders sheet lists EVERY line incl cancelled, with Counted Yes/No", () => {
  const p = prepareReport(round, reportOrders);
  // lines: A1(1) + A2(2) + A3(1) = 4
  assert.equal(p.orderLines.length, 4);
  const a3 = p.orderLines.find((l) => l.orderNumber === "A3")!;
  assert.equal(a3.counted, false, "cancelled line is present but not counted");
  const a1 = p.orderLines.find((l) => l.orderNumber === "A1")!;
  assert.equal(a1.counted, true);
});

check("Totals: demand headline + committed alongside + cancelled count", () => {
  const p = prepareReport(round, reportOrders);
  const get = (label: string) => p.totals.find((t) => t.label === label)?.value;
  assert.equal(get("Placed Orders"), 2, "demand order count (A1, A2)");
  assert.equal(get("Cancelled Orders"), 1);
  assert.equal(get("Total Items"), 7, "demand qty: 2 + (1+4)");
  assert.equal(get("Committed Orders"), 1);
  assert.equal(get("Committed Items"), 5, "A2 qty 1+4");
  assert.equal(get("Total Customers"), 2, "unique demand customers: Ann, Bo");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
