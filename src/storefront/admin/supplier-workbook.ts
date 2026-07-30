// Browser-side serializer for the supplier workbook. exceljs is LAZY-imported
// (await import) so the ~1MB library only loads when the store owner clicks
// "Excel" in the report modal — it never enters the storefront bundle. The data
// shaping lives in the pure lib/storefront/group-buy-report.ts (unit-tested);
// this file only turns that structured prep into an .xlsx Blob and downloads it.

import type { Workbook } from "exceljs";

import type { ReportPrep } from "@/lib/storefront/group-buy-report";

/**
 * Build the workbook WITHOUT touching the DOM. Split out from the download so a
 * test can serialize it and read the real cells back — while the two lived in
 * one browser-only function, nothing could verify what actually lands in the
 * .xlsx the owner sends the supplier. See scripts/test-gb-e2e.ts.
 *
 * The `import type` above is erased at compile time, so exceljs stays lazy and
 * out of the storefront bundle.
 */
export async function buildSupplierWorkbook(prep: ReportPrep): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();

  // Totals — label/value pairs; the note row explains demand vs committed.
  const totals = wb.addWorksheet("Totals");
  totals.columns = [
    { header: "", width: 22 },
    { header: "", width: 70 },
  ];
  for (const t of prep.totals) totals.addRow([t.label, t.value]);

  // Products to Order — THE sheet the supplier order is placed from: how many
  // vials of each product to buy. Cancelled orders are excluded completely, so
  // these numbers can be sent to the supplier as-is.
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

  // Summary block, on the same sheet the supplier order is read from, so the
  // owner sees the money and the order mix without hunting through tabs.
  toOrder.addRow([]);
  toOrder.addRow(["SUMMARY"]).font = { bold: true };
  toOrder.addRow(["Gross Income", prep.counts.totalSales]);
  toOrder.addRow(["Total Confirmed Orders", prep.counts.confirmedOrders]);
  toOrder.addRow(["Total Pending Orders", prep.counts.pendingOrders]);
  toOrder.addRow(["Total Cancelled Orders", prep.counts.cancelledOrders]);
  toOrder.addRow([
    "Note",
    "Vials to order and Gross Income exclude cancelled orders entirely.",
  ]);

  // Product Summary — demand vs the committed (paid/fulfilled) subset.
  const summary = wb.addWorksheet("Product Summary");
  summary.addRow(["Product", "Total Qty Needed (demand)", "Committed Qty", "Orders"]);
  summary.getRow(1).font = { bold: true };
  for (const s of prep.summary) summary.addRow([s.product, s.demandQty, s.committedQty, s.orders]);

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
    ]);
    row.getCell(2).numFmt = "yyyy-mm-dd";
    // The proof stays a clickable link — the owner opens it, never re-downloads it.
    if (l.proofUrl) row.getCell(14).value = { text: l.proofUrl, hyperlink: l.proofUrl };
    // Cancelled lines are present for the audit trail but must never be mistaken
    // for something to order, so they are struck out.
    if (!l.counted) row.font = { strike: true, color: { argb: "FF999999" } };
  }

  return wb;
}

/** Serialize the workbook and hand it to the browser as a download. */
export async function downloadSupplierWorkbook(prep: ReportPrep): Promise<void> {
  const wb = await buildSupplierWorkbook(prep);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = prep.filename;
  a.click();
  URL.revokeObjectURL(url);
}
