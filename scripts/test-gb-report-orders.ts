/**
 * Tests for the Group Buy report's ORDER layer — src/lib/storefront/group-buy-orders.ts.
 * Pure, no I/O.
 *
 * The bug this file locks down (found on the k-glow tenant, 2026-07-29):
 *   The report resolved a round's orders by attribution ALONE
 *   (StorefrontOrder.groupBuyId). groupBuyId is stamped once at checkout by
 *   groupBuyForOrder(), which only matches when an ordered productId appears in
 *   the round's `productIds` assignment. k-glow's live round assigned 5 products
 *   nobody ordered, so all 3 real orders were stamped NULL — and because nothing
 *   ever backfills the column, the report showed "0 orders · 0 units · ₱0"
 *   permanently.
 *
 * The rule, decided with the store owner:
 *   • Attributed to THIS round          → always included (any date).
 *   • Attributed to a DIFFERENT round   → always excluded.
 *   • Unattributed (groupBuyId null)    → included when placedAt falls inside
 *                                         this round's [startsAt, endsAt] window.
 *   • Unattributed and inside NO round's window → counted as `unlinked` so it is
 *                                         surfaced, never silently dropped.
 *
 * Plus the summary/export rules: cancelled orders are excluded from Total Vials,
 * Total Sales and Products to Order — but still listed on the Orders sheet.
 *
 *   npm run test:gb-report-orders
 */

import assert from "node:assert";

import {
  resolveRoundOrders,
  summarizeRoundOrders,
  buildRoundOrderRows,
  buildProductsToOrder,
  displayPaymentStatus,
  formatShippingAddress,
  type LinkableOrder,
  type ReportRoundWindow,
} from "../src/lib/storefront/group-buy-orders";
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

const line = (name: string, qty: number, price: number, productId?: string) => ({
  name,
  qty,
  price,
  productId,
});

/** The k-glow shape: a closed round with a 2-day window. */
const july: ReportRoundWindow = {
  id: "gb-july",
  name: "july 28",
  status: "closed",
  startsAt: "2026-07-28T06:03:00.000Z",
  endsAt: "2026-07-30T06:03:00.000Z",
  createdAt: "2026-07-28T00:00:00.000Z",
};
const june: ReportRoundWindow = {
  id: "gb-june",
  name: "june gb",
  status: "closed",
  startsAt: "2026-07-21T12:53:00.000Z",
  endsAt: "2026-07-25T12:53:00.000Z",
  createdAt: "2026-07-21T00:00:00.000Z",
};

const order = (o: Partial<LinkableOrder> & { date: string }): LinkableOrder => ({
  orderNumber: "X",
  status: "new",
  paymentStatus: "pending",
  paymentMethod: "",
  paymentProof: null,
  groupBuyId: null,
  customer: {},
  shipping: {},
  items: [],
  ...o,
});

// ── Linking: the root cause ──────────────────────────────────────────────────
console.log("\nresolveRoundOrders — attribution + window fallback\n");

check("unattributed orders inside the round's window ARE linked (the k-glow bug)", () => {
  // Arrange — the exact k-glow shape: real orders, groupBuyId never stamped
  // because the ordered products were not in the round's productIds assignment.
  const orders = [
    order({ orderNumber: "KG-1002", date: "2026-07-29T02:00:00.000Z", items: [line("Tirzepatide", 1, 4900, "p1")] }),
    order({ orderNumber: "KG-1003", date: "2026-07-29T05:00:00.000Z", items: [line("Tirzepatide", 1, 4900, "p1")] }),
  ];

  // Act
  const r = resolveRoundOrders(july, orders, [june, july]);

  // Assert
  assert.equal(r.orders.length, 2, "both in-window unattributed orders must appear");
  assert.equal(r.unlinked, 0);
});

check("an unattributed order outside EVERY round's window is reported as unlinked, not dropped", () => {
  // KG-1001 was placed 2026-07-26 — after "june gb" closed, before "july 28" opened.
  const orders = [order({ orderNumber: "KG-1001", date: "2026-07-26T10:00:00.000Z", items: [line("A", 1, 100, "p1")] })];

  const r = resolveRoundOrders(july, orders, [june, july]);

  assert.equal(r.orders.length, 0, "it belongs to no round — never invented into this one");
  assert.equal(r.unlinked, 1, "but it must be surfaced so the owner can see it");
});

check("an order attributed to THIS round is included regardless of its date", () => {
  const orders = [
    order({ orderNumber: "OLD", date: "2020-01-01T00:00:00.000Z", groupBuyId: "gb-july", items: [line("A", 3, 10, "p1")] }),
  ];
  const r = resolveRoundOrders(july, orders, [june, july]);
  assert.equal(r.orders.length, 1, "explicit attribution always wins over the window");
});

check("an order attributed to a DIFFERENT round is never swept in by the window", () => {
  const orders = [
    order({ orderNumber: "J1", date: "2026-07-29T02:00:00.000Z", groupBuyId: "gb-june", items: [line("A", 3, 10, "p1")] }),
  ];
  const r = resolveRoundOrders(july, orders, [june, july]);
  assert.equal(r.orders.length, 0, "already owned by june — must not double-count");
  assert.equal(r.unlinked, 0, "attributed elsewhere is not 'unlinked'");
});

check("overlapping windows assign an unattributed order to ONE round (earliest created)", () => {
  const overlap: ReportRoundWindow = {
    id: "gb-overlap",
    name: "overlap",
    status: "closed",
    startsAt: "2026-07-28T00:00:00.000Z",
    endsAt: "2026-07-31T00:00:00.000Z",
    createdAt: "2026-07-29T00:00:00.000Z", // created AFTER july
  };
  const orders = [order({ date: "2026-07-29T02:00:00.000Z", items: [line("A", 1, 10, "p1")] })];

  assert.equal(resolveRoundOrders(july, orders, [july, overlap]).orders.length, 1, "earliest-created round wins");
  assert.equal(resolveRoundOrders(overlap, orders, [july, overlap]).orders.length, 0, "the later round must not double-count it");
});

check("a round with no window at all sweeps nothing — attribution only", () => {
  const undated: ReportRoundWindow = { id: "gb-x", name: "draft", status: "draft", startsAt: null, endsAt: null, createdAt: "2026-01-01T00:00:00.000Z" };
  const orders = [order({ date: "2026-07-29T02:00:00.000Z", items: [line("A", 1, 10, "p1")] })];
  const r = resolveRoundOrders(undated, orders, [undated]);
  assert.equal(r.orders.length, 0, "an undated round must not claim the whole order history");
});

check("window bounds are inclusive at both edges", () => {
  const orders = [
    order({ orderNumber: "OPEN", date: july.startsAt!, items: [line("A", 1, 10, "p1")] }),
    order({ orderNumber: "CLOSE", date: july.endsAt!, items: [line("A", 1, 10, "p1")] }),
  ];
  assert.equal(resolveRoundOrders(july, orders, [july]).orders.length, 2);
});

// ── Summary totals ───────────────────────────────────────────────────────────
console.log("\nsummarizeRoundOrders — cancelled excluded from vials & sales\n");

const summaryOrders: LinkableOrder[] = [
  order({ orderNumber: "S1", date: "2026-07-29T00:00:00.000Z", status: "confirmed", paymentStatus: "paid", items: [line("A", 4, 100, "p1")] }),
  order({ orderNumber: "S2", date: "2026-07-29T00:00:00.000Z", status: "new", paymentStatus: "pending", items: [line("A", 3, 100, "p1")] }),
  order({ orderNumber: "S3", date: "2026-07-29T00:00:00.000Z", status: "cancelled", paymentStatus: "paid", items: [line("A", 99, 100, "p1")] }),
];

check("Total Orders counts every linked order incl cancelled", () => {
  assert.equal(summarizeRoundOrders(summaryOrders).totalOrders, 3);
});

check("Active / Confirmed / Pending / Cancelled buckets add up", () => {
  const s = summarizeRoundOrders(summaryOrders);
  assert.equal(s.cancelledOrders, 1);
  assert.equal(s.activeOrders, 2, "active = total − cancelled");
  assert.equal(s.confirmedOrders, 1, "paid and not cancelled");
  assert.equal(s.pendingOrders, 1, "unpaid and not cancelled");
  assert.equal(s.confirmedOrders + s.pendingOrders, s.activeOrders, "confirmed + pending must equal active");
});

check("Total Vials EXCLUDES cancelled orders", () => {
  assert.equal(summarizeRoundOrders(summaryOrders).totalVials, 7, "4 + 3 — the cancelled 99 must not leak in");
});

check("Total Sales EXCLUDES cancelled orders", () => {
  assert.equal(summarizeRoundOrders(summaryOrders).totalSales, 700, "(4+3) × ₱100");
});

check("a paid-but-cancelled order counts as Cancelled, never Confirmed", () => {
  const s = summarizeRoundOrders([summaryOrders[2]]);
  assert.equal(s.cancelledOrders, 1);
  assert.equal(s.confirmedOrders, 0, "cancellation outranks payment");
});

check("'canceled' and 'refunded' spellings are excluded too", () => {
  const s = summarizeRoundOrders([
    order({ date: "d", status: "canceled", items: [line("A", 5, 10, "p1")] }),
    order({ date: "d", status: "refunded", items: [line("A", 5, 10, "p1")] }),
  ]);
  assert.equal(s.totalVials, 0);
  assert.equal(s.cancelledOrders, 2);
});

// ── Products to order ────────────────────────────────────────────────────────
console.log("\nbuildProductsToOrder — the supplier order sheet\n");

check("sums vials per product, cancelled excluded, biggest first", () => {
  const rows = buildProductsToOrder([
    order({ date: "d", status: "new", items: [line("TR30", 20, 100, "p1"), line("RT20", 22, 100, "p2")] }),
    order({ date: "d", status: "confirmed", items: [line("TR30", 17, 100, "p1")] }),
    order({ date: "d", status: "cancelled", items: [line("TR30", 500, 100, "p1")] }),
  ]);
  assert.deepEqual(
    rows.map((r) => [r.product, r.vials]),
    [
      ["TR30", 37],
      ["RT20", 22],
    ],
    "cancelled excluded, sorted by vials descending",
  );
});

check("legacy lines with no productId group by name", () => {
  const rows = buildProductsToOrder([
    order({ date: "d", items: [line("CGL5", 10, 100)] }),
    order({ date: "d", items: [line("CGL5", 5, 100)] }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].vials, 15);
});

// ── Per-order rows (the report table + Excel Orders sheet) ───────────────────
console.log("\nbuildRoundOrderRows — every field the owner reconciles against\n");

const detailed = order({
  orderNumber: "KG-1003",
  date: "2026-07-29T05:00:00.000Z",
  status: "confirmed",
  paymentStatus: "paid",
  paymentMethod: "BDO",
  paymentProof: "https://ik.imagekit.io/x/proof.jpg",
  customer: { name: "erik santos", email: "erik@x.io", phone: "09451625646" },
  shipping: { address: "block 9 lot 70", barangay: "sta cruz", city: "bacoor", province: "cavite", postal: "5561", country: "Philippines" },
  items: [line("Tirzepatide", 1, 4900, "p1"), line("Tesamorelin", 2, 10974, "p2")],
});

check("one row per order LINE, carrying every required column", () => {
  const rows = buildRoundOrderRows(july, [detailed]);
  assert.equal(rows.length, 2, "two products → two rows");
  const r = rows[0];
  assert.equal(r.orderNumber, "KG-1003");
  assert.equal(r.customer, "erik santos");
  assert.equal(r.contact, "09451625646");
  assert.ok(r.address.includes("bacoor") && r.address.includes("cavite"), "shipping address is present");
  assert.equal(r.product, "Tirzepatide");
  assert.equal(r.batch, "july 28", "batch number = the group buy round");
  assert.equal(r.vials, 1);
  assert.equal(r.orderDate, "2026-07-29T05:00:00.000Z");
  assert.equal(r.paymentMethod, "BDO");
  assert.equal(r.paymentStatus, "Confirmed");
  assert.equal(r.orderStatus, "confirmed");
  assert.equal(r.proofUrl, "https://ik.imagekit.io/x/proof.jpg");
  assert.equal(r.counted, true);
});

check("cancelled orders still LIST on the report, flagged as not counted", () => {
  const rows = buildRoundOrderRows(july, [{ ...detailed, status: "cancelled" }]);
  assert.equal(rows.length, 2, "cancelled orders are visible…");
  assert.ok(rows.every((r) => r.counted === false), "…but never counted toward the supplier order");
  assert.ok(rows.every((r) => r.paymentStatus === "Cancelled"));
});

check("payment status maps to the three owner-facing labels", () => {
  assert.equal(displayPaymentStatus({ status: "new", paymentStatus: "paid" }), "Confirmed");
  assert.equal(displayPaymentStatus({ status: "new", paymentStatus: "pending" }), "Pending");
  assert.equal(displayPaymentStatus({ status: "cancelled", paymentStatus: "paid" }), "Cancelled");
});

check("shipping address joins only the parts that are filled in", () => {
  assert.equal(
    formatShippingAddress({ address: "block 9", barangay: "", city: "bacoor", province: "cavite", postal: "", country: "Philippines" }),
    "block 9, bacoor, cavite, Philippines",
  );
  assert.equal(formatShippingAddress({}), "—", "an empty shipping blob never renders stray commas");
});

// ── Excel export parity ──────────────────────────────────────────────────────
console.log("\nprepareReport — Excel export matches the on-screen numbers\n");

const exportOrders = [
  order({ orderNumber: "E1", date: "2026-07-29T00:00:00.000Z", status: "confirmed", paymentStatus: "paid", customer: { name: "Ann", phone: "0900" }, items: [line("TR30", 20, 100, "p1")] }),
  order({ orderNumber: "E2", date: "2026-07-29T00:00:00.000Z", status: "new", customer: { name: "Bo", phone: "0901" }, items: [line("TR30", 17, 100, "p1"), line("RT20", 22, 100, "p2")] }),
  order({ orderNumber: "E3", date: "2026-07-29T00:00:00.000Z", status: "cancelled", customer: { name: "Cy", phone: "0902" }, items: [line("TR30", 500, 100, "p1")] }),
];

check("the workbook carries a Products-to-Order sheet excluding cancelled orders", () => {
  const p = prepareReport(july, exportOrders);
  const tr30 = p.productsToOrder.find((x) => x.product === "TR30")!;
  assert.equal(tr30.vials, 37, "20 + 17, cancelled 500 excluded");
  const rt20 = p.productsToOrder.find((x) => x.product === "RT20")!;
  assert.equal(rt20.vials, 22);
});

check("workbook totals equal the on-screen summary (no drift)", () => {
  const p = prepareReport(july, exportOrders);
  const s = summarizeRoundOrders(exportOrders);
  const get = (label: string) => p.totals.find((t) => t.label === label)?.value;
  assert.equal(get("Total Orders"), s.totalOrders);
  assert.equal(get("Total Active Orders"), s.activeOrders);
  assert.equal(get("Total Confirmed Orders"), s.confirmedOrders);
  assert.equal(get("Total Pending Orders"), s.pendingOrders);
  assert.equal(get("Total Cancelled Orders"), s.cancelledOrders);
  assert.equal(get("Total Vials Ordered"), s.totalVials);
  assert.equal(get("Total Sales"), s.totalSales);
});

check("the workbook's Orders sheet carries the full customer detail incl cancelled", () => {
  const p = prepareReport(july, exportOrders);
  assert.equal(p.orderLines.length, 4, "E1(1) + E2(2) + E3(1)");
  const e3 = p.orderLines.find((l) => l.orderNumber === "E3")!;
  assert.equal(e3.counted, false);
  assert.equal(e3.paymentStatus, "Cancelled");
  assert.equal(e3.contact, "0902", "contact number is exported");
  assert.equal(e3.batch, "july 28", "batch number is exported");
  assert.ok(e3.orderDate, "order date is exported");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
