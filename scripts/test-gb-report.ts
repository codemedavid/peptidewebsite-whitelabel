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
import {
  buildCustomerLines,
  prepareReport,
  roundsAwaitingReport,
} from "../src/lib/storefront/group-buy-report";

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
const line = (name: string, qty: number, price: number, productId?: string, variation?: string) =>
  ({ name, qty, price, productId, variation });

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
  id: "gb-holiday",
  name: "Holiday Round",
  status: "closed",
  startsAt: "2026-06-01T00:00:00.000Z",
  endsAt: "2026-06-30T00:00:00.000Z",
};
const D = "2026-06-15T00:00:00.000Z"; // inside the round window
const reportOrders = [
  { orderNumber: "A1", date: D, status: "pending", paymentStatus: "unpaid", customer: { name: "Ann", email: "ann@x.io" }, items: [line("BPC-157", 2, 100, "p1")] },
  { orderNumber: "A2", date: D, status: "delivered", paymentStatus: "paid", customer: { name: "Bo", email: "bo@x.io" }, items: [line("BPC-157", 1, 100, "p1"), line("TB-500", 4, 50, "p2")] },
  { orderNumber: "A3", date: D, status: "cancelled", paymentStatus: "unpaid", customer: { name: "Cy", email: "cy@x.io" }, items: [line("TB-500", 9, 50, "p2")] },
];

check("the two reports are named apart so neither overwrites the other", () => {
  const p = prepareReport(round, reportOrders);
  assert.equal(p.supplierFilename, "GB-holiday-round-supplier.xlsx");
  assert.equal(p.customerFilename, "GB-holiday-round-customers.xlsx");
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

check("Totals: owner-facing summary + committed alongside", () => {
  const p = prepareReport(round, reportOrders);
  const get = (label: string) => p.totals.find((t) => t.label === label)?.value;
  assert.equal(get("Total Orders"), 3, "every linked order, cancelled included");
  assert.equal(get("Total Active Orders"), 2, "A1, A2 — cancelled A3 excluded");
  assert.equal(get("Total Cancelled Orders"), 1);
  assert.equal(get("Total Vials Ordered"), 7, "2 + (1+4); A3's 9 vials excluded");
  assert.equal(get("Total Sales"), 500, "2×100 + 1×100 + 4×50");
  assert.equal(get("Committed Orders"), 1);
  assert.equal(get("Committed Items"), 5, "A2 qty 1+4");
  assert.equal(get("Total Customers"), 2, "unique demand customers: Ann, Bo");
});

check("prepareReport uses the injected report instead of re-aggregating (no drift)", () => {
  // The caller (getGroupBuySupplierReportAction) already builds the SupplierReport
  // for the on-screen response; passing it in must avoid a SECOND
  // buildSupplierReport over the same orders, so the workbook can't diverge from
  // it. A sentinel report (deliberately unlike what the orders would produce)
  // proves the param is wired: the Product Summary and the report-derived totals
  // must reflect the injected report, not a recomputation.
  const sentinel: ReturnType<typeof buildSupplierReport> = {
    groupBuyId: "",
    orderCount: 1,
    totalQty: 777,
    totalRevenue: 8888,
    committedOrderCount: 1,
    committedTotalQty: 5,
    committedTotalRevenue: 55,
    lines: [
      { productId: "pX", name: "INJECTED", qty: 777, revenue: 8888, committedQty: 5, committedRevenue: 55 },
    ],
  };
  const p = prepareReport(round, reportOrders, sentinel);
  assert.deepEqual(p.summary.map((s) => s.productId), ["pX"], "summary comes from the injected report");
  assert.equal(p.summary[0].demandQty, 777);
  assert.equal(p.summary[0].committedQty, 5);
  const get = (label: string) => p.totals.find((t) => t.label === label)?.value;
  assert.equal(get("Committed Items"), 5, "report-derived totals reflect the injected report");
  // The owner-facing summary, the Orders sheet and Products to Order all derive
  // from the RAW orders — they are the same numbers the report page renders, so
  // an injected supplier report can't make the download disagree with the screen.
  assert.equal(get("Total Vials Ordered"), 7, "owner summary comes from the orders, not the injected report");
  assert.equal(p.orderLines.length, 4, "order lines still come from the raw orders");
  assert.equal(p.productsToOrder.reduce((s, r) => s + r.vials, 0), 7, "products to order also come from the raw orders");
});

// ── Customer lines (the customer report's own sheet) ────────────────────────
console.log("\nbuildCustomerLines — who ordered what\n");

/** Richer fixture: one customer orders TWICE, one cancels, one has no email. */
const custOrders = [
  { orderNumber: "C1", date: D, status: "pending", paymentStatus: "unpaid",
    customer: { name: "Ann", email: "ann@x.io", phone: "0917" },
    shipping: { address: "1 Mabini St", city: "Davao", province: "Davao del Sur", postalCode: "8000" },
    items: [line("BPC-157", 2, 100, "p1")] },
  { orderNumber: "C2", date: D, status: "confirmed", paymentStatus: "paid",
    customer: { name: "Ann", email: "ANN@x.io", phone: "0917" },
    items: [line("TB-500", 3, 50, "p2")] },
  { orderNumber: "C3", date: D, status: "cancelled", paymentStatus: "unpaid",
    customer: { name: "Cy", email: "cy@x.io" },
    items: [line("TB-500", 9, 50, "p2")] },
  { orderNumber: "C4", date: D, status: "pending", paymentStatus: "unpaid",
    customer: { name: "Dee", phone: "0999" },
    items: [line("BPC-157", 1, 100, "p1")] },
];

check("one row per customer — the same buyer's two orders merge", () => {
  const lines = buildCustomerLines(custOrders);
  const ann = lines.find((c) => c.name === "Ann");
  assert.ok(ann, "Ann must appear");
  assert.equal(ann.orders, 2, "both of Ann's orders roll into one row");
  assert.equal(ann.qty, 5, "2 + 3 vials");
  assert.equal(ann.total, 2 * 100 + 3 * 50);
});

check("the merge key is case-insensitive on email", () => {
  const lines = buildCustomerLines(custOrders);
  assert.equal(lines.filter((c) => c.name === "Ann").length, 1, "ANN@x.io is the same person as ann@x.io");
});

check("a cancelled-only customer never reaches the report", () => {
  const lines = buildCustomerLines(custOrders);
  assert.ok(!lines.some((c) => c.name === "Cy"), "cancelled orders are not demand");
});

check("a customer with no email still gets a row, keyed on phone", () => {
  const lines = buildCustomerLines(custOrders);
  const dee = lines.find((c) => c.name === "Dee");
  assert.ok(dee, "an emailless buyer must not be dropped");
  assert.equal(dee.email, "");
  assert.equal(dee.contact, "0999");
});

check("contact and shipping address ride along for fulfilment", () => {
  const lines = buildCustomerLines(custOrders);
  const ann = lines.find((c) => c.name === "Ann");
  assert.ok(ann, "Ann must appear");
  assert.equal(ann.contact, "0917");
  assert.ok(ann.address.includes("Mabini"), `address was "${ann.address}"`);
});

check("rows are sorted biggest spender first", () => {
  const lines = buildCustomerLines(custOrders);
  assert.deepEqual(lines.map((c) => c.name), ["Ann", "Dee"]);
});

check("no orders means an empty list, not a crash", () => {
  assert.deepEqual(buildCustomerLines([]), []);
});

check("prepareReport carries the customer lines for the workbook", () => {
  const p = prepareReport(round, reportOrders);
  assert.ok(Array.isArray(p.customerLines), "prep must expose customerLines");
  // Ann + Bo are demand; Cy cancelled.
  assert.deepEqual(p.customerLines.map((c) => c.name).sort(), ["Ann", "Bo"]);
});

// ── "Every finished round has a report" ──────────────────────────────────────
console.log("\nroundsAwaitingReport — which finished rounds still need pulling\n");

const PAST = "2020-01-01T00:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";
const gb = (
  id: string,
  status: "draft" | "scheduled" | "active" | "closed" | "cancelled" | "archived",
  endsAt: string | null = null,
) => ({
  id,
  name: id,
  status,
  startsAt: PAST,
  endsAt,
});

check("a round whose window has lapsed is awaiting its report", () => {
  const list = [gb("lapsed", "active", PAST)];
  assert.deepEqual(roundsAwaitingReport(list, false).map((r) => r.id), ["lapsed"]);
});

check("an explicitly closed round is awaiting its report", () => {
  assert.deepEqual(roundsAwaitingReport([gb("done", "closed")], false).map((r) => r.id), ["done"]);
});

check("a still-running round is NOT awaiting anything", () => {
  assert.deepEqual(roundsAwaitingReport([gb("live", "active", FUTURE)], false), []);
});

check("draft and scheduled rounds never appear", () => {
  const list = [gb("d", "draft"), gb("s", "scheduled", FUTURE)];
  assert.deepEqual(roundsAwaitingReport(list, true), []);
});

check("an ARCHIVED round is done being chased — the owner filed it away", () => {
  assert.deepEqual(roundsAwaitingReport([gb("old", "archived")], false), []);
});

check("a CANCELLED round is not a finished round — nothing was ordered against it", () => {
  assert.deepEqual(roundsAwaitingReport([gb("nope", "cancelled")], false), []);
});

check("every finished round is flagged, not just the first one", () => {
  const list = [gb("a", "closed"), gb("b", "active", PAST), gb("c", "active", FUTURE)];
  assert.deepEqual(roundsAwaitingReport(list, false).map((r) => r.id), ["a", "b"]);
});

check("a scheduled round that lapsed only closes when scheduling is on", () => {
  const list = [gb("sched", "scheduled", PAST)];
  assert.deepEqual(roundsAwaitingReport(list, false), [], "without the flag it never went live");
  assert.deepEqual(roundsAwaitingReport(list, true).map((r) => r.id), ["sched"]);
});

// ── Variations are separate SKUs ─────────────────────────────────────────────
// k-glow, 2026-08-21: the supplier sheet read "14 × Bacteriostatic Water — 5ml"
// when the round actually needed 4×5ml, 4×10ml, 3×3ml and 3×3ml-5-vials. Every
// variation of a product shares ONE productId, and the grouping key was the
// productId alone, so four SKUs collapsed into one row labelled by whichever
// arrived first. Ordering against that row buys 14 of the wrong size.
console.log("\nVariations must never collapse into one supplier line\n");

const BAC = "p-bac";
const bacOrders = [
  { orderNumber: "V1", date: D, status: "shipped", paymentStatus: "paid",
    customer: { name: "Ann", email: "ann@x.io" },
    items: [
      line("Bacteriostatic Water — 5ml", 4, 510, BAC, "5ml"),
      line("Bacteriostatic Water — 10ml", 4, 732, BAC, "10ml"),
    ] },
  { orderNumber: "V2", date: D, status: "shipped", paymentStatus: "paid",
    customer: { name: "Bo", email: "bo@x.io" },
    items: [
      line("Bacteriostatic Water — 3ml", 3, 488, BAC, "3ml"),
      line("Bacteriostatic Water — 3ml bac 5 vials", 3, 245, BAC, "3ml bac 5 vials"),
    ] },
];

check("buildSupplierReport keeps each variation on its own line", () => {
  const r = buildSupplierReport("gb", bacOrders);
  assert.equal(r.lines.length, 4, `expected 4 SKUs, got ${r.lines.map((l) => l.name).join(" | ")}`);
  assert.equal(r.totalQty, 14, "the vial total is unchanged — only the split differs");
});

check("buildProductsToOrder gives the supplier one row per variation", () => {
  const p = prepareReport(round, bacOrders);
  const byName = new Map(p.productsToOrder.map((x) => [x.product, x.vials]));
  assert.equal(byName.get("Bacteriostatic Water — 5ml"), 4);
  assert.equal(byName.get("Bacteriostatic Water — 10ml"), 4);
  assert.equal(byName.get("Bacteriostatic Water — 3ml"), 3);
  assert.equal(byName.get("Bacteriostatic Water — 3ml bac 5 vials"), 3);
});

check("the variation rows still sum to the headline vial count", () => {
  const p = prepareReport(round, bacOrders);
  assert.equal(p.productsToOrder.reduce((s, x) => s + x.vials, 0), p.counts.totalVials);
  assert.equal(p.counts.totalVials, 14);
});

check("Product Summary carries every variation too, none swallowed", () => {
  const p = prepareReport(round, bacOrders);
  assert.equal(p.summary.length, 4);
  assert.equal(p.summary.reduce((s, x) => s + x.demandQty, 0), 14);
});

check("per-variation order counts are right, not copied from the base product", () => {
  const p = prepareReport(round, bacOrders);
  for (const row of p.summary) assert.equal(row.orders, 1, `${row.product} was ordered by one order`);
});

check("a product with NO variations still groups by productId (no regression)", () => {
  const plain = [
    { orderNumber: "P1", date: D, status: "pending", customer: { name: "Ann" },
      items: [line("BPC-157", 2, 100, "p1")] },
    { orderNumber: "P2", date: D, status: "pending", customer: { name: "Bo" },
      items: [line("BPC-157 RENAMED", 3, 100, "p1")] },
  ];
  const p = prepareReport(round, plain);
  assert.equal(p.productsToOrder.length, 1, "one productId, no variation → still one line");
  assert.equal(p.productsToOrder[0].vials, 5, "a rename must not split the supplier order");
});

check("two variations of DIFFERENT products never merge", () => {
  const mixed = [
    { orderNumber: "M1", date: D, status: "pending", customer: { name: "Ann" },
      items: [line("A — 5ml", 2, 100, "pA", "5ml"), line("B — 5ml", 3, 100, "pB", "5ml")] },
  ];
  const p = prepareReport(round, mixed);
  assert.equal(p.productsToOrder.length, 2, "same variation label, different product");
});

check("legacy items with no productId still fall back to the name", () => {
  const legacy = [
    { orderNumber: "L1", date: D, status: "pending", customer: { name: "Ann" },
      items: [line("Legacy Peptide", 2, 100), line("Legacy Peptide", 3, 100)] },
  ];
  const p = prepareReport(round, legacy);
  assert.equal(p.productsToOrder.length, 1);
  assert.equal(p.productsToOrder[0].vials, 5);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
