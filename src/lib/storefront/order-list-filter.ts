import type { Order } from "@/storefront/types";

/**
 * The Orders screen's two filters — order STATUS (the tiles) and PAYMENT —
 * combined, so an owner can open "New + payment not confirmed" in one click.
 * Each facet's counts are taken under the OTHER facet's choice, so a number
 * on a tile is always the number of rows that tile would show.
 *
 * "Not confirmed" is the same rule as the group-buy folders' "unpaid" chip
 * (lib/storefront/order-folders.ts): not cancelled, not marked paid. A
 * cancelled order has nothing left to collect.
 *
 * Pure — scripts/test-order-list-filter.ts.
 */

export type StatusFilter = "all" | Order["status"];
export type PaymentFilter = "all" | "unpaid" | "paid";
export type OrderListFilter = { status: StatusFilter; payment: PaymentFilter };

export const NO_ORDER_FILTER: OrderListFilter = { status: "all", payment: "all" };

export const ORDER_STATUSES: readonly Order["status"][] = [
  "new",
  "confirmed",
  "processing",
  "ready",
  "shipped",
  "delivered",
  "cancelled",
];

type Filterable = Pick<Order, "status" | "paymentStatus">;

export function isPaid(o: Filterable): boolean {
  return (o.paymentStatus ?? "").toLowerCase() === "paid";
}

/** Money still to confirm: not paid and not cancelled. */
export function isAwaitingPayment(o: Filterable): boolean {
  return !isPaid(o) && o.status !== "cancelled";
}

export function matchesPayment(o: Filterable, payment: PaymentFilter): boolean {
  if (payment === "paid") return isPaid(o);
  if (payment === "unpaid") return isAwaitingPayment(o);
  return true;
}

export function matchesStatus(o: Filterable, status: StatusFilter): boolean {
  return status === "all" || o.status === status;
}

export function applyOrderFilter<T extends Filterable>(orders: readonly T[], f: OrderListFilter): T[] {
  return orders.filter((o) => matchesStatus(o, f.status) && matchesPayment(o, f.payment));
}

/** Per-status counts (plus "all") among orders that pass the payment filter. */
export function statusCounts(orders: readonly Filterable[], payment: PaymentFilter): Record<StatusFilter, number> {
  const counts = Object.fromEntries(["all", ...ORDER_STATUSES].map((s) => [s, 0])) as Record<StatusFilter, number>;
  for (const o of orders) {
    if (!matchesPayment(o, payment)) continue;
    counts.all += 1;
    if (o.status in counts) counts[o.status] += 1;
  }
  return counts;
}

/** Per-payment counts among orders that pass the status filter. */
export function paymentCounts(orders: readonly Filterable[], status: StatusFilter): Record<PaymentFilter, number> {
  const counts: Record<PaymentFilter, number> = { all: 0, unpaid: 0, paid: 0 };
  for (const o of orders) {
    if (!matchesStatus(o, status)) continue;
    counts.all += 1;
    if (isPaid(o)) counts.paid += 1;
    else if (isAwaitingPayment(o)) counts.unpaid += 1;
  }
  return counts;
}

export function isFiltered(f: OrderListFilter): boolean {
  return f.status !== "all" || f.payment !== "all";
}
