/**
 * END-TO-END lifecycle test for one group buy round.
 *
 * Every other gb-* suite tests one module. This one walks the WHOLE chain a real
 * round travels, in order, with one fixture carried the whole way:
 *
 *   1. CREATE     owner saves a round        → normalizeGroupBuy → groupBuyToDbWrite
 *                                              → dbGroupBuyToStorefront (DB round-trip)
 *   2. OPEN       is it live on the storefront? → effectiveGroupBuyStatus / liveGroupBuys
 *                                                 / buildGroupBuyGate
 *   3. ORDER      customers check out          → groupBuyForOrder stamps groupBuyId
 *   4. ISOLATE    the round's detail page      → resolveRoundOrders
 *   5. ANALYSE    its dashboard numbers        → buildRoundAnalytics / summarizeRoundOrders
 *   6. CANCEL     one order is called off      → the cancelled rule, measured as a delta
 *   7. EXPORT     the owner clicks Excel       → prepareReport → buildSupplierWorkbook
 *                                                → REAL .xlsx bytes, read back cell by cell
 *
 * The scenario is deliberately the k-glow failure: one customer buys a product
 * the owner never assigned to the round, so checkout stamps groupBuyId = NULL.
 * That order must STILL appear on the round's page — that NULL is exactly what
 * made the live report read "0 orders · 0 units · ₱0".
 *
 * Vial totals are the user's own worked example: TR30 = 37, RT20 = 22, CGL5 = 15.
 *
 *   npm run test:gb-e2e
 */

import assert from "node:assert";

import {
  buildGroupBuyGate,
  dbGroupBuyToStorefront,
  effectiveGroupBuyStatus,
  groupBuyForOrder,
  groupBuyToDbWrite,
  isOnHandBlocked,
  liveGroupBuys,
  normalizeGroupBuy,
  type GroupBuy,
  type GroupBuyCapabilities,
  GROUP_BUY_CAPS_OFF,
} from "../src/lib/storefront/group-buy";
import {
  buildProductsToOrder,
  buildRoundOrderRows,
  displayPaymentStatus,
  resolveRoundOrders,
  summarizeRoundOrders,
  type LinkableOrder,
} from "../src/lib/storefront/group-buy-orders";
import {
  buildRoundAnalytics,
  buildRoundListRow,
  displayRoundStatus,
  filterOrderRows,
} from "../src/lib/storefront/group-buy-analytics";
import { prepareReport } from "../src/lib/storefront/group-buy-report";
import {
  buildCustomerWorkbook,
  buildSupplierWorkbook,
} from "../src/storefront/admin/supplier-workbook";

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ──────────────────────────── fixture ────────────────────────────────────────
// Anchored to the REAL clock with relative offsets. A hardcoded date silently
// expires and turns "the round is open" into "the round closed" once the
// calendar passes it — that exact time bomb already bit test-onhand-gate.
const NOW = new Date();
const DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

const P_TR30 = "p-tr30";
const P_RT20 = "p-rt20";
const P_CGL5 = "p-cgl5";
const PRODUCT_NAMES = new Map([
  [P_TR30, "TR30 Tirzepatide 30mg"],
  [P_RT20, "RT20 Retatrutide 20mg"],
  [P_CGL5, "CGL5 Cagrilintide 5mg"],
]);

const CAPS: GroupBuyCapabilities = {
  ...GROUP_BUY_CAPS_OFF,
  enabled: true,
  canCreate: true,
  canEdit: true,
  scheduled: true,
  productAssignment: true,
  supplierReports: true,
};

/** The round under test — open now, assigned to TR30 only. */
const ROUND_B: GroupBuy = normalizeGroupBuy({
  id: "gb-b",
  name: "TR30 Batch #2",
  description: "Second TR30 run",
  status: "active",
  startsAt: iso(-1 * DAY),
  endsAt: iso(+6 * DAY),
  deliveryEta: "3–4 weeks after close",
  productIds: [P_TR30],
  slotGoal: 30,
  batchNumber: "TR30-B2",
  minVials: 20,
  maxVials: 100,
  closedAt: null,
  createdAt: iso(-2 * DAY),
  updatedAt: iso(-2 * DAY),
});

/** A DIFFERENT round that already finished. Its orders must never leak into B. */
const ROUND_A: GroupBuy = normalizeGroupBuy({
  id: "gb-a",
  name: "TR30 Batch #1",
  status: "closed",
  startsAt: iso(-30 * DAY),
  endsAt: iso(-20 * DAY),
  productIds: [P_TR30],
  batchNumber: "TR30-B1",
  closedAt: iso(-20 * DAY),
  createdAt: iso(-31 * DAY),
  updatedAt: iso(-20 * DAY),
});

const ALL_ROUNDS = [ROUND_A, ROUND_B];

type Order = LinkableOrder & { orderNumber: string };

const ADDRESS = {
  address: "12 Mabini St",
  barangay: "Poblacion",
  city: "Davao City",
  province: "Davao del Sur",
  postal: "8000",
  country: "PH",
};

// Customer buying the ASSIGNED product → checkout stamps the round id.
const B1: Order = {
  orderNumber: "KG-2001",
  date: iso(-2 * 3_600_000),
  status: "confirmed",
  paymentStatus: "paid",
  paymentMethod: "GCash",
  paymentProof: "https://ik.imagekit.io/demo/proof-2001.jpg",
  groupBuyId: ROUND_B.id,
  groupBuyName: ROUND_B.name,
  customer: { name: "Erika Santos", email: "erika@example.com", phone: "09171234567" },
  shipping: ADDRESS,
  items: [{ name: "TR30 Tirzepatide 30mg", productId: P_TR30, qty: 20, price: 1200 }],
};

// THE k-glow CASE: buys products the owner never assigned to the round, so
// checkout stamps NULL. Must still land on this round's page.
const B2: Order = {
  orderNumber: "KG-2002",
  date: iso(-1 * 3_600_000),
  status: "pending",
  paymentStatus: "pending",
  paymentMethod: "Bank transfer",
  paymentProof: "https://ik.imagekit.io/demo/proof-2002.jpg",
  groupBuyId: null,
  groupBuyName: null,
  customer: { name: "Marco Reyes", email: "marco@example.com", phone: "09182223344" },
  shipping: ADDRESS,
  items: [
    { name: "RT20 Retatrutide 20mg", productId: P_RT20, qty: 22, price: 900 },
    { name: "CGL5 Cagrilintide 5mg", productId: P_CGL5, qty: 15, price: 500 },
  ],
};

// Paid and THEN cancelled — the nastiest case. Must read Cancelled, never
// Confirmed, and must not fund a single vial of the supplier order.
const B3: Order = {
  orderNumber: "KG-2003",
  date: iso(-30 * 60_000),
  status: "cancelled",
  paymentStatus: "paid",
  paymentMethod: "GCash",
  paymentProof: "https://ik.imagekit.io/demo/proof-2003.jpg",
  groupBuyId: ROUND_B.id,
  groupBuyName: ROUND_B.name,
  customer: { name: "Dana Cruz", email: "dana@example.com", phone: "09193334455" },
  shipping: ADDRESS,
  items: [{ name: "TR30 Tirzepatide 30mg", productId: P_TR30, qty: 17, price: 1200 }],
};

// Erika's SECOND order — same person, so participants must not double-count.
const B4: Order = {
  orderNumber: "KG-2004",
  date: iso(-10 * 60_000),
  status: "pending",
  paymentStatus: "pending",
  paymentMethod: "GCash",
  paymentProof: null,
  groupBuyId: ROUND_B.id,
  groupBuyName: ROUND_B.name,
  customer: { name: "Erika Santos", email: "erika@example.com", phone: "09171234567" },
  shipping: ADDRESS,
  items: [{ name: "TR30 Tirzepatide 30mg", productId: P_TR30, qty: 17, price: 1200 }],
};

// Belongs to the FINISHED round. Unattributed, inside A's window only.
const A1: Order = {
  orderNumber: "KG-1001",
  date: iso(-25 * DAY),
  status: "completed",
  paymentStatus: "paid",
  paymentMethod: "GCash",
  paymentProof: null,
  groupBuyId: null,
  customer: { name: "Luis Tan", email: "luis@example.com", phone: "09201112233" },
  shipping: ADDRESS,
  items: [{ name: "TR30 Tirzepatide 30mg", productId: P_TR30, qty: 5, price: 1200 }],
};

// Placed between the two rounds — inside NO window. Belongs to neither report.
const ORPHAN: Order = {
  orderNumber: "KG-0001",
  date: iso(-10 * DAY),
  status: "pending",
  paymentStatus: "pending",
  paymentMethod: "GCash",
  paymentProof: null,
  groupBuyId: null,
  customer: { name: "Nina Lim", email: "nina@example.com" },
  shipping: ADDRESS,
  items: [{ name: "TR30 Tirzepatide 30mg", productId: P_TR30, qty: 9, price: 1200 }],
};

/** Every order the tenant has — the report is NOT allowed to pre-filter this. */
const TENANT_ORDERS: Order[] = [A1, ORPHAN, B1, B2, B3, B4];

// Expected round-B truth, computed by hand from the fixture above:
//   vials  20 + (22 + 15) + 17            = 74   (B3's 17 excluded)
//   sales  24000 + 27300 + 20400          = 71700
const EXPECT = {
  totalOrders: 4,
  activeOrders: 3,
  confirmedOrders: 1,
  pendingOrders: 2,
  cancelledOrders: 1,
  totalVials: 74,
  totalSales: 71_700,
  confirmedValue: 24_000,
  pendingValue: 47_700,
  confirmedVials: 20,
  pendingVials: 54,
  cancelledVials: 17,
  participants: 2,
  tr30: 37,
  rt20: 22,
  cgl5: 15,
};

// ───────────────────────────── the walk ──────────────────────────────────────

async function main() {
  console.log("\nGroup Buy — end-to-end lifecycle\n");

  // ── 1. CREATE ──────────────────────────────────────────────────────────────
  console.log("1. Owner creates the round");

  await check("the saved round survives the DB round-trip intact", () => {
    const write = groupBuyToDbWrite(ROUND_B);
    const back = dbGroupBuyToStorefront({
      id: ROUND_B.id,
      name: write.name,
      description: write.description,
      status: write.status,
      startsAt: write.startsAt,
      endsAt: write.endsAt,
      deliveryEta: write.deliveryEta,
      productIds: write.productIds,
      slotGoal: write.slotGoal,
      batchNumber: write.batchNumber,
      minVials: write.minVials,
      maxVials: write.maxVials,
      closedAt: write.closedAt,
      createdAt: new Date(ROUND_B.createdAt),
      updatedAt: new Date(ROUND_B.updatedAt),
    });
    assert.equal(back.name, "TR30 Batch #2");
    assert.equal(back.batchNumber, "TR30-B2");
    assert.equal(back.minVials, 20);
    assert.equal(back.maxVials, 100);
    assert.deepEqual(back.productIds, [P_TR30]);
  });

  await check("an open round is NOT stamped with a closed date", () => {
    assert.equal(groupBuyToDbWrite(ROUND_B).closedAt, null);
  });

  // ── 2. OPEN ON THE STOREFRONT ──────────────────────────────────────────────
  console.log("2. The round is open on the storefront");

  await check("the round reads active, and the owner sees it as Open", () => {
    assert.equal(effectiveGroupBuyStatus(ROUND_B, CAPS.scheduled, NOW), "active");
    assert.equal(displayRoundStatus("active"), "Open");
  });

  await check("it is the ONE live round — the finished one is not live", () => {
    const live = liveGroupBuys(ALL_ROUNDS, CAPS, NOW);
    assert.equal(live.length, 1);
    assert.equal(live[0].id, ROUND_B.id);
  });

  await check("the finished round reads Completed and takes no new orders", () => {
    assert.equal(effectiveGroupBuyStatus(ROUND_A, CAPS.scheduled, NOW), "closed");
    assert.equal(displayRoundStatus("closed"), "Completed");
    assert.equal(groupBuyForOrder([ROUND_A], CAPS, [P_TR30], NOW), null);
  });

  await check("a CANCELLED round never re-opens, even inside a live window", () => {
    const calledOff: GroupBuy = { ...ROUND_B, id: "gb-x", status: "cancelled" };
    assert.equal(effectiveGroupBuyStatus(calledOff, CAPS.scheduled, NOW), "cancelled");
    assert.equal(liveGroupBuys([calledOff], CAPS, NOW).length, 0);
    assert.equal(groupBuyForOrder([calledOff], CAPS, [P_TR30], NOW), null);
  });

  await check("the storefront gate shows the round live over its assigned product", () => {
    const gate = buildGroupBuyGate(ALL_ROUNDS, CAPS, true, NOW);
    assert.equal(gate.active, true);
    assert.equal(gate.coversAll, false);
    assert.deepEqual(gate.productIds, [P_TR30]);
  });

  await check("customers can add the group-buy product to the cart", () => {
    const gate = buildGroupBuyGate(ALL_ROUNDS, CAPS, false, NOW);
    assert.equal(isOnHandBlocked(P_TR30, gate), false);
  });

  await check("with on-hand sales paused, only non-round products are blocked", () => {
    const gate = buildGroupBuyGate(ALL_ROUNDS, CAPS, false, NOW);
    assert.equal(isOnHandBlocked(P_RT20, gate), true);
  });

  // ── 3. CUSTOMERS ORDER ─────────────────────────────────────────────────────
  console.log("3. Customers order into the open round");

  await check("checkout stamps the live round onto an assigned-product order", () => {
    const gb = groupBuyForOrder(ALL_ROUNDS, CAPS, [P_TR30], NOW);
    assert.equal(gb?.id, ROUND_B.id);
  });

  await check("checkout stamps NULL when the cart misses the assignment (the k-glow bug)", () => {
    const gb = groupBuyForOrder(ALL_ROUNDS, CAPS, [P_RT20, P_CGL5], NOW);
    assert.equal(gb, null, "this NULL is what made the live report read 0 orders");
  });

  // ── 4. THE ROUND'S OWN PAGE — ISOLATION ────────────────────────────────────
  console.log("4. Orders land on THIS round's page and nowhere else");

  const resolvedB = resolveRoundOrders(ROUND_B, TENANT_ORDERS, ALL_ROUNDS);
  const resolvedA = resolveRoundOrders(ROUND_A, TENANT_ORDERS, ALL_ROUNDS);
  const numbersB = resolvedB.orders.map((o) => o.orderNumber);
  const numbersA = resolvedA.orders.map((o) => o.orderNumber);

  await check("the open round shows exactly its own four orders", () => {
    assert.deepEqual(numbersB.slice().sort(), ["KG-2001", "KG-2002", "KG-2003", "KG-2004"]);
  });

  await check("the unattributed order still appears (the whole point of the fix)", () => {
    assert.ok(numbersB.includes("KG-2002"), "groupBuyId was NULL — it must not vanish");
  });

  await check("the finished round's order never leaks in", () => {
    assert.ok(!numbersB.includes("KG-1001"));
    assert.deepEqual(numbersA, ["KG-1001"]);
  });

  await check("an order placed under no round is not invented into one", () => {
    assert.ok(!numbersB.includes("KG-0001"));
    assert.ok(!numbersA.includes("KG-0001"));
  });

  await check("the orphan is surfaced as unlinked, not silently dropped", () => {
    assert.equal(resolvedB.unlinked, 1);
  });

  await check("no order is ever counted by two rounds", () => {
    const overlap = numbersB.filter((n) => numbersA.includes(n));
    assert.deepEqual(overlap, []);
  });

  await check("every tenant order is accounted for exactly once", () => {
    const claimed = numbersA.length + numbersB.length + resolvedB.unlinked;
    assert.equal(claimed, TENANT_ORDERS.length);
  });

  // ── 5. THE DASHBOARD NUMBERS ───────────────────────────────────────────────
  console.log("5. The round's analytics are correct");

  const analytics = buildRoundAnalytics(ROUND_B, resolvedB.orders, PRODUCT_NAMES);
  const summary = summarizeRoundOrders(resolvedB.orders);
  const rows = buildRoundOrderRows(ROUND_B, resolvedB.orders);

  await check("overview: batch, status, participants, orders", () => {
    assert.equal(analytics.overview.batchNumber, "TR30-B2");
    assert.equal(analytics.overview.status, "Open");
    assert.equal(analytics.overview.productName, "TR30 Tirzepatide 30mg");
    assert.equal(analytics.overview.totalOrders, EXPECT.totalOrders);
    assert.equal(analytics.overview.participants, EXPECT.participants);
  });

  await check("a repeat customer counts as one participant", () => {
    // Erika placed KG-2001 and KG-2004; Dana cancelled. Erika + Marco = 2.
    assert.equal(analytics.overview.participants, 2);
  });

  await check("progress reads 74 of 100 with the minimum met", () => {
    assert.equal(analytics.overview.currentVials, EXPECT.totalVials);
    assert.equal(analytics.overview.maxVials, 100);
    assert.equal(analytics.overview.minimumMet, true);
    assert.equal(analytics.product.remainingVials, 26);
    assert.equal(analytics.product.completionPct, 74);
  });

  await check("financials: gross, confirmed, pending, collected, outstanding", () => {
    assert.equal(analytics.financial.grossIncome, EXPECT.totalSales);
    assert.equal(analytics.financial.confirmedPayments, EXPECT.confirmedValue);
    assert.equal(analytics.financial.pendingPayments, EXPECT.pendingValue);
    assert.equal(analytics.financial.revenueCollected, EXPECT.confirmedValue);
    assert.equal(analytics.financial.outstandingBalance, EXPECT.pendingValue);
    assert.equal(analytics.financial.cancelledOrders, EXPECT.cancelledOrders);
  });

  await check("INVARIANT gross income === confirmed + pending", () => {
    const f = analytics.financial;
    assert.equal(f.grossIncome, f.confirmedPayments + f.pendingPayments);
  });

  await check("INVARIANT total vials === confirmed + pending", () => {
    const p = analytics.product;
    assert.equal(p.totalVials, p.confirmedVials + p.pendingVials);
  });

  await check("vials split: 20 confirmed, 54 pending, 17 cancelled", () => {
    assert.equal(analytics.product.confirmedVials, EXPECT.confirmedVials);
    assert.equal(analytics.product.pendingVials, EXPECT.pendingVials);
    assert.equal(analytics.product.cancelledVials, EXPECT.cancelledVials);
  });

  await check("products to order match the worked example: 37 / 22 / 15", () => {
    const byName = new Map(analytics.product.productsToOrder.map((p) => [p.product, p.vials]));
    assert.equal(byName.get("TR30 Tirzepatide 30mg"), EXPECT.tr30);
    assert.equal(byName.get("RT20 Retatrutide 20mg"), EXPECT.rt20);
    assert.equal(byName.get("CGL5 Cagrilintide 5mg"), EXPECT.cgl5);
  });

  await check("products to order sum to the headline vial count", () => {
    const sum = analytics.product.productsToOrder.reduce((s, p) => s + p.vials, 0);
    assert.equal(sum, EXPECT.totalVials);
  });

  await check("the management list row agrees with the page you click into", () => {
    const row = buildRoundListRow(ROUND_B, resolvedB.orders, PRODUCT_NAMES);
    assert.equal(row.grossIncome, analytics.financial.grossIncome);
    assert.equal(row.currentVials, analytics.product.totalVials);
    assert.equal(row.totalOrders, analytics.overview.totalOrders);
    assert.equal(row.participants, analytics.overview.participants);
    assert.equal(row.status, analytics.overview.status);
  });

  await check("every order row carries the full customer detail", () => {
    const r = rows.find((x) => x.orderNumber === "KG-2001");
    assert.equal(r?.customer, "Erika Santos");
    assert.equal(r?.contact, "09171234567");
    assert.equal(r?.address, "12 Mabini St, Poblacion, Davao City, Davao del Sur, 8000, PH");
    assert.equal(r?.batch, "TR30 Batch #2");
    assert.equal(r?.paymentMethod, "GCash");
    assert.equal(r?.proofUrl, "https://ik.imagekit.io/demo/proof-2001.jpg");
  });

  await check("a multi-product order produces one row per product", () => {
    assert.equal(rows.filter((r) => r.orderNumber === "KG-2002").length, 2);
  });

  await check("the orders table filters narrow within the round only", () => {
    assert.equal(filterOrderRows(rows, { paymentStatus: "Cancelled" }).length, 1);
    assert.equal(filterOrderRows(rows, { customer: "erika" }).length, 2);
    assert.equal(
      filterOrderRows(rows, { paymentStatus: "Confirmed", customer: "erika" }).length,
      1,
    );
    assert.equal(filterOrderRows(rows, { customer: "luis" }).length, 0);
  });

  // ── 6. THE CANCELLED RULE ──────────────────────────────────────────────────
  console.log("6. A cancelled order is shown but never counted");

  await check("paid-then-cancelled reads Cancelled, never Confirmed", () => {
    assert.equal(displayPaymentStatus(B3), "Cancelled");
  });

  await check("the cancelled order is still listed, flagged not counted", () => {
    const r = rows.find((x) => x.orderNumber === "KG-2003");
    assert.ok(r, "cancelled orders must stay visible for the audit trail");
    assert.equal(r?.counted, false);
    assert.equal(r?.paymentStatus, "Cancelled");
  });

  await check("it is counted in total orders but not in active orders", () => {
    assert.equal(summary.totalOrders, EXPECT.totalOrders);
    assert.equal(summary.activeOrders, EXPECT.activeOrders);
    assert.equal(summary.cancelledOrders, 1);
  });

  await check("its vials never reach the supplier order", () => {
    const tr30 = analytics.product.productsToOrder.find((p) => p.productId === P_TR30);
    // 20 (B1) + 17 (B4) = 37. B3's 17 would have made it 54.
    assert.equal(tr30?.vials, 37, "cancelled vials would over-order by 17");
  });

  await check("DELTA: un-cancelling adds back exactly its money and vials", () => {
    const revived = resolvedB.orders.map((o) =>
      o.orderNumber === "KG-2003" ? { ...o, status: "confirmed" } : o,
    );
    const after = buildRoundAnalytics(ROUND_B, revived, PRODUCT_NAMES);
    assert.equal(after.financial.grossIncome - analytics.financial.grossIncome, 20_400);
    assert.equal(after.product.totalVials - analytics.product.totalVials, 17);
    const tr30 = after.product.productsToOrder.find((p) => p.productId === P_TR30);
    assert.equal(tr30?.vials, 54);
  });

  await check("DELTA: cancelling drops the participant who cancelled", () => {
    const revived = resolvedB.orders.map((o) =>
      o.orderNumber === "KG-2003" ? { ...o, status: "confirmed" } : o,
    );
    assert.equal(buildRoundAnalytics(ROUND_B, revived).overview.participants, 3);
    assert.equal(analytics.overview.participants, 2);
  });

  // ── 7. THE EXCEL EXPORT ────────────────────────────────────────────────────
  console.log("7. The exported Excel file matches the screen");

  const prep = prepareReport(ROUND_B, resolvedB.orders);

  // TWO workbooks now: the supplier gets product quantities only, the owner
  // keeps the customer detail. Both are serialized and read back from REAL bytes.
  const ExcelJS = (await import("exceljs")).default;
  const reload = async (wb: Awaited<ReturnType<typeof buildSupplierWorkbook>>) => {
    const bytes = await wb.xlsx.writeBuffer();
    const fresh = new ExcelJS.Workbook();
    await fresh.xlsx.load(bytes as ArrayBuffer);
    return fresh;
  };
  const reloaded = await reload(await buildSupplierWorkbook(prep));
  const customerBook = await reload(await buildCustomerWorkbook(prep));

  /** Find a row on a sheet by its first-column label, in a given workbook. */
  const labelledIn = (book: typeof reloaded, sheetName: string, label: string): unknown[] => {
    const ws = book.getWorksheet(sheetName);
    assert.ok(ws, `missing sheet: ${sheetName}`);
    let found: unknown[] | null = null;
    ws.eachRow((row) => {
      const first = row.getCell(1).value;
      if (typeof first === "string" && first.trim() === label) {
        found = (row.values as unknown[]).slice(1);
      }
    });
    assert.ok(found, `no row labelled "${label}" on ${sheetName}`);
    return found;
  };
  const labelled = (sheetName: string, label: string) => labelledIn(reloaded, sheetName, label);
  const custLabelled = (sheetName: string, label: string) =>
    labelledIn(customerBook, sheetName, label);

  await check("both files are named after this round, and apart from each other", () => {
    assert.equal(prep.supplierFilename, "GB-tr30-batch-2-supplier.xlsx");
    assert.equal(prep.customerFilename, "GB-tr30-batch-2-customers.xlsx");
  });

  await check("the SUPPLIER workbook opens and holds only product sheets", () => {
    const names = reloaded.worksheets.map((w) => w.name);
    assert.deepEqual(names, ["Products to Order", "Product Summary"]);
  });

  await check("the CUSTOMER workbook opens with summary, customers and orders", () => {
    const names = customerBook.worksheets.map((w) => w.name);
    assert.deepEqual(names, ["Summary", "Customers", "Orders"]);
  });

  await check("PRIVACY: the supplier file leaks no customer name, phone or address", () => {
    const leaked: string[] = [];
    for (const ws of reloaded.worksheets) {
      ws.eachRow((row) => {
        for (const cell of row.values as unknown[]) {
          if (typeof cell !== "string") continue;
          if (/Erika|Santos|0917|Mabini|imagekit/i.test(cell)) leaked.push(cell);
        }
      });
    }
    assert.deepEqual(leaked, [], `supplier file exposed: ${leaked.join(" | ")}`);
  });

  await check("PRIVACY: the supplier file carries no revenue figure", () => {
    const sheet = reloaded.getWorksheet("Products to Order");
    assert.ok(sheet);
    let money = false;
    sheet.eachRow((row) => {
      const first = row.getCell(1).value;
      if (typeof first === "string" && /income|sales|revenue/i.test(first)) money = true;
    });
    assert.equal(money, false, "what the store earns is not the supplier's business");
  });

  await check("Summary sheet: vials and sales match the dashboard", () => {
    assert.equal(custLabelled("Summary", "Total Vials Ordered")[1], EXPECT.totalVials);
    assert.equal(custLabelled("Summary", "Total Sales")[1], EXPECT.totalSales);
    assert.equal(custLabelled("Summary", "Total Orders")[1], EXPECT.totalOrders);
    assert.equal(custLabelled("Summary", "Total Cancelled Orders")[1], EXPECT.cancelledOrders);
  });

  await check("Customers sheet: one row per buyer — Erika's TWO orders merge", () => {
    const erika = custLabelled("Customers", "Erika Santos");
    assert.equal(erika[1], "erika@example.com", "email");
    assert.equal(erika[2], "09171234567", "contact");
    assert.equal(erika[3], 2, "KG-2001 + KG-2004 roll into one row");
    assert.equal(erika[4], 20 + 17, "vials across both orders");
    assert.equal(erika[5], (20 + 17) * 1200, "spend across both orders");
    assert.ok(String(erika[6]).includes("Mabini"), "shipping address");
  });

  await check("Customers sheet: the cancelled buyer is not owed anything", () => {
    const ws = customerBook.getWorksheet("Customers");
    assert.ok(ws);
    const names: string[] = [];
    ws.eachRow((row, i) => {
      if (i === 1) return;
      const v = row.getCell(1).value;
      if (typeof v === "string" && v && v !== "TOTAL") names.push(v);
    });
    assert.deepEqual(names, ["Erika Santos", "Marco Reyes"], "biggest spender first, Dana excluded");
  });

  await check("Customers sheet: the TOTAL row reconciles with the dashboard", () => {
    assert.equal(custLabelled("Customers", "TOTAL")[4], EXPECT.totalVials);
    assert.equal(custLabelled("Customers", "TOTAL")[5], EXPECT.totalSales);
  });

  await check("Products to Order sheet: 37 / 22 / 15 in the actual cells", () => {
    assert.equal(labelled("Products to Order", "TR30 Tirzepatide 30mg")[1], EXPECT.tr30);
    assert.equal(labelled("Products to Order", "RT20 Retatrutide 20mg")[1], EXPECT.rt20);
    assert.equal(labelled("Products to Order", "CGL5 Cagrilintide 5mg")[1], EXPECT.cgl5);
  });

  await check("Products to Order sheet: the TOTAL row is the supplier order", () => {
    assert.equal(labelled("Products to Order", "TOTAL VIALS TO ORDER")[1], EXPECT.totalVials);
  });

  await check("the owner's summary carries gross income and the order mix", () => {
    assert.equal(custLabelled("Summary", "Total Sales")[1], EXPECT.totalSales);
    assert.equal(custLabelled("Summary", "Total Confirmed Orders")[1], EXPECT.confirmedOrders);
    assert.equal(custLabelled("Summary", "Total Pending Orders")[1], EXPECT.pendingOrders);
    assert.equal(custLabelled("Summary", "Total Cancelled Orders")[1], EXPECT.cancelledOrders);
  });

  await check("Orders sheet: one row per order line, cancelled included", () => {
    const ws = customerBook.getWorksheet("Orders");
    assert.ok(ws);
    assert.equal(ws.rowCount - 1, rows.length, "header + one row per line");
    assert.equal(rows.length, 5);
  });

  await check("Orders sheet: full customer detail lands in the right columns", () => {
    const line = custLabelled("Orders", "KG-2001");
    assert.equal(line[2], "Erika Santos"); // Customer
    assert.equal(line[3], "09171234567"); // Contact Number
    assert.equal(line[4], "12 Mabini St, Poblacion, Davao City, Davao del Sur, 8000, PH");
    assert.equal(line[5], "TR30 Batch #2"); // Batch
    assert.equal(line[7], 20); // Vials
    assert.equal(line[9], "GCash"); // Payment Method
    assert.equal(line[10], "Confirmed"); // Payment Status
    assert.equal(line[12], "Yes"); // Counted
  });

  await check("Orders sheet: the cancelled line is present and marked not counted", () => {
    const line = custLabelled("Orders", "KG-2003");
    assert.equal(line[10], "Cancelled");
    assert.equal(line[12], "No");
  });

  await check("Orders sheet: the proof is a clickable link, not a download", () => {
    const line = custLabelled("Orders", "KG-2002");
    const proof = line[13] as { hyperlink?: string } | string | null;
    assert.ok(
      typeof proof === "object" && proof !== null && "hyperlink" in proof,
      "proof cell must be a hyperlink",
    );
    assert.equal(
      (proof as { hyperlink: string }).hyperlink,
      "https://ik.imagekit.io/demo/proof-2002.jpg",
    );
  });

  await check("the export contains NO order from another round", () => {
    const ws = customerBook.getWorksheet("Orders");
    assert.ok(ws);
    const numbers: string[] = [];
    ws.eachRow((row, i) => {
      if (i === 1) return;
      numbers.push(String(row.getCell(1).value));
    });
    assert.ok(!numbers.includes("KG-1001"), "the finished round's order leaked into the export");
    assert.ok(!numbers.includes("KG-0001"), "an unlinked order leaked into the export");
    assert.equal(new Set(numbers).size, 4);
  });

  await check("EXPORT PARITY: the workbook totals equal the on-screen totals", () => {
    assert.equal(prep.counts.totalVials, summary.totalVials);
    assert.equal(prep.counts.totalSales, summary.totalSales);
    assert.equal(prep.counts.cancelledOrders, summary.cancelledOrders);
    assert.equal(prep.counts.totalSales, analytics.financial.grossIncome);
    assert.deepEqual(
      prep.productsToOrder.map((p) => [p.product, p.vials]),
      analytics.product.productsToOrder.map((p) => [p.product, p.vials]),
    );
    assert.deepEqual(prep.orderLines, rows);
  });

  await check("EXPORT PARITY: the file agrees with buildProductsToOrder directly", () => {
    const direct = buildProductsToOrder(resolvedB.orders);
    const total = direct.reduce((s, p) => s + p.vials, 0);
    assert.equal(labelled("Products to Order", "TOTAL VIALS TO ORDER")[1], total);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
