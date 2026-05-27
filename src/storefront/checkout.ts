// Checkout hand-off helpers. The storefront has no in-app payment: a customer
// fills in their details and is handed off to one of the messaging channels the
// super admin enabled (WhatsApp / Telegram / Messenger) with a pre-built order
// summary. WhatsApp supports a prefilled message via the URL; Telegram and
// Messenger don't reliably prefill a DM, so callers also copy the summary to the
// clipboard as a fallback.

import type { Brand, ContactChannel, ContactChannelType, Product } from "./types";

/** A cart line: a distinct product plus how many units are in the cart. */
export type CartLine = { product: Product; qty: number };

/** The shipping + contact details collected at checkout. */
export type CheckoutCustomer = {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  province: string;
  postal: string;
  country: string;
};

export const EMPTY_CUSTOMER: CheckoutCustomer = {
  name: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  province: "",
  postal: "",
  country: "",
};

export const CHANNEL_LABELS: Record<ContactChannelType, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  messenger: "Messenger",
};

/** Group the flat cart (one entry per unit) into deduplicated lines. */
export function cartLines(cart: Product[]): CartLine[] {
  const byId = new Map<string, CartLine>();
  for (const product of cart) {
    const line = byId.get(product.id);
    if (line) line.qty += 1;
    else byId.set(product.id, { product, qty: 1 });
  }
  return [...byId.values()];
}

/** Price after an active discount, if any. */
export function unitPrice(p: Product): number {
  return p.discountEnabled && typeof p.discountPrice === "number" ? p.discountPrice : p.price;
}

export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + unitPrice(l.product) * l.qty, 0);
}

/** The channels that are enabled AND have a destination set. */
export function activeChannels(brand: Brand): ContactChannel[] {
  return (brand.contactChannels ?? []).filter((c) => c.enabled && c.destination.trim());
}

function money(amount: number, currency: string): string {
  return `${currency}${amount.toLocaleString()}`;
}

/** Build the order summary message sent to / pasted into the chat. */
export function buildOrderMessage(
  brand: Brand,
  lines: CartLine[],
  customer: CheckoutCustomer,
): string {
  const currency = brand.currency || lines[0]?.product.currency || "";
  const items = lines
    .map((l) => {
      const line = unitPrice(l.product) * l.qty;
      return `• ${l.product.name} ×${l.qty} — ${money(line, l.product.currency || currency)}`;
    })
    .join("\n");
  const total = money(cartTotal(lines), currency);

  const ship = [
    customer.address,
    customer.city,
    customer.province,
    customer.postal,
    customer.country,
  ]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");

  return [
    `New order — ${brand.name}`,
    "",
    "Items:",
    items,
    "",
    `Total: ${total}`,
    "",
    "Customer:",
    `Name: ${customer.name}`,
    `Email: ${customer.email}`,
    `Phone: ${customer.phone}`,
    `Shipping: ${ship || "—"}`,
  ].join("\n");
}

/** Build the deep link that opens the chat for a channel. Only WhatsApp can
 *  carry the prefilled message in the URL. */
export function channelUrl(channel: ContactChannel, message: string): string {
  const dest = channel.destination.trim();
  switch (channel.type) {
    case "whatsapp": {
      const digits = dest.replace(/[^\d]/g, "");
      return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
    }
    case "telegram":
      return `https://t.me/${dest.replace(/^@/, "")}`;
    case "messenger":
      return `https://m.me/${dest.replace(/^@/, "")}`;
  }
}

/** Whether the channel carries the message in its URL (so no clipboard hint). */
export function channelPrefills(type: ContactChannelType): boolean {
  return type === "whatsapp";
}
