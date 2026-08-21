// Pure prep for the TWO end-of-round workbooks (spec §6). NO exceljs import —
// the download handler lazy-loads the serializer and feeds it this structured
// data, so the heavy library never enters the storefront bundle and the data
// shaping (where the demand-vs-committed rule is easy to break) stays
// unit-testable.
//
// One prep, two files, because they go to two different audiences:
//
//   SUPPLIER  (GB-<round>-supplier.xlsx) — what to buy, and nothing else.
//     Products to Order — vials per product, cancelled orders excluded.
//     Product Summary   — demand vs the committed (paid/fulfilled) subset.
//     Carries no customer name, contact, address, proof or revenue: this file
//     is forwarded to an outside party, so PII and margin must not be in it.
//
//   CUSTOMER  (GB-<round>-customers.xlsx) — the owner's own record.
//     Summary   — round metadata, the headline counts, committed alongside.
//     Customers — one row per buyer: orders, vials, spend, contact, address.
//     Orders    — one row per order LINE, EVERY order incl cancelled, with a
//                 Counted (Yes/No) column showing which fed demand.

import {
  buildSupplierReport,
  effectiveGroupBuyStatus,
  orderCountsAsDemand,
  type GroupBuy,
  type SupplierReport,
} from "./group-buy";
import {
  buildProductsToOrder,
  buildRoundOrderRows,
  formatShippingAddress,
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

/** One row per buyer on the customer report. `total` is items only — fees and
 *  shipping are excluded, exactly like the supplier lines, so the customer sheet
 *  and the product sheets add up to the same money. */
export type ReportCustomerLine = {
  name: string;
  email: string;
  /** Phone if given, else email, else "—" — whatever the owner would call. */
  contact: string;
  address: string;
  orders: number;
  qty: number;
  total: number;
};

export type ReportPrep = {
  /** Product quantities only — safe to forward to the supplier as-is. */
  supplierFilename: string;
  /** Customer detail — the owner's copy, never sent outside the store. */
  customerFilename: string;
  totals: ReportTotal[];
  /** Headline counts, shared with the on-screen summary tiles. */
  counts: RoundSummary;
  /** "Products to Order" — vials to buy per product, cancelled orders excluded. */
  productsToOrder: ProductToOrder[];
  summary: ReportSummaryRow[];
  orderLines: ReportOrderLine[];
  /** Per-buyer rollup for the customer workbook's Customers sheet. */
  customerLines: ReportCustomerLine[];
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
 * One row per BUYER, from the same orders the rest of the report is built from.
 *
 * Two orders from the same person merge into one row — the owner asks "who
 * ordered, and what do I owe them", not "how many checkouts happened". Identity
 * is email || phone || name, lowercased, so the same buyer checking out twice
 * with a differently-cased email is still one customer.
 *
 * Cancelled orders never appear: a cancelled buyer is not owed anything, and
 * including them would make the customer sheet disagree with Products to Order.
 * Sorted biggest-spender first.
 */
export function buildCustomerLines(orders: ReportInputOrder[]): ReportCustomerLine[] {
  const byKey = new Map<string, ReportCustomerLine>();
  for (const o of orders) {
    if (!orderCountsAsDemand(o.status)) continue;
    const c = o.customer ?? {};
    const key = customerKey(c);
    const row = byKey.get(key) ?? {
      name: c.name?.trim() || c.email?.trim() || "Unknown",
      email: c.email?.trim() || "",
      contact: c.phone?.trim() || c.email?.trim() || "—",
      address: formatShippingAddress(o.shipping),
      orders: 0,
      qty: 0,
      total: 0,
    };
    row.orders += 1;
    for (const it of o.items ?? []) {
      row.qty += it.qty;
      row.total += it.qty * it.price;
    }
    // A later order may carry the address an earlier one lacked — take the first
    // real one rather than letting "—" from order #1 win for the whole customer.
    if (row.address === "—") row.address = formatShippingAddress(o.shipping);
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
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

  const stem = `GB-${slug(round.name)}`;
  return {
    supplierFilename: `${stem}-supplier.xlsx`,
    customerFilename: `${stem}-customers.xlsx`,
    totals,
    counts,
    productsToOrder,
    summary,
    orderLines,
    customerLines: buildCustomerLines(orders),
  };
}

// ── "Every finished round has a report" ──────────────────────────────────────

/** The minimum a round must expose to be judged finished. */
export type ReportableRound = Pick<GroupBuy, "status" | "startsAt" | "endsAt">;

/**
 * The rounds that have finished and whose report the owner has not filed away.
 *
 * There is no cron: a round's window lapses silently and its status only flips
 * to "closed" the next time someone reads it. So "finished" is DERIVED here the
 * same way the storefront derives it — via effectiveGroupBuyStatus — rather
 * than trusted from the stored status.
 *
 * This drives a persistent badge on the rounds list, not a one-time popup. The
 * previous behaviour popped the report open once and deduped in localStorage,
 * which meant a manager on a second device, a staff account, or anyone who
 * cleared their browser never saw it at all. A badge that stays until the round
 * is archived cannot be missed that way, and needs no stored state.
 *
 * Archived rounds are excluded — archiving IS the owner saying they are done
 * with it. Cancelled rounds are excluded too: a called-off round has nothing to
 * order and nobody to bill.
 */
export function roundsAwaitingReport<T extends ReportableRound>(
  rounds: T[],
  scheduledEnabled: boolean,
  now: Date = new Date(),
): T[] {
  return rounds.filter((gb) => {
    if (gb.status === "archived" || gb.status === "cancelled") return false;
    return effectiveGroupBuyStatus(gb, scheduledEnabled, now) === "closed";
  });
}
