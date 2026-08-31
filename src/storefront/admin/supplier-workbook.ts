// Browser-side serializers for the two end-of-round workbooks. exceljs is LAZY-
// imported (await import) so the ~1MB library only loads when the store owner
// clicks a download in the report modal — it never enters the storefront bundle.
// The data shaping lives in the pure lib/storefront/group-buy-report.ts
// (unit-tested); this file only turns that structured prep into .xlsx Blobs.
//
// TWO files, because they go to two audiences:
//   buildSupplierWorkbook — what to buy. Forwarded to an outside party, so it
//                           carries no customer detail and no revenue figure.
//   buildCustomerWorkbook — the owner's own record: who ordered, what they owe,
//                           where it ships, and the money.

import type { Workbook } from "exceljs";

import type { ReportPrep } from "@/lib/storefront/group-buy-report";

/** The `import type` above is erased at compile time, so exceljs stays lazy and
 *  out of the storefront bundle. */
async function newWorkbook(): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  return new ExcelJS.Workbook();
}

/**
 * The supplier's copy: how many vials of each product to order, and nothing
 * else. Split out from the customer workbook so the owner can forward this file
 * untouched — while the two lived in one workbook, sending the supplier the
 * order meant sending every buyer's address, payment proof and the store's
 * gross income along with it.
 *
 * Built WITHOUT touching the DOM so a test can serialize it and read the real
 * cells back. See scripts/test-gb-e2e.ts.
 */
export async function buildSupplierWorkbook(prep: ReportPrep): Promise<Workbook> {
  const wb = await newWorkbook();

  // Products to Order — THE sheet the supplier order is placed from. Cancelled
  // orders are excluded completely, so these numbers can be sent as-is.
  const toOrder = wb.addWorksheet("Products to Order");
  toOrder.columns = [
    { header: "Product", width: 42 },
    { header: "Total Vials to Order", width: 20 },
    { header: "Orders", width: 10 },
  ];
  toOrder.getRow(1).font = { bold: true };
  for (const p of prep.productsToOrder) toOrder.addRow([p.product, p.vials, p.orders]);
  toOrder.addRow([]);
  toOrder.addRow(["TOTAL VIALS TO ORDER", prep.counts.totalVials, prep.counts.activeOrders]).font = {
    bold: true,
  };
  toOrder.addRow([]);
  toOrder.addRow([
    "Note",
    "Vials to order exclude cancelled orders entirely.",
  ]);

  // Product Summary — demand vs the committed (paid/fulfilled) subset, so the
  // supplier can see how much of the order is already money in hand.
  const summary = wb.addWorksheet("Product Summary");
  summary.columns = [
    { header: "Product", width: 42 },
    { header: "Total Qty Needed (demand)", width: 24 },
    { header: "Committed Qty", width: 15 },
    { header: "Orders", width: 10 },
  ];
  summary.getRow(1).font = { bold: true };
  for (const s of prep.summary) summary.addRow([s.product, s.demandQty, s.committedQty, s.orders]);

  return wb;
}

/**
 * The owner's copy: the round's totals, every buyer, and every order line.
 * Never sent to the supplier — it holds contact numbers, shipping addresses and
 * links to payment proofs.
 */
export async function buildCustomerWorkbook(prep: ReportPrep): Promise<Workbook> {
  const wb = await newWorkbook();

  // Summary — label/value pairs; the note row explains demand vs committed.
  const totals = wb.addWorksheet("Summary");
  totals.columns = [
    { header: "", width: 22 },
    { header: "", width: 70 },
  ];
  for (const t of prep.totals) totals.addRow([t.label, t.value]);

  // Customers — one row per buyer. Repeat orders are already merged upstream.
  const customers = wb.addWorksheet("Customers");
  customers.columns = [
    { header: "Customer", width: 26 },
    { header: "Email", width: 28 },
    { header: "Contact Number", width: 16 },
    { header: "Orders", width: 9 },
    { header: "Vials", width: 8 },
    { header: "Total", width: 12 },
    { header: "Shipping Address", width: 46 },
  ];
  customers.getRow(1).font = { bold: true };
  for (const c of prep.customerLines) {
    customers.addRow([c.name, c.email, c.contact, c.orders, c.qty, c.total, c.address]);
  }
  customers.addRow([]);
  customers.addRow([
    "TOTAL",
    "",
    "",
    prep.counts.activeOrders,
    prep.counts.totalVials,
    prep.counts.totalSales,
  ]).font = { bold: true };

  // Orders — one row per line, every order incl cancelled, with a Counted flag
  // and the full customer detail the owner reconciles payments against.
  const orders = wb.addWorksheet("Orders");
  orders.columns = [
    { header: "Order", width: 12 },
    { header: "Order Date", width: 12 },
    { header: "Customer", width: 24 },
    { header: "Contact Number", width: 16 },
    { header: "Shipping Address", width: 46 },
    { header: "Batch", width: 18 },
    { header: "Product", width: 36 },
    { header: "Vials", width: 8 },
    { header: "Price", width: 10 },
    { header: "Payment Method", width: 16 },
    { header: "Payment Status", width: 15 },
    { header: "Order Status", width: 13 },
    { header: "Counted", width: 9 },
    { header: "Proof of Payment", width: 46 },
    // The buyer's own request. Owner's copy ONLY — the supplier workbook above
    // carries no PII, and a free-text note is exactly where an address or a
    // phone number ends up.
    { header: "Customer Note", width: 46 },
  ];
  orders.getRow(1).font = { bold: true };
  for (const l of prep.orderLines) {
    const placedAt = new Date(l.orderDate);
    const row = orders.addRow([
      l.orderNumber,
      Number.isNaN(placedAt.getTime()) ? l.orderDate : placedAt,
      l.customer,
      l.contact,
      l.address,
      l.batch,
      l.product,
      l.vials,
      l.price,
      l.paymentMethod,
      l.paymentStatus,
      l.orderStatus,
      l.counted ? "Yes" : "No",
      l.proofUrl ?? "",
      l.customerNote,
    ]);
    row.getCell(2).numFmt = "yyyy-mm-dd";
    // A packing instruction is only useful if it's readable in the cell.
    row.getCell(15).alignment = { wrapText: true, vertical: "top" };
    // The proof stays a clickable link — the owner opens it, never re-downloads it.
    if (l.proofUrl) row.getCell(14).value = { text: l.proofUrl, hyperlink: l.proofUrl };
    // Cancelled lines are present for the audit trail but must never be mistaken
    // for something to order, so they are struck out.
    if (!l.counted) row.font = { strike: true, color: { argb: "FF999999" } };
  }

  return wb;
}

/** Serialize a workbook and hand it to the browser as a download. */
async function download(wb: Workbook, filename: string): Promise<void> {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadSupplierWorkbook(prep: ReportPrep): Promise<void> {
  await download(await buildSupplierWorkbook(prep), prep.supplierFilename);
}

export async function downloadCustomerWorkbook(prep: ReportPrep): Promise<void> {
  await download(await buildCustomerWorkbook(prep), prep.customerFilename);
}
