// Pure prep for the 3-sheet supplier workbook (spec §6). NO exceljs import — the
// download handler lazy-loads the serializer and feeds it this structured data,
// so the heavy library never enters the storefront bundle and the data shaping
// (where the demand-vs-committed rule is easy to break) stays unit-testable.
//
//   Totals          — round metadata + demand headline + committed alongside.
//   Product Summary — one row per product||variation, demand desc. The sheet the
//                     supplier order is built from.
//   Orders          — one row per order LINE, EVERY order incl cancelled, with a
//                     Counted (Yes/No) column showing which fed demand.

import {
  buildSupplierReport,
  orderCountsAsDemand,
  type SupplierReport,
} from "./group-buy";

export type ReportRound = {
  name: string;
  status: string;
  startsAt?: string | null;
  endsAt?: string | null;
};

export type ReportCustomer = { name?: string; email?: string; phone?: string };
export type ReportItem = { name: string; qty: number; price: number; productId?: string };
export type ReportInputOrder = {
  orderNumber?: string;
  status: string;
  paymentStatus?: string;
  customer?: ReportCustomer;
  items: ReportItem[];
};

export type ReportTotal = { label: string; value: string | number };
export type ReportSummaryRow = {
  product: string;
  productId: string | null;
  demandQty: number;
  committedQty: number;
  orders: number;
};
export type ReportOrderLine = {
  orderNumber: string;
  customer: string;
  product: string;
  productId: string | null;
  qty: number;
  price: number;
  status: string;
  paymentStatus: string;
  counted: boolean;
};

export type ReportPrep = {
  filename: string;
  totals: ReportTotal[];
  summary: ReportSummaryRow[];
  orderLines: ReportOrderLine[];
};

/** URL/file-safe slug of a round name: lowercase, non-alphanumerics → single
 *  dashes, trimmed. Empty falls back to "round" so the filename is always valid. */
export function slug(value: string): string {
  const s = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "round";
}

const COMMITTED_STATUSES = new Set(["confirmed", "processing", "shipped", "delivered", "completed"]);
function isCommitted(o: ReportInputOrder): boolean {
  return o.paymentStatus?.toLowerCase() === "paid" || COMMITTED_STATUSES.has(o.status.toLowerCase());
}

/** Unique-customer key (spec §6): email || phone || name, lowercased. */
function customerKey(c: ReportCustomer | undefined): string {
  const raw = c?.email || c?.phone || c?.name || "unknown";
  return raw.toLowerCase();
}

export function prepareReport(round: ReportRound, orders: ReportInputOrder[]): ReportPrep {
  const demand = orders.filter((o) => orderCountsAsDemand(o.status));
  const committed = demand.filter(isCommitted);

  // Product Summary rides on the audited supplier-report aggregation, then folds
  // in per-product order counts (how many demand orders included the product).
  const report: SupplierReport = buildSupplierReport("", orders);
  const orderCountByKey = new Map<string, number>();
  for (const o of demand) {
    const seen = new Set<string>();
    for (const it of o.items) {
      const key = it.productId ?? `name:${it.name}`;
      if (seen.has(key)) continue; // count each product once per order
      seen.add(key);
      orderCountByKey.set(key, (orderCountByKey.get(key) ?? 0) + 1);
    }
  }
  const summary: ReportSummaryRow[] = report.lines.map((l) => ({
    product: l.name,
    productId: l.productId,
    demandQty: l.qty,
    committedQty: l.committedQty,
    orders: orderCountByKey.get(l.productId ?? `name:${l.name}`) ?? 0,
  }));

  // Orders sheet — every order, every line, cancelled included, Counted flag.
  const orderLines: ReportOrderLine[] = [];
  for (const o of orders) {
    const counted = orderCountsAsDemand(o.status);
    const who = o.customer?.name || o.customer?.email || "—";
    for (const it of o.items) {
      orderLines.push({
        orderNumber: o.orderNumber ?? "—",
        customer: who,
        product: it.name,
        productId: it.productId ?? null,
        qty: it.qty,
        price: it.price,
        status: o.status,
        paymentStatus: o.paymentStatus ?? "",
        counted,
      });
    }
  }

  const uniqueCustomers = new Set(demand.map((o) => customerKey(o.customer)));

  const totals: ReportTotal[] = [
    { label: "Group Buy", value: round.name },
    { label: "Status", value: round.status },
    { label: "Opens", value: round.startsAt ?? "—" },
    { label: "Closes", value: round.endsAt ?? "—" },
    { label: "—", value: "—" },
    // DEMAND is the headline — the supplier order is sized against these.
    { label: "Placed Orders", value: demand.length },
    { label: "Cancelled Orders", value: orders.length - demand.length },
    { label: "Total Customers", value: uniqueCustomers.size },
    { label: "Total Items", value: report.totalQty },
    { label: "Total Revenue", value: report.totalRevenue },
    { label: "—", value: "—" },
    // COMMITTED reported ALONGSIDE, never instead of demand.
    { label: "Committed Orders", value: committed.length },
    { label: "Committed Items", value: report.committedTotalQty },
    { label: "Committed Revenue", value: report.committedTotalRevenue },
    { label: "—", value: "—" },
    {
      label: "Note",
      value:
        "Placed/Total = DEMAND (every order except cancelled/refunded, paid or not) — size the supplier order against these. Committed = the paid/fulfilled subset, shown for reference.",
    },
  ];

  return { filename: `GB-${slug(round.name)}-report.xlsx`, totals, summary, orderLines };
}
