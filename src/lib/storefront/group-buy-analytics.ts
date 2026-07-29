// Per-round Group Buy analytics — the numbers behind the management list and
// each round's dedicated dashboard. Pure, no I/O, so the screen, the Excel export
// and the tests all read from one definition.
//
// SCOPE IS THE WHOLE POINT. Every function here takes the orders ALREADY
// resolved for one round (group-buy-orders.resolveRoundOrders) and never reaches
// for anything tenant-wide. That is what makes these analytics per-round rather
// than global — pass a different slice, get a different answer, with no hidden
// state in between.
//
// THE CANCELLED RULE, in one place: a cancelled order is counted and displayed,
// but its money never reaches gross income or revenue and its vials never reach
// the supplier order. Over-ordering against orders that will never be paid is
// the expensive failure this guards against.

import {
  buildProductsToOrder,
  displayPaymentStatus,
  type LinkableOrder,
  type ProductToOrder,
  type ReportRoundWindow,
  type RoundOrderRow,
  type PaymentDisplayStatus,
} from "./group-buy-orders";

/** A round plus the owner's planning fields. Superset of ReportRoundWindow so a
 *  GroupBuy can be passed straight through. */
export type AnalyticsRound = ReportRoundWindow & {
  batchNumber?: string;
  minVials?: number | null;
  maxVials?: number | null;
  closedAt?: string | null;
  productIds?: string[];
};

// ── Status display ───────────────────────────────────────────────────────────

export type RoundDisplayStatus =
  | "Draft"
  | "Scheduled"
  | "Open"
  | "Completed"
  | "Cancelled"
  | "Archived";

const STATUS_LABELS: Record<string, RoundDisplayStatus> = {
  draft: "Draft",
  scheduled: "Scheduled",
  active: "Open",
  closed: "Completed",
  cancelled: "Cancelled",
  archived: "Archived",
};

/** The owner-facing label for a stored round status. "active" reads as Open and
 *  "closed" as Completed — the internal vocabulary is about the buying window,
 *  the label is about what the owner sees on the shelf. */
export function displayRoundStatus(status: string): RoundDisplayStatus {
  return STATUS_LABELS[status.toLowerCase()] ?? "Draft";
}

// ── Product name ─────────────────────────────────────────────────────────────

/**
 * The product a round is "for". A round assigns 0..N products, so there is no
 * single name to read: one product shows its name, several show a count, none
 * means the round covers the whole catalog. Naming a round after just its first
 * product would be actively misleading when it sells five.
 */
export function resolveRoundProductName(
  round: Pick<AnalyticsRound, "productIds">,
  productNames?: Map<string, string>,
): string {
  const ids = round.productIds ?? [];
  if (ids.length === 0) return "Whole catalog";
  if (ids.length === 1) {
    // A deleted product leaves a dangling id — show "1 product" rather than a
    // raw cuid the owner can't recognise.
    return productNames?.get(ids[0]) ?? "1 product";
  }
  return `${ids.length} products`;
}

// ── Participants ─────────────────────────────────────────────────────────────

/** Unique customer key: email || phone || name, lowercased. Same precedence the
 *  supplier report uses, so "participants" means the same thing everywhere. */
function customerKey(o: LinkableOrder): string {
  const c = o.customer ?? {};
  return (c.email || c.phone || c.name || "unknown").trim().toLowerCase();
}

/**
 * How many distinct people are actually in this round. Cancelled orders are
 * excluded — someone who cancelled is not a participant — and one customer with
 * three orders counts once.
 */
export function countParticipants(orders: LinkableOrder[]): number {
  const seen = new Set<string>();
  for (const o of orders) {
    if (displayPaymentStatus(o) === "Cancelled") continue;
    seen.add(customerKey(o));
  }
  return seen.size;
}

// ── Analytics ────────────────────────────────────────────────────────────────

export type RoundOverview = {
  name: string;
  productName: string;
  batchNumber: string;
  status: RoundDisplayStatus;
  createdAt: string;
  /** ISO — only set once the round actually closed/was cancelled. */
  closedAt: string | null;
  currentVials: number;
  maxVials: number | null;
  minVials: number | null;
  /** true/false against minVials; null when no minimum is configured. */
  minimumMet: boolean | null;
  participants: number;
  totalOrders: number;
};

export type RoundFinancials = {
  /** Value of every non-cancelled order. Cancelled money never appears here. */
  grossIncome: number;
  /** Non-cancelled AND paid — money in hand. */
  confirmedPayments: number;
  /** Non-cancelled AND not yet paid. */
  pendingPayments: number;
  cancelledOrders: number;
  /** Alias of confirmedPayments, named for the dashboard card. */
  revenueCollected: number;
  /**
   * Value of non-cancelled orders not yet marked paid.
   *
   * The system has no partial payments — StorefrontOrder.paymentStatus is only
   * pending|paid — so this CANNOT mean "part of an order still owed". Agreed
   * with the store owner; a true balance needs an order-level payment ledger.
   */
  outstandingBalance: number;
};

export type RoundProductStats = {
  /** Vials the supplier order is sized against — cancelled excluded. */
  totalVials: number;
  confirmedVials: number;
  pendingVials: number;
  /** Reported so the owner sees what fell away; never ordered. */
  cancelledVials: number;
  /** maxVials − totalVials, clamped at 0. null when no maximum is configured. */
  remainingVials: number | null;
  /** Percent of maxVials filled, NOT capped at 100 — an over-subscribed round
   *  must show 140%, because silently clamping hides an oversell. */
  completionPct: number | null;
  /** Per-product vials to order, cancelled excluded. */
  productsToOrder: ProductToOrder[];
};

export type RoundAnalytics = {
  overview: RoundOverview;
  financial: RoundFinancials;
  product: RoundProductStats;
};

/** Sum of qty and qty×price across an order's lines. */
function totals(o: LinkableOrder): { vials: number; value: number } {
  let vials = 0;
  let value = 0;
  for (const it of o.items ?? []) {
    vials += it.qty;
    value += it.qty * it.price;
  }
  return { vials, value };
}

/**
 * Every number for ONE round.
 *
 * @param round        the round being reported on
 * @param orders       the orders already resolved for this round — nothing global
 * @param productNames id → name, for the product column
 */
export function buildRoundAnalytics(
  round: AnalyticsRound,
  orders: LinkableOrder[],
  productNames?: Map<string, string>,
): RoundAnalytics {
  let grossIncome = 0;
  let confirmedPayments = 0;
  let pendingPayments = 0;
  let cancelledOrders = 0;
  let totalVials = 0;
  let confirmedVials = 0;
  let pendingVials = 0;
  let cancelledVials = 0;

  for (const o of orders) {
    const payment = displayPaymentStatus(o);
    const { vials, value } = totals(o);
    if (payment === "Cancelled") {
      cancelledOrders++;
      cancelledVials += vials; // shown, never ordered, never banked
      continue;
    }
    grossIncome += value;
    totalVials += vials;
    if (payment === "Confirmed") {
      confirmedPayments += value;
      confirmedVials += vials;
    } else {
      pendingPayments += value;
      pendingVials += vials;
    }
  }

  const maxVials = round.maxVials ?? null;
  const minVials = round.minVials ?? null;

  return {
    overview: {
      name: round.name,
      productName: resolveRoundProductName(round, productNames),
      batchNumber: round.batchNumber?.trim() || round.name,
      status: displayRoundStatus(round.status),
      createdAt: round.createdAt ?? "",
      closedAt: round.closedAt ?? null,
      currentVials: totalVials,
      maxVials,
      minVials,
      minimumMet: minVials === null ? null : totalVials >= minVials,
      participants: countParticipants(orders),
      totalOrders: orders.length,
    },
    financial: {
      grossIncome,
      confirmedPayments,
      pendingPayments,
      cancelledOrders,
      revenueCollected: confirmedPayments,
      outstandingBalance: pendingPayments,
    },
    product: {
      totalVials,
      confirmedVials,
      pendingVials,
      cancelledVials,
      remainingVials: maxVials === null ? null : Math.max(0, maxVials - totalVials),
      completionPct: maxVials === null ? null : Math.round((totalVials / maxVials) * 100),
      productsToOrder: buildProductsToOrder(orders),
    },
  };
}

// ── Management list row ──────────────────────────────────────────────────────

export type RoundListRow = {
  id: string;
  name: string;
  productName: string;
  batchNumber: string;
  status: RoundDisplayStatus;
  currentVials: number;
  maxVials: number | null;
  totalOrders: number;
  participants: number;
  grossIncome: number;
  createdAt: string;
};

/**
 * One row of the Group Buy Management list. Derived from the SAME
 * buildRoundAnalytics the dashboard renders, so a round can never show one
 * gross income in the list and a different one after you click it.
 */
export function buildRoundListRow(
  round: AnalyticsRound,
  orders: LinkableOrder[],
  productNames?: Map<string, string>,
): RoundListRow {
  const a = buildRoundAnalytics(round, orders, productNames);
  return {
    id: round.id,
    name: round.name,
    productName: a.overview.productName,
    batchNumber: a.overview.batchNumber,
    status: a.overview.status,
    currentVials: a.product.totalVials,
    maxVials: a.overview.maxVials,
    totalOrders: a.overview.totalOrders,
    participants: a.overview.participants,
    grossIncome: a.financial.grossIncome,
    createdAt: a.overview.createdAt,
  };
}

// ── Orders table filtering ───────────────────────────────────────────────────

export type OrderRowFilters = {
  paymentStatus?: PaymentDisplayStatus | "";
  orderStatus?: string;
  /** Inclusive date bounds, "YYYY-MM-DD" or any Date-parsable string. */
  from?: string;
  to?: string;
  /** Case-insensitive substring match on the customer name. */
  customer?: string;
};

/** Start-of-day / end-of-day for an inclusive date-only bound, so picking the
 *  same day for `from` and `to` matches orders placed at any time that day. */
function dayBound(value: string, edge: "start" | "end"): number | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return edge === "start" ? d.getTime() : d.getTime() + 24 * 60 * 60 * 1000 - 1;
  }
  return d.getTime();
}

/**
 * Narrow the round's order rows for the dashboard table. Every supplied filter
 * must hold (AND, not OR) — an owner narrowing by two things expects fewer rows,
 * not more. Blank/absent filters are ignored rather than matching nothing.
 */
export function filterOrderRows(rows: RoundOrderRow[], filters: OrderRowFilters): RoundOrderRow[] {
  const customer = filters.customer?.trim().toLowerCase() ?? "";
  const orderStatus = filters.orderStatus?.trim().toLowerCase() ?? "";
  const from = filters.from?.trim() ? dayBound(filters.from.trim(), "start") : null;
  const to = filters.to?.trim() ? dayBound(filters.to.trim(), "end") : null;

  return rows.filter((r) => {
    if (filters.paymentStatus && r.paymentStatus !== filters.paymentStatus) return false;
    if (orderStatus && r.orderStatus.toLowerCase() !== orderStatus) return false;
    if (customer && !r.customer.toLowerCase().includes(customer)) return false;
    if (from !== null || to !== null) {
      const t = new Date(r.orderDate).getTime();
      if (Number.isNaN(t)) return false;
      if (from !== null && t < from) return false;
      if (to !== null && t > to) return false;
    }
    return true;
  });
}
