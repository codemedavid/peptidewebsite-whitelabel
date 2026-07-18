// Browser-side serializer for the supplier workbook. exceljs is LAZY-imported
// (await import) so the ~1MB library only loads when the store owner clicks
// "Excel" in the report modal — it never enters the storefront bundle. The data
// shaping lives in the pure lib/storefront/group-buy-report.ts (unit-tested);
// this file only turns that structured prep into an .xlsx Blob and downloads it.

import type { ReportPrep } from "@/lib/storefront/group-buy-report";

export async function downloadSupplierWorkbook(prep: ReportPrep): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();

  // Totals — label/value pairs; the note row explains demand vs committed.
  const totals = wb.addWorksheet("Totals");
  totals.columns = [
    { header: "", width: 22 },
    { header: "", width: 70 },
  ];
  for (const t of prep.totals) totals.addRow([t.label, t.value]);

  // Product Summary — the sheet the supplier order is built from.
  const summary = wb.addWorksheet("Product Summary");
  summary.addRow(["Product", "Total Qty Needed (demand)", "Committed Qty", "Orders"]);
  summary.getRow(1).font = { bold: true };
  for (const s of prep.summary) summary.addRow([s.product, s.demandQty, s.committedQty, s.orders]);

  // Orders — one row per line, every order incl cancelled, with a Counted flag.
  const orders = wb.addWorksheet("Orders");
  orders.addRow(["Order", "Customer", "Product", "Qty", "Price", "Status", "Payment", "Counted"]);
  orders.getRow(1).font = { bold: true };
  for (const l of prep.orderLines) {
    orders.addRow([l.orderNumber, l.customer, l.product, l.qty, l.price, l.status, l.paymentStatus, l.counted ? "Yes" : "No"]);
  }

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
