// Order → the mobile app's view model, plus the few rules the app needs to
// guide the admin to the next step.
//
// Every number and rule here DELEGATES to the website's own code, so the app can
// never disagree with the web admin about an order:
//   - money       → computeOrderTotals (the checkout formula) + formatMoney
//   - addresses   → buildAddressLine / buildBookingText
//   - stock moves → inventoryMove (confirm deducts, cancel restocks, imported frozen)
// What is NEW is presentation only: a status "next step", a truthful payment
// label, and the filter groups for the order queue. No status or transition is
// invented — the next step is always one of the seven real statuses, and the
// app's "Change status" sheet still offers all of them (the system allows any).
//
// Pure (npm run test:mobile-core).

import type { Order, OrderStatus } from "../../storefront/types";
import {
  computeOrderTotals,
  buildAddressLine,
  buildBookingText,
  hasPaymentProof,
  itemCount,
} from "../../storefront/admin/order-detail";
import { formatMoney } from "../storefront/currency";
import { inventoryMove, ORDER_STATUSES } from "../storefront/order-status";
import type {
  NextAction,
  OrderDetail,
  OrderFilterKey,
  OrderSummary,
  PaymentView,
  StockMove,
} from "./contract";

const PREVIEW_ITEMS = 2;
const SHORT_ID_LENGTH = 6;

// ── filters ──────────────────────────────────────────────────────────────────

export const ORDER_FILTERS: ReadonlyArray<{
  key: OrderFilterKey;
  label: string;
  statuses: OrderStatus[] | null;
}> = [
  { key: "new", label: "New", statuses: ["new"] },
  { key: "to-fulfil", label: "To fulfil", statuses: ["confirmed", "processing", "ready"] },
  { key: "shipped", label: "Shipped", statuses: ["shipped", "delivered"] },
  { key: "all", label: "All", statuses: null },
];

/** The statuses a filter selects; null = no status filter (all, or unknown key). */
export function statusesForFilter(key: unknown): OrderStatus[] | null {
  const f = ORDER_FILTERS.find((x) => x.key === key);
  return f?.statuses ? [...f.statuses] : null;
}

/**
 * The two queue badges ("New", "To fulfil") from ONE grouped count by status —
 * the list and the Home screen used to run two counts back to back, and inside
 * a tenant transaction every query is its own trip to the database.
 */
export function queueCountsFrom(groups: ReadonlyArray<{ status: string; count: number }>): { new: number; toFulfil: number } {
  const toFulfil = new Set<string>(statusesForFilter("to-fulfil") ?? []);
  let fresh = 0;
  let fulfil = 0;
  for (const g of groups) {
    if (g.status === "new") fresh += g.count;
    if (toFulfil.has(g.status)) fulfil += g.count;
  }
  return { new: fresh, toFulfil: fulfil };
}

// ── next step ────────────────────────────────────────────────────────────────

const NEXT_STEP: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  new: { to: "confirmed", label: "Confirm order" },
  confirmed: { to: "processing", label: "Start processing" },
  processing: { to: "ready", label: "Mark ready to ship" },
  ready: { to: "shipped", label: "Mark as shipped" },
  shipped: { to: "delivered", label: "Mark as delivered" },
};

export function nextActionFor(order: Pick<Order, "status">): NextAction | null {
  const step = NEXT_STEP[order.status];
  if (!step) return null;
  return { ...step, needsTracking: step.to === "shipped" };
}

/** What moving this order to `to` would do to stock — drives the confirm dialog. */
export function statusMovesStock(
  order: Pick<Order, "status" | "statusHistory" | "imported">,
  to: OrderStatus,
): StockMove {
  return inventoryMove(order.status, order.statusHistory ?? [], to, order.imported === true);
}

// ── payment ──────────────────────────────────────────────────────────────────

/**
 * A truthful payment label. Checkout stores paymentStatus "paid" whenever the
 * CUSTOMER attaches a proof image, so "paid + proof" means "proof submitted,
 * please check it" — never "verified". Only "paid" with no proof (set by an
 * admin, or a legacy import) reads as paid.
 */
export function paymentView(
  order: Pick<Order, "paymentStatus" | "paymentProof" | "paymentMethod">,
): PaymentView {
  const hasProof = hasPaymentProof(order.paymentProof);
  const method = (order.paymentMethod ?? "").trim() || "Not specified";
  if (hasProof) return { label: "Proof submitted", tone: "info", method, hasProof };
  if (order.paymentStatus === "paid") return { label: "Marked paid", tone: "success", method, hasProof };
  return { label: "Awaiting payment", tone: "warning", method, hasProof };
}

// ── summary / detail ─────────────────────────────────────────────────────────

function displayNumber(order: Pick<Order, "orderNumber" | "id">): string {
  const n = (order.orderNumber ?? "").trim();
  return n || `#${order.id.slice(-SHORT_ID_LENGTH)}`;
}

function itemsPreview(order: Order): string {
  const items = order.items ?? [];
  const head = items
    .slice(0, PREVIEW_ITEMS)
    .map((i) => `${i.qty || 1}× ${i.name}`)
    .join(", ");
  const rest = items.length - PREVIEW_ITEMS;
  return rest > 0 ? `${head} +${rest} more` : head;
}

export function toOrderSummary(order: Order, currency: unknown): OrderSummary {
  const totals = computeOrderTotals(order);
  return {
    id: order.id,
    orderNumber: displayNumber(order),
    status: order.status,
    placedAt: order.date,
    customerName: (order.customer?.name ?? "").trim() || "Customer",
    itemCount: itemCount(order),
    itemsPreview: itemsPreview(order),
    total: totals.total,
    totalLabel: formatMoney(totals.total, currency),
    payment: paymentView(order),
    orderType: order.orderType === "reseller" ? "reseller" : "retail",
    hasCustomerNote: (order.customerNote ?? "").trim() !== "",
    groupBuyId: order.groupBuyId ?? null,
    groupBuyName: order.groupBuyName ?? null,
  };
}

function optionalMoney(amount: number | undefined, currency: unknown): string | null {
  return amount && amount > 0 ? formatMoney(amount, currency) : null;
}

export function toOrderDetail(order: Order, currency: unknown, updatedAt: string): OrderDetail {
  const totals = computeOrderTotals(order);
  const money = (n: number) => formatMoney(n, currency);
  const stockEffects: OrderDetail["stockEffects"] = {};
  for (const s of ORDER_STATUSES) {
    const move = statusMovesStock(order, s);
    if (move) stockEffects[s] = move;
  }
  return {
    ...toOrderSummary(order, currency),
    updatedAt,
    customer: {
      name: order.customer?.name ?? "",
      email: order.customer?.email ?? "",
      phone: order.customer?.phone ?? "",
      contactMethod: order.customer?.contactMethod ?? "",
    },
    shipping: {
      addressLine: buildAddressLine(order.shipping),
      region: order.shipping?.region ?? "",
      bookingText: buildBookingText(order),
    },
    items: (order.items ?? []).map((i) => ({
      name: i.name,
      qty: i.qty || 1,
      unitPriceLabel: money(i.price || 0),
      lineTotalLabel: money((i.price || 0) * (i.qty || 1)),
    })),
    money: {
      subtotalLabel: money(totals.subtotal),
      discountLabel: optionalMoney(totals.discount, currency),
      discountCode: order.discount?.code ?? null,
      shippingLabel: money(totals.shipping),
      adminFeeLabel: optionalMoney(totals.fee, currency),
      adminFeeName: order.adminFee?.label ?? null,
      paymentFeeLabel: optionalMoney(totals.paymentFee, currency),
      paymentFeeName: order.paymentFee?.label ?? null,
      totalLabel: money(totals.total),
    },
    paymentProofUrl: hasPaymentProof(order.paymentProof) ? order.paymentProof : null,
    // Set by the server from the row (lib/mobile/orders.ts): Order has no account link.
    chatKey: null,
    courier: order.courier ?? "",
    trackingNumber: order.trackingNumber ?? "",
    shippingNote: order.shippingNote ?? "",
    customerNote: order.customerNote ?? "",
    timeline: (order.statusHistory ?? []).map((e) => ({ status: e.status, at: e.at })),
    imported: order.imported === true,
    nextAction: nextActionFor(order),
    stockEffects,
  };
}
