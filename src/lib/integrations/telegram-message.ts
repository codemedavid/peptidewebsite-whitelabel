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
import type { Order } from "@/storefront/types";

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
