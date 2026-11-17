import { requireOptionalNativeModule } from "expo";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { fmtDate, type ProductToOrder, type ReportCustomerLine, type RoundOrderRow, type RoundSummary } from "./model";

/**
 * The round report PDF (caps.reports.pdf). The website opens the same HTML in a
 * print window and lets the browser "Save as PDF" (AdminGroupBuys reportHtml /
 * downloadPdf); the phone renders it with expo-print and hands the file to the
 * share sheet. expo-print is a NATIVE module: a build made before it was added
 * doesn't have it, so it's loaded lazily and a missing module is a readable
 * error instead of a crash.
 */

export type ReportPdfInput = {
  roundName: string;
  currency: string;
  counts: RoundSummary;
  productsToOrder: ProductToOrder[];
  orderRows: RoundOrderRow[];
  customers: ReportCustomerLine[] | null;
};

const esc = (v: string | number): string =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const NUM = ' style="text-align:right"';

/** COPIED from src/storefront/admin/AdminGroupBuys.tsx reportHtml (same tables, same order). */
export function reportHtml({ roundName, currency, counts, productsToOrder, orderRows, customers }: ReportPdfInput): string {
  const money = (n: number) => `${currency}${(Number(n) || 0).toLocaleString()}`;
  const supplierRows = productsToOrder
    .map((l) => `<tr><td>${esc(l.product)}</td><td${NUM}>${l.vials}</td><td${NUM}>${l.orders}</td></tr>`)
    .join("");
  const orderTable = orderRows
    .map(
      (l) =>
        `<tr${l.counted ? "" : ' style="opacity:.55;text-decoration:line-through"'}><td>${esc(l.orderNumber)}</td><td>${esc(
          fmtDate(l.orderDate),
        )}</td><td>${esc(l.customer)}</td><td>${esc(l.contact)}</td><td>${esc(l.address)}</td><td>${esc(l.batch)}</td><td>${esc(
          l.product,
        )}</td><td${NUM}>${l.vials}</td><td>${esc(l.paymentMethod)}</td><td>${esc(l.paymentStatus)}</td><td>${esc(l.orderStatus)}</td></tr>`,
    )
    .join("");
  const customerTable =
    customers && customers.length
      ? `<h3>Per customer</h3>
      <table>
        <thead><tr><th>Customer</th><th>Email</th><th${NUM}>Orders</th><th${NUM}>Qty</th><th${NUM}>Total</th></tr></thead>
        <tbody>${customers
          .map(
            (c) =>
              `<tr><td>${esc(c.name)}</td><td>${esc(c.email)}</td><td${NUM}>${c.orders}</td><td${NUM}>${c.qty}</td><td${NUM}>${esc(
                money(c.total),
              )}</td></tr>`,
          )
          .join("")}</tbody>
      </table>`
      : "";
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${esc(roundName)}</title><style>
    body{font:12px/1.5 -apple-system,system-ui,sans-serif;padding:24px;color:#111}
    h1{font-size:20px;margin:0 0 4px} h3{margin:24px 0 8px}
    table{border-collapse:collapse;width:100%} td,th{border:1px solid #ccc;padding:5px 8px;text-align:left;vertical-align:top}
    tr{page-break-inside:avoid}
  </style></head><body>
    <h1>Group Buy Report: ${esc(roundName)}</h1>
    <p>${counts.totalOrders} order(s) · ${counts.activeOrders} active · ${counts.confirmedOrders} confirmed · ${counts.pendingOrders} pending · ${
      counts.cancelledOrders
    } cancelled<br/>
       ${counts.totalVials} vials · ${esc(money(counts.totalSales))} in sales <em>(cancelled orders excluded)</em></p>
    <h3>Products to order</h3>
    <table>
      <thead><tr><th>Product</th><th${NUM}>Vials to order</th><th${NUM}>Orders</th></tr></thead>
      <tbody>${supplierRows}
        <tr style="font-weight:bold;border-top:2px solid #000"><td>TOTAL</td><td${NUM}>${counts.totalVials}</td><td></td></tr>
      </tbody>
    </table>
    <h3>Orders</h3>
    <table>
      <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Contact</th><th>Address</th><th>Batch</th><th>Product</th><th${NUM}>Vials</th><th>Payment</th><th>Pay status</th><th>Order status</th></tr></thead>
      <tbody>${orderTable}</tbody>
    </table>
    ${customerTable}
  </body></html>`;
}

/** True when this build carries expo-print (added after 1.0.x — older builds lack it). */
export const canMakePdf = (): boolean => requireOptionalNativeModule("ExpoPrint") !== null;

/** Render the report to a PDF and open the share sheet. Throws a readable Error. */
export async function shareReportPdf(input: ReportPdfInput): Promise<void> {
  if (!canMakePdf()) throw new Error("PDF export needs the latest version of the app. Update it from the App Store or Play Store.");
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
  const Print = await import("expo-print");
  // Landscape A4 (in points): the Orders table is 11 columns wide.
  const { uri } = await Print.printToFileAsync({ html: reportHtml(input), width: 842, height: 595 });
  const name = `group-buy-${input.roundName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-report.pdf`;
  const target = new File(Paths.cache, name);
  if (target.exists) target.delete();
  await new File(uri).move(target);
  await Sharing.shareAsync(target.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: name });
}
