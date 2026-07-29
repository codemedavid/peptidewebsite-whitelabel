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
import {
  buildProductsToOrder,
  buildRoundOrderRows,
  summarizeRoundOrders,
  type LinkableOrder,
  type ProductToOrder,
  type ReportRoundWindow,
  type RoundOrderRow,
  type RoundSummary,
} from "./group-buy-orders";

/** The round header the workbook labels itself with. */
export type ReportRound = ReportRoundWindow;

export type ReportCustomer = { name?: string; email?: string; phone?: string };
export type ReportItem = { name: string; qty: number; price: number; productId?: string };
/** Orders reach the workbook in the same shape the report page renders, so the
 *  export and the screen can never disagree about a customer, status or total. */
export type ReportInputOrder = LinkableOrder;

export type ReportTotal = { label: string; value: string | number };
export type ReportSummaryRow = {
  product: string;
  productId: string | null;
  demandQty: number;
  committedQty: number;
  orders: number;
};
/** One row per order LINE on the Orders sheet — the same shape the report page's
 *  order table renders, so the export can never show different values. */
export type ReportOrderLine = RoundOrderRow;

export type ReportPrep = {
  filename: string;
  totals: ReportTotal[];
  /** Headline counts, shared with the on-screen summary tiles. */
  counts: RoundSummary;
  /** "Products to Order" — vials to buy per product, cancelled orders excluded. */
  productsToOrder: ProductToOrder[];
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

/**
 * @param report Optional pre-built supplier report for these same orders. The
 *   server action already builds one for its on-screen response; passing it in
 *   avoids a second buildSupplierReport pass and guarantees the workbook can't
 *   drift from the numbers the UI showed. Omit it and it's aggregated here.
 */
export function prepareReport(
  round: ReportRound,
  orders: ReportInputOrder[],
  report: SupplierReport = buildSupplierReport("", orders),
): ReportPrep {
  const demand = orders.filter((o) => orderCountsAsDemand(o.status));
  const committed = demand.filter(isCommitted);

  // Product Summary rides on the audited supplier-report aggregation, then folds
  // in per-product order counts (how many demand orders included the product).
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
  // Built by the SAME helper the report page renders, so a column can never mean
  // one thing on screen and another in the download.
  const orderLines: ReportOrderLine[] = buildRoundOrderRows(round, orders);

  // "Products to Order" — the sheet the supplier order is placed from. Cancelled
  // orders are excluded completely (ordering against them means over-buying).
  const productsToOrder = buildProductsToOrder(orders);

  // Headline counts, from the same summarizer the on-screen tiles use.
  const counts = summarizeRoundOrders(orders);

  const uniqueCustomers = new Set(demand.map((o) => customerKey(o.customer)));

  const totals: ReportTotal[] = [
    { label: "Group Buy", value: round.name },
    { label: "Status", value: round.status },
    { label: "Opens", value: round.startsAt ?? "—" },
    { label: "Closes", value: round.endsAt ?? "—" },
    { label: "—", value: "—" },
    // The owner-facing summary — identical labels and values to the report page.
    { label: "Total Orders", value: counts.totalOrders },
    { label: "Total Active Orders", value: counts.activeOrders },
    { label: "Total Confirmed Orders", value: counts.confirmedOrders },
    { label: "Total Pending Orders", value: counts.pendingOrders },
    { label: "Total Cancelled Orders", value: counts.cancelledOrders },
    { label: "Total Vials Ordered", value: counts.totalVials },
    { label: "Total Sales", value: counts.totalSales },
    { label: "Total Customers", value: uniqueCustomers.size },
    { label: "—", value: "—" },
    // COMMITTED (paid/fulfilled) reported ALONGSIDE, never instead of the above.
    { label: "Committed Orders", value: committed.length },
    { label: "Committed Items", value: report.committedTotalQty },
    { label: "Committed Revenue", value: report.committedTotalRevenue },
    { label: "—", value: "—" },
    {
      label: "Note",
      value:
        "Cancelled orders are listed on the Orders sheet but excluded from Total Vials Ordered, Total Sales and Products to Order. Active = Confirmed (paid) + Pending (unpaid) — size the supplier order against Products to Order.",
    },
  ];

  return {
    filename: `GB-${slug(round.name)}-report.xlsx`,
    totals,
    counts,
    productsToOrder,
    summary,
    orderLines,
  };
}
