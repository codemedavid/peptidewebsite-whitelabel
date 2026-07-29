/**
 * Tests for per-round Group Buy analytics — src/lib/storefront/group-buy-analytics.ts.
 * Pure, no I/O.
 *
 * These back the Group Buy Management redesign: a list row per round, and a
 * dedicated dashboard per round. The rules that are easy to get wrong:
 *
 *   • Analytics are PER ROUND, never global. Every function takes the orders
 *     already resolved for one round (see group-buy-orders.resolveRoundOrders).
 *   • Cancelled orders NEVER feed gross income, revenue, or the vials the
 *     supplier order is sized against. They are still counted and displayed.
 *   • grossIncome === confirmedPayments + pendingPayments, always.
 *   • totalVials === confirmedVials + pendingVials, always (cancelled sits outside).
 *
 * Two definitions were decided with the store owner and are asserted here so a
 * later reader can't silently reinterpret them:
 *   • Outstanding Balance = the value of non-cancelled orders not yet marked
 *     paid. The system has no partial payments (paymentStatus is pending|paid),
 *     so it cannot mean "part of an order still owed".
 *   • Batch Number = an owner-typed field on the round, falling back to the
 *     round name when blank.
 *
 *   npm run test:gb-analytics
 */

import assert from "node:assert";

import {
  buildRoundAnalytics,
  buildRoundListRow,
  displayRoundStatus,
  resolveRoundProductName,
  countParticipants,
  filterOrderRows,
  type AnalyticsRound,
} from "../src/lib/storefront/group-buy-analytics";
import { buildRoundOrderRows, type LinkableOrder } from "../src/lib/storefront/group-buy-orders";

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

const line = (name: string, qty: number, price: number, productId?: string) => ({ name, qty, price, productId });

const round: AnalyticsRound = {
  id: "gb-tr30-1",
  name: "TR30 Batch #1",
  status: "active",
  batchNumber: "TR30-B1",
  startsAt: "2026-07-01T00:00:00.000Z",
  endsAt: "2026-07-31T00:00:00.000Z",
  createdAt: "2026-06-28T00:00:00.000Z",
  closedAt: null,
  minVials: 5,
  maxVials: 10,
  productIds: ["p1"],
};

const order = (o: Partial<LinkableOrder> & { date: string }): LinkableOrder => ({
  orderNumber: "X",
  status: "new",
  paymentStatus: "pending",
  paymentMethod: "BDO",
  paymentProof: null,
  groupBuyId: "gb-tr30-1",
  customer: {},
  shipping: {},
  items: [],
  ...o,
});

/** 4 paid vials (₱400) + 3 unpaid vials (₱300) + 99 cancelled vials (₱9,900). */
const orders: LinkableOrder[] = [
  order({
    orderNumber: "A1",
    date: "2026-07-05T00:00:00.000Z",
    status: "confirmed",
    paymentStatus: "paid",
    customer: { name: "Ann", email: "ann@x.io", phone: "0900" },
    items: [line("TR30", 4, 100, "p1")],
  }),
  order({
    orderNumber: "A2",
    date: "2026-07-10T00:00:00.000Z",
    status: "new",
    paymentStatus: "pending",
    customer: { name: "Bo", email: "bo@x.io", phone: "0901" },
    items: [line("TR30", 3, 100, "p1")],
  }),
  order({
    orderNumber: "A3",
    date: "2026-07-12T00:00:00.000Z",
    status: "cancelled",
    paymentStatus: "paid",
    customer: { name: "Cy", email: "cy@x.io", phone: "0902" },
    items: [line("TR30", 99, 100, "p1")],
  }),
];

const productNames = new Map([
  ["p1", "Tirzepatide 30mg"],
  ["p2", "Retatrutide 20mg"],
]);

// ── Financial analytics ──────────────────────────────────────────────────────
console.log("\nbuildRoundAnalytics — financial (cancelled never counted)\n");

check("Gross Income EXCLUDES cancelled orders", () => {
  // Arrange / Act
  const a = buildRoundAnalytics(round, orders, productNames);
  // Assert — 4×100 + 3×100; the cancelled 99×100 must not leak in.
  assert.equal(a.financial.grossIncome, 700);
});

check("Confirmed Payments = the paid, non-cancelled value", () => {
  assert.equal(buildRoundAnalytics(round, orders, productNames).financial.confirmedPayments, 400);
});

check("Pending Payments = the unpaid, non-cancelled value", () => {
  assert.equal(buildRoundAnalytics(round, orders, productNames).financial.pendingPayments, 300);
});

check("Revenue Collected equals Confirmed Payments — money actually in hand", () => {
  const f = buildRoundAnalytics(round, orders, productNames).financial;
  assert.equal(f.revenueCollected, f.confirmedPayments);
});

check("Outstanding Balance = value of non-cancelled orders not yet paid", () => {
  const f = buildRoundAnalytics(round, orders, productNames).financial;
  assert.equal(f.outstandingBalance, 300, "no partial payments exist — this is the unpaid order value");
});

check("grossIncome always equals confirmed + pending", () => {
  const f = buildRoundAnalytics(round, orders, productNames).financial;
  assert.equal(f.grossIncome, f.confirmedPayments + f.pendingPayments);
});

check("Total Cancelled Orders is counted even though its money is excluded", () => {
  assert.equal(buildRoundAnalytics(round, orders, productNames).financial.cancelledOrders, 1);
});

check("a paid BUT cancelled order adds nothing to revenue", () => {
  const only = [orders[2]];
  const f = buildRoundAnalytics(round, only, productNames).financial;
  assert.equal(f.grossIncome, 0);
  assert.equal(f.revenueCollected, 0, "cancellation outranks payment");
  assert.equal(f.cancelledOrders, 1);
});

// ── Product analytics ────────────────────────────────────────────────────────
console.log("\nbuildRoundAnalytics — product / vials\n");

check("Total Vials Ordered excludes cancelled vials", () => {
  assert.equal(buildRoundAnalytics(round, orders, productNames).product.totalVials, 7, "4 + 3, not 106");
});

check("vials split into confirmed / pending / cancelled", () => {
  const p = buildRoundAnalytics(round, orders, productNames).product;
  assert.equal(p.confirmedVials, 4);
  assert.equal(p.pendingVials, 3);
  assert.equal(p.cancelledVials, 99, "cancelled vials are reported, just never ordered");
});

check("totalVials always equals confirmed + pending", () => {
  const p = buildRoundAnalytics(round, orders, productNames).product;
  assert.equal(p.totalVials, p.confirmedVials + p.pendingVials);
});

check("Remaining Available Vials = max − total, never negative", () => {
  assert.equal(buildRoundAnalytics(round, orders, productNames).product.remainingVials, 3, "10 − 7");
  const over = buildRoundAnalytics({ ...round, maxVials: 5 }, orders, productNames).product;
  assert.equal(over.remainingVials, 0, "an over-subscribed round shows 0 left, never a negative");
});

check("Completion Percentage = total / max", () => {
  assert.equal(buildRoundAnalytics(round, orders, productNames).product.completionPct, 70);
});

check("over-subscription reports past 100% rather than silently capping", () => {
  const p = buildRoundAnalytics({ ...round, maxVials: 5 }, orders, productNames).product;
  assert.equal(p.completionPct, 140, "7 of 5 — the owner must see the oversell");
});

check("no maxVials set → remaining and completion are null, not a fake 0%", () => {
  const p = buildRoundAnalytics({ ...round, maxVials: null }, orders, productNames).product;
  assert.equal(p.remainingVials, null);
  assert.equal(p.completionPct, null);
});

// ── Overview ─────────────────────────────────────────────────────────────────
console.log("\nbuildRoundAnalytics — overview\n");

check("Total Participants counts unique non-cancelled customers", () => {
  assert.equal(
    buildRoundAnalytics(round, orders, productNames).overview.participants,
    2,
    "Ann and Bo; cancelled Cy is not a participant",
  );
});

check("the same customer ordering twice is ONE participant", () => {
  const twice = [
    orders[0],
    order({
      orderNumber: "A4",
      date: "2026-07-11T00:00:00.000Z",
      customer: { name: "Ann", email: "ann@x.io" },
      items: [line("TR30", 1, 100, "p1")],
    }),
  ];
  assert.equal(countParticipants(twice), 1);
  assert.equal(buildRoundAnalytics(round, twice, productNames).overview.totalOrders, 2, "…but still two orders");
});

check("Total Orders counts every order incl cancelled", () => {
  assert.equal(buildRoundAnalytics(round, orders, productNames).overview.totalOrders, 3);
});

check("Progress reads current vials against the maximum", () => {
  const o = buildRoundAnalytics(round, orders, productNames).overview;
  assert.equal(o.currentVials, 7);
  assert.equal(o.maxVials, 10);
});

check("minimumMet flips once the minimum requirement is reached", () => {
  assert.equal(buildRoundAnalytics(round, orders, productNames).overview.minimumMet, true, "7 ≥ 5");
  assert.equal(buildRoundAnalytics({ ...round, minVials: 20 }, orders, productNames).overview.minimumMet, false);
  assert.equal(
    buildRoundAnalytics({ ...round, minVials: null }, orders, productNames).overview.minimumMet,
    null,
    "no minimum configured → not a failure, just unknown",
  );
});

check("Closed Date is surfaced only when the round actually closed", () => {
  assert.equal(buildRoundAnalytics(round, orders, productNames).overview.closedAt, null);
  const closed = buildRoundAnalytics(
    { ...round, status: "closed", closedAt: "2026-07-31T00:00:00.000Z" },
    orders,
    productNames,
  ).overview;
  assert.equal(closed.closedAt, "2026-07-31T00:00:00.000Z");
});

// ── Status display ───────────────────────────────────────────────────────────
console.log("\ndisplayRoundStatus — owner-facing labels\n");

check("active → Open, closed → Completed, cancelled → Cancelled", () => {
  assert.equal(displayRoundStatus("active"), "Open");
  assert.equal(displayRoundStatus("closed"), "Completed");
  assert.equal(displayRoundStatus("cancelled"), "Cancelled");
});

check("draft / scheduled / archived keep their own labels", () => {
  assert.equal(displayRoundStatus("draft"), "Draft");
  assert.equal(displayRoundStatus("scheduled"), "Scheduled");
  assert.equal(displayRoundStatus("archived"), "Archived");
});

// ── Product name + batch number ──────────────────────────────────────────────
console.log("\nresolveRoundProductName + batch number\n");

check("a round assigned ONE product shows that product's name", () => {
  assert.equal(resolveRoundProductName({ ...round, productIds: ["p1"] }, productNames), "Tirzepatide 30mg");
});

check("a round assigned SEVERAL products shows the count, not a misleading single name", () => {
  assert.equal(resolveRoundProductName({ ...round, productIds: ["p1", "p2"] }, productNames), "2 products");
});

check("a round assigned NO products covers the whole catalog", () => {
  assert.equal(resolveRoundProductName({ ...round, productIds: [] }, productNames), "Whole catalog");
});

check("an assigned product that no longer exists doesn't render a raw id", () => {
  assert.equal(resolveRoundProductName({ ...round, productIds: ["deleted"] }, productNames), "1 product");
});

check("Batch Number falls back to the round name when the owner left it blank", () => {
  assert.equal(buildRoundAnalytics(round, orders, productNames).overview.batchNumber, "TR30-B1");
  assert.equal(
    buildRoundAnalytics({ ...round, batchNumber: "" }, orders, productNames).overview.batchNumber,
    "TR30 Batch #1",
  );
});

// ── List row ─────────────────────────────────────────────────────────────────
console.log("\nbuildRoundListRow — the management list\n");

check("a list row carries every column the management page shows", () => {
  const r = buildRoundListRow(round, orders, productNames);
  assert.equal(r.id, "gb-tr30-1");
  assert.equal(r.name, "TR30 Batch #1");
  assert.equal(r.productName, "Tirzepatide 30mg");
  assert.equal(r.batchNumber, "TR30-B1");
  assert.equal(r.status, "Open");
  assert.equal(r.currentVials, 7);
  assert.equal(r.maxVials, 10);
  assert.equal(r.totalOrders, 3);
  assert.equal(r.participants, 2);
  assert.equal(r.grossIncome, 700);
  assert.equal(r.createdAt, "2026-06-28T00:00:00.000Z");
});

check("list-row numbers match the dashboard's for the same round (no drift)", () => {
  const r = buildRoundListRow(round, orders, productNames);
  const a = buildRoundAnalytics(round, orders, productNames);
  assert.equal(r.grossIncome, a.financial.grossIncome);
  assert.equal(r.currentVials, a.product.totalVials);
  assert.equal(r.participants, a.overview.participants);
  assert.equal(r.totalOrders, a.overview.totalOrders);
});

check("analytics are per round — a different round's orders never bleed in", () => {
  // buildRoundAnalytics only ever sees the orders handed to it, so an empty
  // slice must produce zeroes rather than reaching for anything global.
  const a = buildRoundAnalytics(round, [], productNames);
  assert.equal(a.financial.grossIncome, 0);
  assert.equal(a.product.totalVials, 0);
  assert.equal(a.overview.participants, 0);
  assert.equal(a.overview.totalOrders, 0);
});

// ── Order table filters ──────────────────────────────────────────────────────
console.log("\nfilterOrderRows — orders table filtering\n");

const rows = buildRoundOrderRows(round, orders);

check("no filters returns every row", () => {
  assert.equal(filterOrderRows(rows, {}).length, rows.length);
});

check("filter by payment status", () => {
  assert.ok(filterOrderRows(rows, { paymentStatus: "Confirmed" }).every((r) => r.paymentStatus === "Confirmed"));
  assert.equal(filterOrderRows(rows, { paymentStatus: "Cancelled" }).length, 1);
});

check("filter by order status", () => {
  const out = filterOrderRows(rows, { orderStatus: "confirmed" });
  assert.equal(out.length, 1);
  assert.equal(out[0].orderNumber, "A1");
});

check("filter by customer name, case-insensitive substring", () => {
  assert.equal(filterOrderRows(rows, { customer: "ann" })[0].customer, "Ann");
  assert.equal(filterOrderRows(rows, { customer: "ANN" }).length, 1);
  assert.equal(filterOrderRows(rows, { customer: "nobody" }).length, 0);
});

check("filter by date range, inclusive on both ends", () => {
  assert.equal(filterOrderRows(rows, { from: "2026-07-10" }).length, 2, "A2 and A3");
  assert.equal(filterOrderRows(rows, { to: "2026-07-05" }).length, 1, "A1 only");
  assert.equal(filterOrderRows(rows, { from: "2026-07-05", to: "2026-07-05" }).length, 1, "boundary day is included");
});

check("filters combine — every condition must hold", () => {
  assert.equal(filterOrderRows(rows, { paymentStatus: "Pending", customer: "Bo" }).length, 1);
  assert.equal(filterOrderRows(rows, { paymentStatus: "Pending", customer: "Ann" }).length, 0);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
