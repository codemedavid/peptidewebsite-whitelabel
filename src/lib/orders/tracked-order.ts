import type { Order, OrderItem, OrderStatusEvent } from "@/storefront/types";

/**
 * The customer-facing view of an order: status, tracking, the journey and the
 * money — never the buyer's PII or proof of payment. Shared by the public Track
 * page (lookup by order number) and the signed-in My Account order history, so
 * the two can never disagree on what a shopper is shown.
 */
export type TrackedOrder = {
  orderNumber: string;
  status: Order["status"];
  date: string;
  courier: string;
  trackingNumber: string;
  shippingNote: string;
  items: OrderItem[];
  shippingFee: number;
  adminFee: { label: string; amount: number } | null;
  paymentFee: { label: string; amount: number } | null;
  discount: { code: string; label: string; amount: number } | null;
  statusHistory: OrderStatusEvent[];
  /** Ligwak re-total (docs/bunuan) — absent = never re-totalled. */
  originalTotal?: number;
  adjustedTotal?: number;
  gbTotals?: Order["gbTotals"];
  amountDue?: number;
  refundDue?: number;
  refundStatus?: Order["refundStatus"];
  refundReference?: string;
  /** The store changed this order's lines ("Changed by the store"). */
  changedByStore?: boolean;
};

export function toTrackedOrder(o: Order): TrackedOrder {
  return {
    orderNumber: o.orderNumber || o.id,
    status: o.status,
    date: o.date,
    courier: o.courier,
    trackingNumber: o.trackingNumber,
    shippingNote: o.shippingNote,
    items: o.items,
    shippingFee: o.shipping?.fee ?? 0,
    adminFee: o.adminFee ?? null,
    paymentFee: o.paymentFee ?? null,
    discount: o.discount ?? null,
    statusHistory: o.statusHistory ?? [],
    ...(o.adjustedTotal != null
      ? { adjustedTotal: o.adjustedTotal, originalTotal: o.gbTotals?.originalTotal, gbTotals: o.gbTotals }
      : {}),
    ...(o.amountDue != null ? { amountDue: o.amountDue } : {}),
    ...(o.refundDue != null ? { refundDue: o.refundDue } : {}),
    ...(o.refundStatus ? { refundStatus: o.refundStatus } : {}),
    ...(o.refundReference ? { refundReference: o.refundReference } : {}),
    ...(o.storeEditedAt ? { changedByStore: true } : {}),
  };
}
