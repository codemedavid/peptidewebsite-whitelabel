import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import {
  fmtDate,
  memberProductLabel,
  type ProductToOrder,
  type ReportCustomerLine,
  type ReportPrep,
  type RoundOrderRow,
  type RoundSummary,
} from "./model";
import { buildXlsx, utf8, type Sheet } from "./xlsx";

/**
 * The round report exports, sheet-for-sheet with the website
 * (src/storefront/admin/supplier-workbook.ts + AdminGroupBuys downloadCsv).
 * The data shaping is the SERVER's prepareReport — these only lay it out — and
 * the file goes to the phone's share sheet (Mail, Files, WhatsApp…) instead of
 * a browser download.
 */

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The supplier's copy: vials to order and nothing else — safe to forward as-is. */
export function supplierSheets(prep: ReportPrep): Sheet[] {
  // Kit columns only when some product carries a vials-per-kit (gb-moq-kits); a
  // store that doesn't order by the kit keeps the three-column sheet. `!= null`
  // also covers an older server that never sends the kit fields.
  const byKit = prep.productsToOrder.some((p) => p.vialsPerKit != null);
  const kitCells = (p: ProductToOrder) =>
    byKit
      ? [p.vialsPerKit ?? "—", p.kits ?? "—", p.shortBy == null ? "—" : p.shortBy === 0 ? "Full" : `${p.shortBy} vials short`]
      : [];
  return [
    {
      name: "Products to Order",
      widths: [42, 20, 10, ...(byKit ? [14, 14, 18] : [])],
      rows: [
        {
          cells: ["Product", "Total Vials to Order", "Orders", ...(byKit ? ["Vials per Kit", "Kits to Order", "Short of a Full Kit"] : [])],
          style: "bold",
        },
        ...prep.productsToOrder.map((p) => ({ cells: [p.product, p.vials, p.orders, ...kitCells(p)] })),
        { cells: [] },
        { cells: ["TOTAL VIALS TO ORDER", prep.counts.totalVials, prep.counts.activeOrders], style: "bold" },
        { cells: [] },
        { cells: ["Note", "Vials to order exclude cancelled orders entirely."] },
      ],
    },
    {
      name: "Product Summary",
      widths: [42, 24, 15, 10],
      rows: [
        { cells: ["Product", "Total Qty Needed (demand)", "Committed Qty", "Orders"], style: "bold" },
        ...prep.summary.map((s) => ({ cells: [s.product, s.demandQty, s.committedQty, s.orders] })),
      ],
    },
  ];
}

/** The simple Orders sheet: order no. + buyer (and their WhatsApp) on each
 *  order's first line, one row per item with its vials, a blank row before the
 *  next order. */
function orderBlocks(lines: ReportPrep["orderLines"]): Sheet["rows"] {
  const byOrder = new Map<string, ReportPrep["orderLines"]>();
  for (const l of lines) byOrder.set(l.orderNumber, [...(byOrder.get(l.orderNumber) ?? []), l]);
  return [
    { cells: ["Order", "Customer", "WhatsApp Name", "WhatsApp Number", "Product", "Vials"], style: "bold" },
    ...[...byOrder].flatMap(([orderNumber, items]) => [
      ...items.map((l, i) => ({
        cells:
          i === 0
            ? [orderNumber, l.customer, l.whatsappName ?? "", l.whatsapp ?? "", l.product, l.vials]
            : ["", "", "", "", l.product, l.vials],
        style: l.counted ? undefined : ("strike" as const),
      })),
      { cells: [] },
    ]),
  ];
}

/** The owner's copy: totals, every buyer and every order line. Never for the supplier. */
export function customerSheets(prep: ReportPrep): Sheet[] {
  return [
    { name: "Orders", widths: [12, 26, 20, 18, 40, 8], rows: orderBlocks(prep.orderLines) },
    { name: "Summary", widths: [22, 70], rows: prep.totals.map((t) => ({ cells: [t.label, t.value] })) },
    {
      name: "Customers",
      widths: [26, 28, 16, 16, 20, 9, 8, 12, 46],
      rows: [
        {
          cells: ["Customer", "Email", "Contact Number", "WhatsApp", "WhatsApp Name", "Orders", "Vials", "Total", "Shipping Address"],
          style: "bold",
        },
        ...prep.customerLines.map((c) => ({
          cells: [c.name, c.email, c.contact, c.whatsapp ?? "", c.whatsappName ?? "", c.orders, c.qty, c.total, c.address],
        })),
        { cells: [] },
        { cells: ["TOTAL", "", "", "", "", prep.counts.activeOrders, prep.counts.totalVials, prep.counts.totalSales], style: "bold" },
      ],
    },
    {
      name: "Orders per Customer",
      widths: [24, 16, 16, 20, 26, 38, 7, 12, 22, 11, 12, 12, 12, 46],
      rows: memberOrderRows(prep.memberOrders ?? []),
    },
    {
      name: "Order Details",
      widths: [12, 12, 24, 16, 16, 20, 46, 18, 36, 8, 10, 16, 15, 13, 9, 46, 46],
      rows: [
        {
          cells: [
            "Order",
            "Order Date",
            "Customer",
            "Contact Number",
            "WhatsApp",
            "WhatsApp Name",
            "Shipping Address",
            "Batch",
            "Product",
            "Vials",
            "Price",
            "Payment Method",
            "Payment Status",
            "Order Status",
            "Counted",
            "Proof of Payment",
            "Customer Note",
          ],
          style: "bold",
        },
        ...prep.orderLines.map((l) => ({
          cells: [
            l.orderNumber,
            isoDay(l.orderDate),
            l.customer,
            l.contact,
            l.whatsapp ?? "",
            l.whatsappName ?? "",
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
          ],
          // Cancelled lines stay for the audit trail but are struck out.
          style: l.counted ? undefined : ("strike" as const),
        })),
      ],
    },
  ];
}

/** "Orders per Customer": each member's products (one row each), then a bold
 *  total row with what they paid and still owe, then a blank row; a grand
 *  total closes the sheet. Same rows as the dashboard panel. */
function memberOrderRows(members: NonNullable<ReportPrep["memberOrders"]>): Sheet["rows"] {
  const header = [
    "Customer",
    "Contact Number",
    "WhatsApp",
    "WhatsApp Name",
    "Email",
    "Product",
    "Qty",
    "Amount",
    "Checkouts",
    "Admin Fee",
    "Order Total",
    "Paid",
    "Balance",
    "Shipping Address",
  ];
  const grand = members.reduce(
    (t, m) => ({ total: t.total + m.total, paid: t.paid + m.paid, balance: t.balance + m.balance, fee: t.fee + m.adminFee }),
    { total: 0, paid: 0, balance: 0, fee: 0 },
  );
  return [
    { cells: header, style: "bold" },
    ...members.flatMap((m): Sheet["rows"] => [
      ...m.products.map((p, i) => ({
        cells:
          i === 0
            ? [m.name, m.contact, m.whatsapp, m.whatsappName, m.email, memberProductLabel(p), p.qty, p.amount]
            : ["", "", "", "", "", memberProductLabel(p), p.qty, p.amount],
      })),
      {
        cells: [
          `${m.name} (total)`,
          "",
          "",
          "",
          "",
          "",
          m.products.reduce((s, p) => s + p.qty, 0),
          "",
          m.checkouts.map((c) => `${c.orderNumber}${c.paid ? " (paid)" : ""}`).join(", "),
          m.adminFee,
          m.total,
          m.paid,
          m.balance,
          m.address,
        ],
        style: "bold",
      },
      { cells: [] },
    ]),
    { cells: ["ALL CUSTOMERS", "", "", "", "", "", "", "", "", grand.fee, grand.total, grand.paid, grand.balance], style: "bold" },
  ];
}

function isoDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The website's CSV: what to order, the headline counts, then every order line. */
export function reportCsv(args: {
  productsToOrder: ProductToOrder[];
  counts: RoundSummary;
  orderRows: RoundOrderRow[];
  customers: ReportCustomerLine[] | null;
}): string {
  const { productsToOrder, counts, orderRows, customers } = args;
  const rows: (string | number)[][] = [
    ["Product", "Total Vials to Order", "Orders"],
    ...productsToOrder.map((l) => [l.product, l.vials, l.orders]),
    ["TOTAL", counts.totalVials, counts.activeOrders],
    [],
    ["Total Orders", counts.totalOrders],
    ["Total Active Orders", counts.activeOrders],
    ["Total Confirmed Orders", counts.confirmedOrders],
    ["Total Pending Orders", counts.pendingOrders],
    ["Total Cancelled Orders", counts.cancelledOrders],
    ["Total Vials Ordered", counts.totalVials],
    ["Total Sales", counts.totalSales],
    [],
    [
      "Order",
      "Order Date",
      "Customer",
      "Contact Number",
      "WhatsApp Name",
      "WhatsApp Number",
      "Shipping Address",
      "Batch",
      "Product",
      "Vials",
      "Price",
      "Payment Method",
      "Payment Status",
      "Order Status",
      "Counted",
      "Proof of Payment",
    ],
    ...orderRows.map((l) => [
      l.orderNumber,
      fmtDate(l.orderDate),
      l.customer,
      l.contact,
      l.whatsappName ?? "",
      l.whatsapp ?? "",
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
    ]),
  ];
  if (customers && customers.length) {
    rows.push([], ["Customer", "Orders", "Quantity"], ...customers.map((c) => [c.email ? `${c.name} <${c.email}>` : c.name, c.orders, c.qty]));
  }
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  return rows.map((r) => r.map(cell).join(",")).join("\n");
}

/** Write `bytes` to the cache and open the share sheet. Throws a readable Error. */
export async function shareFile(filename: string, bytes: Uint8Array, mimeType: string, uti: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
  const safe = filename.replace(/[^\w.-]+/g, "-") || "report";
  const file = new File(Paths.cache, safe);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  await Sharing.shareAsync(file.uri, { mimeType, UTI: uti, dialogTitle: safe });
}

export const shareSupplierWorkbook = (prep: ReportPrep) =>
  shareFile(prep.supplierFilename, buildXlsx(supplierSheets(prep)), XLSX_MIME, "org.openxmlformats.spreadsheetml.sheet");

export const shareCustomerWorkbook = (prep: ReportPrep) =>
  shareFile(prep.customerFilename, buildXlsx(customerSheets(prep)), XLSX_MIME, "org.openxmlformats.spreadsheetml.sheet");

/** The member tracker's CSV (GbMemberTracker downloadCsv). */
export const shareTrackerCsv = (filename: string, csv: string) =>
  shareFile(filename, utf8(csv), "text/csv", "public.comma-separated-values-text");

export const shareCsv = (roundName: string, csv: string) =>
  shareFile(
    `group-buy-${roundName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-report.csv`,
    utf8(csv),
    "text/csv",
    "public.comma-separated-values-text",
  );
