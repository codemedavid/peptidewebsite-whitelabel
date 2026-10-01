// Push copy + Expo ticket triage for Pepweb Admin. Pure (npm run test:mobile-core).
//
// Lock screens are public. The new-order alert names the STORE, the order
// number, the order total and the item count (the Shopify-style "you made a
// sale" moment) — never the customer or the products — and its data payload
// carries just the order id. Opening it still goes through the
// authenticated API, so the payload grants nothing on its own.

import { formatMoney } from "../storefront/currency";

export type PushMessage = {
  title: string;
  body: string;
  data: { type: "order"; orderId: string };
};

export type PushOrder = {
  id: string;
  orderNumber?: string | null;
  /** Checkout total; omitted → the amount is left out of the alert. */
  total?: number;
  itemCount?: number;
};

export function buildNewOrderPush(order: PushOrder, storeName: string, currency?: unknown): PushMessage {
  const number = (order.orderNumber ?? "").trim() || "#" + order.id.slice(-6);
  const store = storeName.trim() || "your store";
  const parts = [`Order ${number}`];
  if (typeof order.total === "number" && Number.isFinite(order.total) && order.total > 0) {
    parts.push(formatMoney(order.total, currency));
  }
  if (order.itemCount && order.itemCount > 0) {
    parts.push(`${order.itemCount} ${order.itemCount === 1 ? "item" : "items"}`);
  }
  return {
    title: `New order · ${store}`,
    body: `${parts.join(" · ")}. Tap to review.`,
    data: { type: "order", orderId: order.id },
  };
}

/** One ticket from Expo's push/send response. */
export type ExpoTicket = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

export type TicketOutcome = "ok" | "remove-device" | "retry" | "fail";

const RETRYABLE = new Set(["MessageRateExceeded", "ExpoError"]);

/**
 * - DeviceNotRegistered → the app was uninstalled or the token rotated: delete it.
 * - rate limit / transient → retry.
 * - anything else (bad credentials, message too big) → log and give up.
 * - a missing ticket (network cut mid-response) → retry.
 */
export function triageExpoTicket(ticket: ExpoTicket | undefined): TicketOutcome {
  if (!ticket) return "retry";
  if (ticket.status === "ok") return "ok";
  const code = ticket.details?.error ?? "";
  if (code === "DeviceNotRegistered") return "remove-device";
  return RETRYABLE.has(code) ? "retry" : "fail";
}

/** Expo push tokens look like ExponentPushToken[xxxx] (or ExpoPushToken[xxxx]). */
export function isExpoPushToken(value: unknown): value is string {
  return typeof value === "string" && /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$/.test(value);
}
