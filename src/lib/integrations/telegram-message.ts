// The order alert, as Telegram chat text.
//
// Pure: an Order in, a sendMessage payload out. It is the only place order facts
// become chat text, which is why two things are settled here and nowhere else:
//
//   • THE MONEY. The printed total is orderTotal() — the same function the
//     customer email, the admin list and the confirmation page use — so a fee or
//     discount rule can never be re-implemented slightly differently in chat.
//   • THE ESCAPING. Every value that reaches this message came from an anonymous
//     buyer typing into a checkout form. We send parse_mode HTML, so an
//     unescaped "<" does not merely look wrong, it makes Telegram REJECT the
//     whole message — a store would simply stop receiving alerts the first time
//     someone's name contained a bracket.

import { formatMoney } from "@/lib/storefront/currency";
import { orderTotal } from "@/lib/analytics/events";
import { isOrderStatus } from "@/lib/storefront/order-status";
import type { Order, OrderStatus } from "@/storefront/types";

/** Telegram's hard limit on callback_data. Exceeding it makes sendMessage fail. */
export const CALLBACK_DATA_MAX = 64;

const CONFIRM_PREFIX = "confirm:";

export interface TelegramButton {
  text: string;
  callback_data: string;
}

export interface TelegramMessage {
  text: string;
  parse_mode: "HTML";
  reply_markup?: { inline_keyboard: TelegramButton[][] };
}

export interface OrderAlertOptions {
  /** The tenant's currency, for formatMoney. */
  currency?: unknown;
  /**
   * Whether to print the buyer's identity and address. False for a group chat:
   * a group is a room full of people the buyer never agreed to share an address
   * with, so the message keeps the order and drops the person.
   */
  showCustomerDetails: boolean;
}

/** HTML-escape a value for Telegram's HTML parse mode. */
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * The callback payload for a Confirm button, or null when the id will not fit
 * Telegram's 64-byte budget. Null rather than a truncated string on purpose: a
 * truncated id is a DIFFERENT id, and confirming the wrong order is far worse
 * than showing no button.
 */
export function confirmCallbackData(orderId: string): string | null {
  const data = `${CONFIRM_PREFIX}${orderId}`;
  if (!orderId || Buffer.byteLength(data, "utf8") > CALLBACK_DATA_MAX) return null;
  return data;
}

/** The order id inside a Confirm payload, or null for anything else. */
export function parseConfirmCallback(data: unknown): string | null {
  if (typeof data !== "string") return null;
  if (!data.startsWith(CONFIRM_PREFIX)) return null;
  const id = data.slice(CONFIRM_PREFIX.length).trim();
  return id ? id : null;
}

/** Orders past this point are already through the door — no Confirm button. */
const CONFIRMABLE: ReadonlySet<string> = new Set(["new"]);

export function buildOrderAlert(order: Order, opts: OrderAlertOptions): TelegramMessage {
  const money = (n: number) => formatMoney(n, opts.currency);
  const lines: string[] = [];

  lines.push(`🛒 <b>New order ${esc(order.orderNumber ?? order.id)}</b>`);
  lines.push("");

  for (const item of order.items ?? []) {
    lines.push(`• ${item.qty}× ${esc(item.name)} — ${money((item.price || 0) * (item.qty || 0))}`);
  }

  lines.push("");
  const subtotal = (order.items ?? []).reduce((s, it) => s + (it.price || 0) * (it.qty || 0), 0);
  lines.push(`Subtotal: ${money(subtotal)}`);
  if (order.shipping?.fee) lines.push(`Shipping: ${money(order.shipping.fee)}`);
  if (order.adminFee?.amount) lines.push(`${esc(order.adminFee.label)}: ${money(order.adminFee.amount)}`);
  if (order.paymentFee?.amount) lines.push(`${esc(order.paymentFee.label)}: ${money(order.paymentFee.amount)}`);
  if (order.discount?.amount) lines.push(`${esc(order.discount.label)}: −${money(order.discount.amount)}`);
  lines.push(`<b>Total: ${money(orderTotal(order))}</b>`);

  lines.push("");
  lines.push(`Payment: ${esc(order.paymentMethod)} (${esc(order.paymentStatus)})`);

  if (opts.showCustomerDetails) {
    lines.push("");
    lines.push(`👤 ${esc(order.customer?.name)}`);
    if (order.customer?.phone) lines.push(`📞 ${esc(order.customer.phone)}`);
    if (order.customer?.email) lines.push(`✉️ ${esc(order.customer.email)}`);
    const where = [order.shipping?.address, order.shipping?.barangay, order.shipping?.city, order.shipping?.province]
      .filter(Boolean)
      .join(", ");
    if (where) lines.push(`📍 ${esc(where)}`);
    if (order.customerNote) lines.push(`📝 ${esc(order.customerNote)}`);
  } else {
    // Still say WHERE it's going at province granularity — an owner needs to
    // know a shipping region to act, and a province names no one.
    const region = order.shipping?.province || order.shipping?.city;
    if (region) lines.push(`📍 ${esc(region)}`);
  }

  const callback = CONFIRMABLE.has(order.status) ? confirmCallbackData(order.id) : null;

  return {
    text: lines.join("\n"),
    parse_mode: "HTML",
    ...(callback
      ? { reply_markup: { inline_keyboard: [[{ text: "✅ Confirm order", callback_data: callback }]] } }
      : {}),
  };
}

/**
 * The alert text after someone confirms, used to edit the original message in
 * place. The order stays readable; the button is replaced by an audit line, so
 * the chat records WHO confirmed and when rather than silently losing the button.
 */
export function buildConfirmedText(baseText: string, confirmedBy: string, atIso: string): string {
  const when = new Date(atIso);
  const stamp = Number.isNaN(when.getTime()) ? "" : ` · ${when.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  return `${baseText}\n\n✅ <b>Confirmed</b> by ${esc(confirmedBy)}${stamp}`;
}

// ── Driving the order from chat ──────────────────────────────────────────────

const STATUS_PREFIX = "status:";

/** How far an order can move, and what each step is called in the chat. */
const STATUS_FLOW: readonly { status: OrderStatus; label: string }[] = [
  { status: "confirmed", label: "✅ Confirm" },
  { status: "processing", label: "📦 Processing" },
  { status: "ready", label: "🏷 Ready" },
  { status: "shipped", label: "🚚 Shipped" },
  { status: "delivered", label: "🎉 Delivered" },
];

/**
 * Payload for a status button, or null when the status isn't one we recognise.
 * Null rather than a best guess: an unrecognised status reaching the DB would
 * put an order into a state no surface knows how to render.
 */
export function statusCallbackData(orderId: string, status: string): string | null {
  if (!orderId || !isOrderStatus(status)) return null;
  const data = `${STATUS_PREFIX}${orderId}:${status}`;
  return Buffer.byteLength(data, "utf8") > CALLBACK_DATA_MAX ? null : data;
}

/** The order and target status inside a status payload, or null. */
export function parseStatusCallback(
  data: unknown,
): { orderId: string; status: OrderStatus } | null {
  if (typeof data !== "string" || !data.startsWith(STATUS_PREFIX)) return null;
  const rest = data.slice(STATUS_PREFIX.length);
  const cut = rest.lastIndexOf(":");
  if (cut <= 0) return null;
  const orderId = rest.slice(0, cut).trim();
  const status = rest.slice(cut + 1).trim();
  if (!orderId || !isOrderStatus(status)) return null;
  return { orderId, status };
}

/**
 * The buttons offered on an order's message: the remaining forward steps, plus
 * tracking once it is worth capturing, plus cancel.
 *
 * The order's CURRENT status is never offered — a button that does nothing reads
 * as a broken bot — and neither are steps already behind it, so the keyboard
 * shrinks as the order advances.
 */
export function buildStatusKeyboard(order: Pick<Order, "id" | "status">): TelegramButton[][] {
  const current = STATUS_FLOW.findIndex((s) => s.status === order.status);
  const forward = STATUS_FLOW.slice(current + 1)
    .map((s) => {
      const data = statusCallbackData(order.id, s.status);
      return data ? { text: s.label, callback_data: data } : null;
    })
    .filter((b): b is TelegramButton => b !== null);

  const rows: TelegramButton[][] = [];
  // Two per row: Telegram renders wide buttons, and a single column of five
  // pushes the order details off a phone screen.
  for (let i = 0; i < forward.length; i += 2) rows.push(forward.slice(i, i + 2));

  const track = trackCallbackData(order.id);
  if (track) rows.push([{ text: "🔖 Add tracking number", callback_data: track }]);

  const cancel = statusCallbackData(order.id, "cancelled");
  if (cancel) rows.push([{ text: "✖️ Cancel order", callback_data: cancel }]);
  return rows;
}

const TRACK_PREFIX = "track:";

/** Payload for the "Add tracking number" button. */
export function trackCallbackData(orderId: string): string | null {
  const data = `${TRACK_PREFIX}${orderId}`;
  if (!orderId || Buffer.byteLength(data, "utf8") > CALLBACK_DATA_MAX) return null;
  return data;
}

/** The order id inside a tracking-button payload, or null. */
export function parseTrackCallback(data: unknown): string | null {
  if (typeof data !== "string" || !data.startsWith(TRACK_PREFIX)) return null;
  const id = data.slice(TRACK_PREFIX.length).trim();
  return id || null;
}
