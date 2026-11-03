/**
 * Orders screen: filter by order status AND payment, so an owner sees the new
 * orders and the payments they haven't confirmed in one click (asked for by
 * mnm-pepsabuy, 2026-10-30).
 *
 *   npm run test:order-list-filter
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyOrderFilter,
  isAwaitingPayment,
  isFiltered,
  NO_ORDER_FILTER,
  paymentCounts,
  statusCounts,
} from "../src/lib/storefront/order-list-filter";
import type { Order } from "../src/storefront/types";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(err as Error).message}`);
  }
}

type Row = Pick<Order, "status" | "paymentStatus"> & { id: string };
const row = (id: string, status: Order["status"], paymentStatus: Order["paymentStatus"]): Row => ({ id, status, paymentStatus });

const ORDERS: Row[] = [
  row("a", "new", "pending"),
  row("b", "new", "pending"),
  row("c", "new", "paid"),
  row("d", "confirmed", "pending"),
  row("e", "confirmed", "paid"),
  row("f", "shipped", "paid"),
  row("g", "cancelled", "pending"),
];
const ids = (list: Row[]) => list.map((o) => o.id).join("");

console.log("\norder list filter — matching");

check("no filter shows everything", () => {
  assert.equal(ids(applyOrderFilter(ORDERS, NO_ORDER_FILTER)), "abcdefg");
});

check("status alone", () => {
  assert.equal(ids(applyOrderFilter(ORDERS, { status: "new", payment: "all" })), "abc");
});

check("'Not confirmed' = unpaid and not cancelled", () => {
  assert.equal(ids(applyOrderFilter(ORDERS, { status: "all", payment: "unpaid" })), "abd");
  assert.equal(isAwaitingPayment(row("x", "cancelled", "pending")), false);
});

check("paid", () => {
  assert.equal(ids(applyOrderFilter(ORDERS, { status: "all", payment: "paid" })), "cef");
});

check("status + payment combine (new AND not confirmed)", () => {
  assert.equal(ids(applyOrderFilter(ORDERS, { status: "new", payment: "unpaid" })), "ab");
});

check("payment status is read case-insensitively, like the folder chips", () => {
  const legacy = { status: "new", paymentStatus: "PAID" } as unknown as Row;
  assert.equal(isAwaitingPayment(legacy), false);
});

console.log("\norder list filter — counts");

check("status tile counts follow the payment filter", () => {
  const c = statusCounts(ORDERS, "unpaid");
  assert.equal(c.all, 3);
  assert.equal(c.new, 2);
  assert.equal(c.confirmed, 1);
  assert.equal(c.cancelled, 0);
});

check("payment chip counts follow the status filter", () => {
  assert.deepEqual(paymentCounts(ORDERS, "all"), { all: 7, unpaid: 3, paid: 3 });
  assert.deepEqual(paymentCounts(ORDERS, "new"), { all: 3, unpaid: 2, paid: 1 });
});

check("a tile's number is exactly what clicking it shows", () => {
  for (const payment of ["all", "unpaid", "paid"] as const) {
    const counts = statusCounts(ORDERS, payment);
    for (const status of ["all", "new", "confirmed", "shipped", "cancelled"] as const) {
      assert.equal(counts[status], applyOrderFilter(ORDERS, { status, payment }).length, `${status}/${payment}`);
    }
  }
});

check("isFiltered", () => {
  assert.equal(isFiltered(NO_ORDER_FILTER), false);
  assert.equal(isFiltered({ status: "all", payment: "unpaid" }), true);
});

console.log("\norder list filter — wiring");

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

check("Orders screen uses the shared filter and shows a Payment row", () => {
  const src = read("src/storefront/admin/AdminOrders.tsx");
  assert.match(src, /applyOrderFilter\(visible, \{ status: filter, payment \}\)/);
  assert.match(src, /aria-label="Filter by payment"/);
  assert.match(src, /Not confirmed/);
  assert.match(src, /scope\?\.initialFilter\?\.payment/);
});

check("status tiles are buttons with a pressed state", () => {
  const src = read("src/storefront/admin/AdminOrders.tsx");
  assert.match(src, /className=\{`admin-stat-mini[^`]*`\}\s*data-tint=\{c\.id\}\s*aria-pressed=\{filter === c\.id\}/);
});

check("live round offers 'Review new' and 'Confirm payments' shortcuts", () => {
  const src = read("src/storefront/admin/AdminOrdersHub.tsx");
  assert.match(src, /onOpenFiltered\(\{ status: "new", payment: "all" \}\)/);
  assert.match(src, /onOpenFiltered\(\{ status: "all", payment: "unpaid" \}\)/);
  assert.match(src, /initialFilter: preset \?\? undefined/);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
