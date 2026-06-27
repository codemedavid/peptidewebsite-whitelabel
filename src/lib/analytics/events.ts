// PostHog event catalog + payload builders (PURE — no IO, no SDK).
//
// These turn a storefront Order into the exact shape we hand to posthog-node:
// an event name, a stable distinctId, event `properties`, and `personProperties`
// (PostHog's `$set`) so the buyer becomes an IDENTIFIED person carrying an email —
// which is what PostHog Messaging targets when it sends checkout/delivery emails.
//
// Kept side-effect-free so it's unit-testable (scripts/test-posthog.ts) and so
// the capture layer can decide gating/flush separately from payload shape.

import type { Order } from "@/storefront/types";

export const POSTHOG_EVENTS = {
  ORDER_PLACED: "order_placed",
  ORDER_STATUS_CHANGED: "order_status_changed",
} as const;

export type PostHogEventName = (typeof POSTHOG_EVENTS)[keyof typeof POSTHOG_EVENTS];

/** The vendor-neutral payload the capture layer forwards to posthog-node. */
export interface CapturePayload {
  event: PostHogEventName;
  distinctId: string;
  properties: Record<string, unknown>;
  /** Mapped to PostHog `$set` so the person profile carries email/name/phone. */
  personProperties?: Record<string, unknown>;
}

/** The buyer's email, trimmed + lowercased ("" when none was given). */
function emailOf(order: Order): string {
  return (order.customer?.email ?? "").trim().toLowerCase();
}

/**
 * The PostHog distinctId for this order's buyer. Prefer the email (so the same
 * person is recognised across orders and is reachable by PostHog Messaging),
 * then the order number, then the draft id — never empty (PostHog requires one).
 */
export function resolveDistinctId(order: Order): string {
  const email = emailOf(order);
  if (email) return email;
  const number = (order.orderNumber ?? "").trim();
  if (number) return number;
  return order.id;
}

/** Order grand total, mirroring every storefront total surface:
 *  items subtotal + shipping fee + admin fee − discount, clamped at zero. */
export function orderTotal(order: Order): number {
  const subtotal = (order.items ?? []).reduce((s, it) => s + (it.price || 0) * (it.qty || 0), 0);
  const shipping = order.shipping?.fee ?? 0;
  const fee = order.adminFee?.amount ?? 0;
  const discount = order.discount?.amount ?? 0;
  return Math.max(0, subtotal + shipping + fee - discount);
}

/**
 * PostHog `$set` person properties — only the keys the buyer actually provided,
 * so we never overwrite a known email/name with a blank. Returns undefined when
 * the buyer is fully anonymous (nothing to identify).
 */
function personProps(order: Order): Record<string, unknown> | undefined {
  const email = emailOf(order);
  const name = (order.customer?.name ?? "").trim();
  const phone = (order.customer?.phone ?? "").trim();
  const set: Record<string, unknown> = {};
  if (email) set.email = email;
  if (name) set.name = name;
  if (phone) set.phone = phone;
  return Object.keys(set).length ? set : undefined;
}

/** `order_placed` — the authoritative checkout event PostHog workflows trigger on. */
export function buildOrderPlacedPayload(order: Order): CapturePayload {
  const items = order.items ?? [];
  return {
    event: POSTHOG_EVENTS.ORDER_PLACED,
    distinctId: resolveDistinctId(order),
    properties: {
      orderNumber: order.orderNumber ?? order.id,
      total: orderTotal(order),
      itemsCount: items.reduce((s, it) => s + (it.qty || 0), 0),
      itemNames: items.map((it) => it.name),
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      shippingFee: order.shipping?.fee ?? 0,
      adminFee: order.adminFee?.amount ?? 0,
      discountCode: order.discount?.code ?? null,
      discountAmount: order.discount?.amount ?? 0,
      courier: order.courier,
      city: order.shipping?.city ?? "",
      province: order.shipping?.province ?? "",
      groupBuyName: order.groupBuyName ?? null,
    },
    personProperties: personProps(order),
  };
}

/** `order_status_changed` — fired on every fulfillment transition; PostHog
 *  workflows branch on `toStatus` (e.g. shipped/delivered) to send the email. */
export function buildStatusChangedPayload(
  order: Order,
  fromStatus: string,
  toStatus: string,
): CapturePayload {
  return {
    event: POSTHOG_EVENTS.ORDER_STATUS_CHANGED,
    distinctId: resolveDistinctId(order),
    properties: {
      orderNumber: order.orderNumber ?? order.id,
      fromStatus,
      toStatus,
      courier: order.courier,
      trackingNumber: order.trackingNumber,
    },
    personProperties: personProps(order),
  };
}
