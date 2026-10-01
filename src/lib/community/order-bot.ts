// The order-update bot — the store chat's automatic voice.
//
// When the store moves an order to a new status, or adds a tracking number,
// the bot writes ONE message into the store ⇄ customer DM (the same thread the
// team uses to message that customer by hand) and pushes the customer's phone.
// Bot messages are ordinary `store` messages with authorKey "bot" and kind
// "order", so the inbox, unread badges and polling need nothing new.
//
// Pure (npm run test:order-bot). The DB side is order-bot.server.ts.

import type { OrderStatus } from "../../storefront/types";
import { STORE_KEY } from "./keys";

/** authorKey of every bot message (team messages are otherwise owner | s:<id>). */
export const ORDER_BOT_AUTHOR = "bot";
export const ORDER_BOT_NAME = "Order updates";
export const ORDER_MESSAGE_KIND = "order";

/** The shopper's words for each status — mirrors the app's SHOP_STATUS labels. */
const SHOPPER_STATUS: Record<OrderStatus, { label: string; line: string }> = {
  new: { label: "Placed", line: "The store has your order and will confirm it soon." },
  confirmed: { label: "Confirmed", line: "The store accepted your order." },
  processing: { label: "Preparing", line: "Your order is being prepared." },
  ready: { label: "Ready to ship", line: "Packed and waiting for the courier." },
  shipped: { label: "Shipped", line: "Your order is on its way to you." },
  delivered: { label: "Delivered", line: "Your order was delivered. Enjoy!" },
  cancelled: { label: "Cancelled", line: "This order was cancelled. Reply here if you have questions." },
};

export function shopperStatusLabel(status: string): string {
  return SHOPPER_STATUS[status as OrderStatus]?.label ?? status;
}

export type OrderUpdateReason = "status" | "tracking";

/**
 * Is this save news for the buyer? A real status change is (except a move back
 * to "new", which is the store correcting itself). Otherwise a tracking number
 * that was added or changed is. Clearing one, or re-saving the same values, is not.
 */
export function orderUpdateReason(input: {
  statusChanged: boolean;
  status: string;
  prevTracking: string;
  tracking: string;
}): OrderUpdateReason | null {
  if (input.statusChanged) return input.status === "new" ? null : "status";
  const next = input.tracking.trim();
  return next && next !== input.prevTracking.trim() ? "tracking" : null;
}

export type OrderUpdateFacts = {
  orderNumber: string;
  status: string;
  courier: string;
  trackingNumber: string;
};

/** The chat message body. Plain text: the app renders it inside the bot card. */
export function orderUpdateText(o: OrderUpdateFacts): string {
  const meta = SHOPPER_STATUS[o.status as OrderStatus];
  const lines = [`📦 Order ${o.orderNumber} — ${meta?.label ?? o.status}`, meta?.line ?? ""];
  const tracking = o.trackingNumber.trim();
  if (tracking) {
    const courier = o.courier.trim();
    if (courier) lines.push(`Courier: ${courier}`);
    lines.push(`Tracking no.: ${tracking}`);
  }
  return lines.filter(Boolean).join("\n");
}

/**
 * The push. The lock screen names the order and its status but never the
 * tracking number (anyone holding the phone can read a lock screen).
 */
export function orderUpdatePush(input: {
  orderNumber: string;
  status: string;
  reason: OrderUpdateReason;
  trackingNumber: string;
}): { body: string } {
  const label = shopperStatusLabel(input.status);
  const hasTracking = input.trackingNumber.trim().length > 0;
  if (input.reason === "tracking") return { body: `Order ${input.orderNumber}: tracking number added. Tap to view.` };
  return { body: `Order ${input.orderNumber} is now ${label}${hasTracking ? " · tracking number inside" : ""}.` };
}

// ── idempotency ──────────────────────────────────────────────────────────────
// The bot's clientId is `bot:order:<orderId>:<journeyLength>:<trackingHash>`.
// CommunityMessage is unique on (tenant, senderKey, clientId), so a replayed
// update (double tap, Telegram redelivery) can never post twice, while each
// genuine transition — or a changed tracking number — gets its own key.

const PREFIX = "bot:order:";
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function orderBotClientId(orderId: string, journeyLength: number, trackingNumber: string): string {
  return `${PREFIX}${orderId}:${journeyLength}:${fnv(trackingNumber.trim())}`;
}

export function orderIdFromBotClientId(clientId: string | null | undefined): string | null {
  if (!clientId || !clientId.startsWith(PREFIX)) return null;
  const id = clientId.slice(PREFIX.length).split(":")[0];
  return ID_RE.test(id) ? id : null;
}

export function isOrderBotMessage(m: { senderKey: string; authorKey: string | null; kind: string }): boolean {
  return m.senderKey === STORE_KEY && m.authorKey === ORDER_BOT_AUTHOR && m.kind === ORDER_MESSAGE_KIND;
}
