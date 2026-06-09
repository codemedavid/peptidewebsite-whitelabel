// Checkout hand-off helpers. The storefront has no in-app payment: a customer
// fills in their details and is handed off to one of the messaging channels the
// super admin enabled (WhatsApp / Telegram / Messenger) with a pre-built order
// summary. WhatsApp supports a prefilled message via the URL; Telegram and
// Messenger don't reliably prefill a DM, so callers also copy the summary to the
// clipboard as a fallback.

import type { Brand, ContactChannel, ContactChannelType, PaymentMethod, Product } from "./types";

/** A cart line: a distinct product plus how many units are in the cart. */
export type CartLine = { product: Product; qty: number };

/** What the customer paid with, gathered before the order is handed off. */
export type CheckoutPayment = { methodName: string; hasProof: boolean };

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

// ── Reseller (wholesale) pricing ──────────────────────────────────────────────
// Peppies Intl sells most peptides at a wholesale unit price once a customer
// buys in bulk. The threshold is PER PRODUCT (a single line must reach the
// minimum on its own — a mixed cart of singles doesn't qualify). The tier is
// taken from the seller's listed price: prefer the Complete Set price (the
// configuration the storefront ships), falling back to Vials Only when that's
// the only tier offered. Products with no `reseller` data (e.g. Lemon Bottle)
// always stay at retail. This is data-driven, so it's a no-op for any tenant
// whose products carry no reseller pricing.

/** Default bulk threshold when a product doesn't set its own `reseller.minQty`. */
export const RESELLER_MIN_QTY = 10;

/**
 * The minimum units that unlock the wholesale price for this product — the
 * owner's per-product `reseller.minQty` when set (>0), else the global default.
 */
export function resellerMinQty(p: Product): number {
  const m = p.reseller?.minQty;
  return typeof m === "number" && m > 0 ? m : RESELLER_MIN_QTY;
}

/**
 * The wholesale unit price for a product, or null if it offers none. Prefers the
 * Complete Set price (what the store ships), else Vials Only.
 */
export function resellerUnitPrice(p: Product): number | null {
  const r = p.reseller;
  if (!r) return null;
  const price = r.completeSet || r.vialsOnly || 0;
  return price > 0 ? price : null;
}

/** The wholesale tier label that applies (for display), or null if none. */
export function resellerTierLabel(p: Product): "Complete set" | "Vials only" | null {
  const r = p.reseller;
  if (!r) return null;
  if (r.completeSet) return "Complete set";
  if (r.vialsOnly) return "Vials only";
  return null;
}

/** The non-bulk effective unit price: an active promo discount, else retail. */
function basePrice(p: Product): number {
  return p.discountEnabled && typeof p.discountPrice === "number" ? p.discountPrice : p.price;
}

/**
 * Whether the wholesale price is actually in effect for a line of `qty` units —
 * i.e. the quantity qualifies AND the wholesale price is genuinely cheaper than
 * the current (retail/discount) price. Drives the "Reseller" badge + struck
 * price, so they only ever appear on a real saving.
 */
export function isResellerQty(p: Product, qty: number): boolean {
  if (qty < resellerMinQty(p)) return false;
  const wholesale = resellerUnitPrice(p);
  return wholesale != null && wholesale < basePrice(p);
}

/**
 * Per-unit price for a line of `qty` units. At RESELLER_MIN_QTY+ the product's
 * wholesale price applies — but ONLY when it's cheaper than the current price, so
 * buying in bulk can never raise the per-unit cost (a reseller leg mis-entered
 * above retail/discount is ignored). Otherwise the active discount price, else
 * retail. Defaults to qty 1 so existing single-unit callers are unchanged.
 */
export function unitPrice(p: Product, qty = 1): number {
  const base = basePrice(p);
  if (qty >= resellerMinQty(p)) {
    const wholesale = resellerUnitPrice(p);
    if (wholesale != null && wholesale < base) return wholesale;
  }
  return base;
}

export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + unitPrice(l.product, l.qty) * l.qty, 0);
}

/** The channels that are enabled AND have a destination set. */
export function activeChannels(brand: Brand): ContactChannel[] {
  return (brand.contactChannels ?? []).filter((c) => c.enabled && c.destination.trim());
}

/** Active payment methods, in the order configured by the store admin. */
export function activePaymentMethods(methods: PaymentMethod[]): PaymentMethod[] {
  return methods.filter((m) => m.active).sort((a, b) => a.order - b.order);
}

function money(amount: number, currency: string): string {
  return `${currency}${amount.toLocaleString()}`;
}

/** Build the order summary message sent to / pasted into the chat. */
export function buildOrderMessage(
  brand: Brand,
  lines: CartLine[],
  customer: CheckoutCustomer,
  payment?: CheckoutPayment,
  orderNumber?: string,
): string {
  const currency = brand.currency || lines[0]?.product.currency || "";
  const items = lines
    .map((l) => {
      const cur = l.product.currency || currency;
      const up = unitPrice(l.product, l.qty);
      const line = up * l.qty;
      const tag = isResellerQty(l.product, l.qty)
        ? ` (reseller — ${resellerTierLabel(l.product)?.toLowerCase()} @ ${money(up, cur)}/ea)`
        : "";
      return `• ${l.product.name} ×${l.qty} — ${money(line, cur)}${tag}`;
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

  const paymentLines = payment
    ? [
        "",
        "Payment:",
        `Method: ${payment.methodName || "—"}`,
        payment.hasProof
          ? "Proof of payment: attached — sending in this chat"
          : "Proof of payment: —",
      ]
    : [];

  return [
    `${orderNumber ? `Order #${orderNumber} — ` : "New order — "}${brand.name}`,
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
    ...paymentLines,
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
