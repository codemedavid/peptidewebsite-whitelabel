// Which orders belong to a group buy round, and the owner-facing rollups built
// from them. Pure — no I/O — so the report page, the Excel export and the tests
// all agree on one definition.
//
// WHY THIS EXISTS (k-glow, 2026-07-29)
// The report used to resolve a round's orders by attribution alone:
//   where: { groupBuyId: roundId }
// StorefrontOrder.groupBuyId is stamped ONCE at checkout by groupBuyForOrder(),
// which only matches when an ordered productId appears in the round's
// `productIds` assignment. When the owner's assignment drifts from what people
// actually buy — k-glow's live round listed 5 products nobody ordered — every
// order is stamped NULL. Nothing backfills the column, so those orders were
// invisible to the report forever: "0 orders · 0 units · ₱0".
//
// Attribution is therefore a HINT, not the source of truth. A round's orders are
// resolved as: everything explicitly stamped with this round, PLUS anything
// unattributed that was placed inside the round's window. Orders stamped for a
// DIFFERENT round are never swept in, so no order is ever counted twice.
//
// Anything unattributed that falls inside no round's window at all is counted as
// `unlinked` and surfaced in the UI — silently dropping it is how the original
// bug hid for so long.

import { orderCountsAsDemand, productLineKey } from "./group-buy";

/** The round fields the linking rule needs — a slice of GroupBuy, so callers can
 *  pass a GroupBuy straight through. */
export type ReportRoundWindow = {
  id: string;
  name: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  createdAt?: string;
};

export type ReportOrderItem = {
  name: string;
  qty: number;
  price: number;
  productId?: string;
  variation?: string;
};

export type ReportShipping = {
  address?: string;
  barangay?: string;
  city?: string;
  province?: string;
  postal?: string;
  country?: string;
};

/** An order as the report consumes it — the DB row and the demo fixture both
 *  narrow to this. `date` is the storefront-facing placedAt, ISO-8601. */
export type LinkableOrder = {
  orderNumber?: string;
  date: string;
  status: string;
  paymentStatus?: string;
  paymentMethod?: string;
  paymentProof?: string | null;
  groupBuyId?: string | null;
  groupBuyName?: string | null;
  customer?: { name?: string; email?: string; phone?: string };
  shipping?: ReportShipping;
  items: ReportOrderItem[];
  /** The buyer's checkout note. Reaches the owner's own customer workbook only
   *  — never the supplier copy, which carries no PII (see supplier-workbook). */
  customerNote?: string;
};

export type PaymentDisplayStatus = "Pending" | "Confirmed" | "Cancelled";

// ── Linking ──────────────────────────────────────────────────────────────────

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** True when `placedAt` falls inside the round's window. Bounds are INCLUSIVE
 *  (an order placed on the closing second belongs to the round that closed).
 *  A round with neither bound has no window and claims nothing — otherwise an
 *  undated draft would swallow the tenant's entire order history. */
function inWindow(round: ReportRoundWindow, placedAt: number): boolean {
  const from = time(round.startsAt);
  const to = time(round.endsAt);
  if (from === null && to === null) return false;
  if (from !== null && placedAt < from) return false;
  if (to !== null && placedAt > to) return false;
  return true;
}

/**
 * The round that owns an unattributed order: the one whose window contains it.
 * Windows shouldn't overlap (one active round per tenant is an invariant), but
 * drafts and archived rounds can — so ties break on earliest `createdAt`, then
 * on id. Deterministic, and guarantees an order lands in exactly ONE round's
 * report rather than inflating two.
 */
function windowOwner(rounds: ReportRoundWindow[], placedAt: number): ReportRoundWindow | null {
  const matches = rounds.filter((r) => inWindow(r, placedAt));
  if (matches.length === 0) return null;
  return matches
    .slice()
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id))[0];
}

export type ResolvedRoundOrders = {
  /** The orders this round's report covers. */
  orders: LinkableOrder[];
  /** Unattributed orders that fall inside NO round's window. Not part of any
   *  report — surfaced so the owner can see that they exist. */
  unlinked: number;
};

/**
 * Resolve the orders belonging to `round`.
 *
 * @param round     the round being reported on
 * @param orders    every order for the tenant (NOT pre-filtered by groupBuyId —
 *                  filtering on that column is the bug this replaces)
 * @param allRounds every round for the tenant, so an unattributed order can be
 *                  assigned to exactly one owning window
 */
export function resolveRoundOrders(
  round: ReportRoundWindow,
  orders: LinkableOrder[],
  allRounds: ReportRoundWindow[],
): ResolvedRoundOrders {
  const linked: LinkableOrder[] = [];
  let unlinked = 0;

  for (const o of orders) {
    // 1. Explicit attribution always wins — even for an order placed outside the
    //    window (the owner may have re-dated the round after the fact).
    if (o.groupBuyId) {
      if (o.groupBuyId === round.id) linked.push(o);
      continue; // stamped for another round — never ours, and never "unlinked"
    }

    // 2. Unattributed: fall back to the window.
    const placedAt = time(o.date);
    if (placedAt === null) {
      unlinked++;
      continue;
    }
    const owner = windowOwner(allRounds, placedAt);
    if (!owner) unlinked++;
    else if (owner.id === round.id) linked.push(o);
  }

  return { orders: linked, unlinked };
}

// ── Status display ───────────────────────────────────────────────────────────

/**
 * The owner-facing payment status: Pending / Confirmed / Cancelled.
 * Cancellation OUTRANKS payment — a paid order that was later cancelled reads
 * "Cancelled", never "Confirmed", so a refunded buyer is never mistaken for a
 * committed one.
 */
export function displayPaymentStatus(
  o: Pick<LinkableOrder, "status" | "paymentStatus">,
): PaymentDisplayStatus {
  if (!orderCountsAsDemand(o.status)) return "Cancelled";
  return o.paymentStatus?.toLowerCase() === "paid" ? "Confirmed" : "Pending";
}

/** Join the filled-in parts of a shipping blob into one line. Empty parts are
 *  dropped rather than rendered as stray commas; an empty blob reads "—". */
export function formatShippingAddress(shipping: ReportShipping | undefined): string {
  const parts = [
    shipping?.address,
    shipping?.barangay,
    shipping?.city,
    shipping?.province,
    shipping?.postal,
    shipping?.country,
  ]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
}

// ── Summary ──────────────────────────────────────────────────────────────────

export type RoundSummary = {
  totalOrders: number;
  activeOrders: number;
  confirmedOrders: number;
  pendingOrders: number;
  cancelledOrders: number;
  totalVials: number;
  totalSales: number;
};

/**
 * The headline numbers above the report.
 *
 * CANCELLED ORDERS ARE EXCLUDED from totalVials and totalSales — ordering
 * against a cancelled line means over-buying from the supplier. They are still
 * counted in totalOrders and cancelledOrders so nothing disappears.
 * Invariant: confirmedOrders + pendingOrders === activeOrders === totalOrders − cancelledOrders.
 */
export function summarizeRoundOrders(orders: LinkableOrder[]): RoundSummary {
  let confirmedOrders = 0;
  let pendingOrders = 0;
  let cancelledOrders = 0;
  let totalVials = 0;
  let totalSales = 0;

  for (const o of orders) {
    const payment = displayPaymentStatus(o);
    if (payment === "Cancelled") {
      cancelledOrders++;
      continue; // never feeds vials or sales
    }
    if (payment === "Confirmed") confirmedOrders++;
    else pendingOrders++;
    for (const it of o.items ?? []) {
      totalVials += it.qty;
      totalSales += it.qty * it.price;
    }
  }

  return {
    totalOrders: orders.length,
    activeOrders: confirmedOrders + pendingOrders,
    confirmedOrders,
    pendingOrders,
    cancelledOrders,
    totalVials,
    totalSales,
  };
}

// ── Products to order ────────────────────────────────────────────────────────

export type ProductToOrder = {
  product: string;
  productId: string | null;
  /** The variation this row is for — null when the product has none. Two rows
   *  can share a productId and differ only here; they are separate SKUs. */
  variation: string | null;
  /** Vials to buy from the supplier — cancelled orders excluded entirely. */
  vials: number;
  /** How many valid orders included this product. */
  orders: number;
};

/**
 * "How many vials of each product do I order?" — the number the whole report
 * exists to produce. Cancelled orders are excluded completely. Lines group by
 * productId, falling back to name for legacy orders that predate productIds.
 * Sorted biggest-first so the supplier list reads top-down.
 */
export function buildProductsToOrder(orders: LinkableOrder[]): ProductToOrder[] {
  const byKey = new Map<string, ProductToOrder>();
  for (const o of orders) {
    if (!orderCountsAsDemand(o.status)) continue;
    const seen = new Set<string>();
    for (const it of o.items ?? []) {
      const key = productLineKey(it);
      const row = byKey.get(key) ?? {
        product: it.name,
        productId: it.productId ?? null,
        variation: it.variation ?? null,
        vials: 0,
        orders: 0,
      };
      row.vials += it.qty;
      if (!seen.has(key)) {
        seen.add(key); // count each product once per order, not once per line
        row.orders += 1;
      }
      byKey.set(key, row);
    }
  }
  return [...byKey.values()].sort((a, b) => b.vials - a.vials || a.product.localeCompare(b.product));
}

// ── Per-order rows ───────────────────────────────────────────────────────────

export type RoundOrderRow = {
  orderNumber: string;
  customer: string;
  contact: string;
  address: string;
  product: string;
  productId: string | null;
  /** The group buy this order was placed under — the "batch number". */
  batch: string;
  vials: number;
  price: number;
  /** ISO-8601; formatted for display at the render site. */
  orderDate: string;
  paymentMethod: string;
  paymentStatus: PaymentDisplayStatus;
  orderStatus: string;
  proofUrl: string | null;
  /** The buyer's checkout note, "" when they left it blank. Owner's copy only. */
  customerNote: string;
  /** False for cancelled orders: listed for the audit trail, excluded from every total. */
  counted: boolean;
};

/**
 * One row per order LINE — a customer who bought three products produces three
 * rows, because the supplier order is per product. Cancelled orders are INCLUDED
 * (the owner needs to see them) but flagged `counted: false`.
 *
 * The order's own groupBuyName snapshot wins over the round name when present,
 * so a round renamed after the fact still shows what the customer was told.
 */
export function buildRoundOrderRows(
  round: ReportRoundWindow,
  orders: LinkableOrder[],
): RoundOrderRow[] {
  const rows: RoundOrderRow[] = [];
  for (const o of orders) {
    const counted = orderCountsAsDemand(o.status);
    const paymentStatus = displayPaymentStatus(o);
    const customer = o.customer?.name?.trim() || o.customer?.email?.trim() || "—";
    const contact = o.customer?.phone?.trim() || o.customer?.email?.trim() || "—";
    const address = formatShippingAddress(o.shipping);
    const batch = o.groupBuyName?.trim() || round.name || "—";
    for (const it of o.items ?? []) {
      rows.push({
        orderNumber: o.orderNumber ?? "—",
        customer,
        contact,
        address,
        product: it.name,
        productId: it.productId ?? null,
        batch,
        vials: it.qty,
        price: it.price,
        orderDate: o.date,
        paymentMethod: o.paymentMethod || "—",
        paymentStatus,
        orderStatus: o.status,
        proofUrl: o.paymentProof ?? null,
        // Repeated on every line of a multi-product order: the workbook is one
        // row per LINE, and an instruction that appeared on only the first row
        // is one a packer reading the middle of a batch would never see.
        customerNote: (o.customerNote ?? "").trim(),
        counted,
      });
    }
  }
  return rows;
}
