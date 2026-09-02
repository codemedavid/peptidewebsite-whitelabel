// Checkout hand-off helpers. The storefront has no in-app payment: a customer
// fills in their details and is handed off to one of the messaging channels the
// super admin enabled (WhatsApp / Telegram / Messenger) with a pre-built order
// summary. WhatsApp supports a prefilled message via the URL; Telegram and
// Messenger don't reliably prefill a DM, so callers also copy the summary to the
// clipboard as a fallback.

import type { Brand, ContactChannel, ContactChannelType, PaymentMethod, Product } from "./types";
import { instagramDmUrl } from "@/lib/storefront/contact-channels";
import { isGroupBuyProduct, groupBuyLine, isInGroupBuyScope, type GroupBuyPriceScope } from "@/lib/storefront/two-ways";
import { buildProductOptions, hasDoseToken } from "@/lib/storefront/variations";
import { effectiveBasePrice } from "@/lib/storefront/sale";
import {
  RESELLER_MIN_QTY,
  parentProductId,
  resolveWholesale,
  wholesaleQty,
  type WholesaleScope,
} from "@/lib/storefront/wholesale";

/** A cart line: a distinct product plus how many units are in the cart. */
export type CartLine = { product: Product; qty: number };

/** How a line's wholesale saving is named in customer/seller-facing copy. */
export type WholesaleTierLabel = "Complete set" | "Vials only" | "Wholesale";

/** What the customer paid with, gathered before the order is handed off. */
export type CheckoutPayment = { methodName: string; hasProof: boolean };

/** The shipping + contact details collected at checkout. */
export type CheckoutCustomer = {
  name: string;
  email: string;
  phone: string;
  address: string;
  barangay: string;
  city: string;
  province: string;
  postal: string;
};

export const EMPTY_CUSTOMER: CheckoutCustomer = {
  name: "",
  email: "",
  phone: "",
  address: "",
  barangay: "",
  city: "",
  province: "",
  postal: "",
};

export const CHANNEL_LABELS: Record<ContactChannelType, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  messenger: "Messenger",
  viber: "Viber",
  gmail: "Gmail",
  instagram: "Instagram",
};

/** The underlying catalog product id for a cart entry — the real id for a
 *  variation clone (so shared stock + order deduction key off the true row),
 *  or the entry's own id for an ordinary product. */
export function baseProductId(p: Product): string {
  return parentProductId(p);
}

/**
 * Clone a catalog product into the cart entry for a chosen variation: a composite
 * id (so the cart keeps each option as its own line), the option baked into the
 * name (so every order/message surface shows it), and the variation's own price.
 * A variation carries its own price, so base-product promos/wholesale don't apply
 * to it — those stay on the single-option base product.
 *
 * `gbPrice` follows the same rule, and for the same reason. The product-level
 * gbPrice belongs to the BASE option, so carrying it over (which spreading
 * `...product` used to do silently) charged the base option's group price for
 * every size: k-glow's Retatrutide 30mg listed at ₱9,924 and was billed ₱3,866,
 * the 5mg price. A variation therefore gets its OWN gbPrice, and an option
 * without one gets NONE — it sells at its own price rather than inheriting a
 * discount that was never meant for it. Erring toward the seller's list price is
 * the safe direction; `unitPrice`'s Math.min still stops the reverse error.
 */
/** The cart id a chosen variation lands under — the base id plus the option, so
 *  each dose is its own cart line. Exported so a card can count/decrement the
 *  entry for the option it has selected without re-deriving the format. */
export function variationEntryId(productId: string, variationName: string): string {
  return `${productId}::${variationName}`;
}

export function makeVariationEntry(
  product: Product,
  variation: { name: string; price: number; gbPrice?: number },
): Product {
  const gbPrice = Math.max(0, Number(variation.gbPrice) || 0);
  return {
    ...product,
    id: variationEntryId(product.id, variation.name),
    name: `${product.name} — ${variation.name}`,
    price: Math.max(0, Number(variation.price) || 0),
    variantOf: product.id,
    variantName: variation.name,
    discountEnabled: false,
    discountPrice: 0,
    reseller: undefined,
    // ...but `wholesale` IS carried over, deliberately. The MOQ and wholesale
    // price belong to the PARENT product and every option shares them, which is
    // the whole point of the combined-variant rule: 250 Red + 250 Black + 250
    // Blue + 250 Yellow is 1,000 Vial Caps. Copying the config here is what lets
    // an option qualify at all; the cart-level WholesaleScope is what pools the
    // quantities. The legacy `reseller` leg is NOT carried (above) and so is
    // unaffected — a legacy product's options price exactly as they do today.
    wholesale: product.wholesale,
    gbPrice: gbPrice > 0 ? gbPrice : undefined,
  };
}

/**
 * The name a cart entry is shown and ORDERED under — the product name carrying
 * its dose whenever the dose is actually known.
 *
 * WHY (k-glow, 2026-08-01): sellers put the dose in the VARIATIONS, not the
 * product name — the catalog row is "Semaglutide" and "5mg × 10 vials" is a
 * variation. The catalog card and the two-ways home render an option picker, so
 * a pick clones the row via makeVariationEntry and the name already carries the
 * dose. The GROUP-BUY page has no picker: it adds the raw row, so the checkout
 * list and the order the seller receives both read a bare "Semaglutide".
 *
 * Rules, in order:
 *  - A chosen variation → left alone; makeVariationEntry already named it, and
 *    appending again gives "… — 5mg × 10 vials 5mg × 10 vials".
 *  - A name already carrying a dose ("Lemon Bottle 10ml") → left alone.
 *  - Exactly ONE buyable option → append it, so a bare add reads identically to
 *    the same product added through a picker (one line, not two).
 *  - Anything else → left BARE, deliberately. With several options and none
 *    chosen the dose is genuinely unknown, and this string is persisted onto the
 *    order: "Tirzepatide 5mg / 10mg / 15mg" would tell the seller the customer
 *    ordered every dose at once. A distinct "Standard" base price alongside one
 *    variation is the same trap — the customer may have bought Standard.
 *
 * Note this is a LABEL, not a price: what the customer pays still comes from
 * unitPrice, and the server re-derives it via authoritativeItemPrice.
 */
export function cartDisplayName(product: Product): string {
  const name = (product.name || "").trim();
  if (product.variantName) return name;
  if (hasDoseToken(name)) return name;

  const options = buildProductOptions(product);
  if (options.length !== 1 || !options[0].variation) return name;

  const only = options[0].name.trim();
  return only ? `${name} — ${only}` : name;
}

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

/** Default bulk threshold for a LEGACY reseller leg with no `minQty` of its own.
 *  Defined in lib/storefront/wholesale.ts (the pricing engine) and re-exported
 *  here for the long-standing importers. */
export { RESELLER_MIN_QTY };

/**
 * The minimum units that unlock the wholesale price for this product — the
 * owner's per-product `reseller.minQty` when set (>0), else the global default.
 */
export function resellerMinQty(p: Product): number {
  return resolveWholesale(p)?.moq ?? RESELLER_MIN_QTY;
}

/**
 * The wholesale unit price for a product, or null if it offers none. Prefers the
 * Complete Set price (what the store ships), else Vials Only.
 */
export function resellerUnitPrice(p: Product): number | null {
  return resolveWholesale(p)?.price ?? null;
}

/** The wholesale tier label that applies (for display), or null if none.
 *  The current config has no tiers — one MOQ at one price — so it is named
 *  plainly. Reading `p.reseller` alone returned null for such a product while
 *  isResellerQty said true, which printed a literal "reseller — undefined" into
 *  the order summary the seller receives. */
export function resellerTierLabel(p: Product): WholesaleTierLabel | null {
  if (resolveWholesale(p) == null) return null;
  const r = p.reseller;
  if (r?.completeSet) return "Complete set";
  if (r?.vialsOnly) return "Vials only";
  return "Wholesale";
}

/** The non-bulk effective unit price: an active promo discount, else retail.
 *  Delegates to the shared sale rule so the price a card ADVERTISES and the
 *  price this line CHARGES are one number — they used to be two (the catalog
 *  printed the list price while this returned the markdown), which is how a
 *  shopper only found out an item was on sale once it was in the cart. */
function basePrice(p: Product): number {
  return effectiveBasePrice(p);
}

/**
 * Whether the wholesale price is actually in effect for a line of `qty` units —
 * i.e. the quantity qualifies AND the wholesale price is genuinely cheaper than
 * the current (retail/discount) price. Drives the "Reseller" badge + struck
 * price, so they only ever appear on a real saving.
 */
export function isResellerQty(
  p: Product,
  qty: number,
  wholesale: WholesaleScope | null = null,
): boolean {
  const cfg = resolveWholesale(p);
  if (!cfg) return false;
  if (wholesaleQty(p, qty, wholesale) < cfg.moq) return false;
  return cfg.price < basePrice(p);
}

/**
 * Per-unit price for a line of `qty` units. At RESELLER_MIN_QTY+ the product's
 * wholesale price applies — but ONLY when it's cheaper than the current price, so
 * buying in bulk can never raise the per-unit cost (a reseller leg mis-entered
 * above retail/discount is ignored). Otherwise the active discount price, else
 * retail. Defaults to qty 1 so existing single-unit callers are unchanged.
 */
/** The non-group-buy per-unit price: bulk wholesale when it qualifies AND is
 *  cheaper, else the active discount, else retail. This is the price a line pays
 *  when no live group-buy round covers it. */
function regularUnitPrice(
  p: Product,
  qty: number,
  wholesale: WholesaleScope | null = null,
): number {
  const base = basePrice(p);
  const cfg = resolveWholesale(p);
  // The MOQ is measured against the PARENT's combined cart quantity when a scope
  // is present (so four colours of 250 reach one 1,000-piece MOQ together), and
  // against this line alone when it is not. Once reached, the wholesale price
  // applies to the whole quantity — the MOQ is a floor, not a cap.
  if (cfg && wholesaleQty(p, qty, wholesale) >= cfg.moq && cfg.price < base) {
    return cfg.price;
  }
  return base;
}

export function unitPrice(
  p: Product,
  qty = 1,
  scope: GroupBuyPriceScope | null = null,
  wholesale: WholesaleScope | null = null,
): number {
  const regular = regularUnitPrice(p, qty, wholesale);
  // A group-buy product IN the live round's scope is sold at its gbPrice — the
  // single price the group-buy page advertises. Scope keeps a gb product OUTSIDE
  // the round (or any gb product when no round is live) at its regular price.
  // Math.min guarantees the group price never RAISES the line above what it would
  // otherwise pay, so a bulk reseller keeps the cheaper wholesale price.
  if (scope && isGroupBuyProduct(p) && isInGroupBuyScope(baseProductId(p), scope)) {
    return Math.min(groupBuyLine(p).gbPrice, regular);
  }
  return regular;
}

export function cartTotal(
  lines: CartLine[],
  scope: GroupBuyPriceScope | null = null,
  wholesale: WholesaleScope | null = null,
): number {
  return lines.reduce((sum, l) => sum + unitPrice(l.product, l.qty, scope, wholesale) * l.qty, 0);
}

/** A cart with at least one owner-tagged product pays no configured shipping
 *  location fee. Variations inherit the flag because makeVariationEntry spreads
 *  the base product into the cart entry. */
export function hasFreeShippingLine(lines: CartLine[]): boolean {
  return lines.some((l) => l.product.freeShipping === true);
}

/** Server-side analogue of hasFreeShippingLine: order items carry only the base
 *  product id / name, so match against the live catalog before deciding. */
export function orderHasFreeShippingProduct(
  items: Array<{ productId?: string; name: string }>,
  catalog: Product[],
): boolean {
  return items.some((it) => {
    const prod = catalog.find((p) =>
      it.productId ? p.id === it.productId : p.name === it.name,
    );
    return prod?.freeShipping === true;
  });
}

/** Apply the product-level free-shipping waiver to a configured shipping fee. */
export function effectiveShippingFee(baseFee: unknown, freeShipping: boolean): number {
  const fee = Math.max(0, Number(baseFee) || 0);
  return freeShipping ? 0 : fee;
}

// ── Always-live pricing ───────────────────────────────────────────────────────
// A cart entry is a SNAPSHOT taken at add-time (price, discount, reseller tier,
// or — for a variation clone — the option's price). The catalog is the DB's
// source of truth and can change while a customer shops, so before pricing the
// cart we re-hydrate each entry from the CURRENT catalog. The customer is never
// charged a price they can't see in the live store, and the server re-applies
// the same resolution at placement (authoritativeItemPrice) so a stale or
// tampered client can't undercut it.

/**
 * Re-hydrate a cart entry with the current catalog data, keyed by its underlying
 * product id. For a variation entry the matching option's live price is re-read
 * and re-cloned (composite id + label preserved, so cart grouping is stable).
 * Falls back to the original snapshot when the product was archived/deleted or
 * the chosen variation no longer exists — never crash, never re-price to the
 * wrong option, never silently drop the line.
 */
export function resolveLiveProduct(entry: Product, catalog: Product[]): Product {
  const live = catalog.find((p) => p.id === baseProductId(entry));
  if (!live) return entry;
  if (entry.variantName) {
    const variation = (live.variations ?? []).find((v) => v.name === entry.variantName);
    return variation ? makeVariationEntry(live, variation) : entry;
  }
  return live;
}

/** Grouped cart lines priced from the live catalog (see resolveLiveProduct). */
export function liveCartLines(cart: Product[], catalog: Product[]): CartLine[] {
  return cartLines(cart.map((entry) => resolveLiveProduct(entry, catalog)));
}

/**
 * The SERVER-authoritative per-unit price for a stored order line, recomputed
 * from the catalog exactly as the cart resolves it. The line is matched the same
 * way as the stock/rules checks — by `productId` (the client stamps the base
 * product id) else exact name. A variation's price comes straight from the live
 * option (variations carry no discount/reseller). Returns null when the line
 * matches no live product or its variation is gone, so the caller keeps the
 * client-sent price rather than zeroing or mispricing an unknown line.
 */
export function authoritativeItemPrice(
  item: { productId?: string; name: string; qty: number; variation?: string },
  catalog: Product[],
  scope: GroupBuyPriceScope | null = null,
  wholesale: WholesaleScope | null = null,
): number | null {
  const live = catalog.find((p) => (item.productId ? p.id === item.productId : p.name === item.name));
  if (!live) return null;
  if (item.variation) {
    // Re-clone the chosen option exactly as the cart does (makeVariationEntry),
    // then price it through unitPrice — so a variation of a live group-buy
    // product gets the SAME gbPrice the cart charged, instead of diverging to the
    // raw variation price. Non-gb / off-round variations still price at the
    // option's own price (unitPrice returns regular for them).
    const variation = (live.variations ?? []).find((v) => v.name === item.variation);
    if (!variation) return null;
    return unitPrice(makeVariationEntry(live, variation), item.qty, scope, wholesale);
  }
  return unitPrice(live, item.qty, scope, wholesale);
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

/** Build the order summary message sent to / pasted into the chat. Pass the
 *  STORED order's `adminFee` (the server-stamped snapshot) so the chat total
 *  always matches what was persisted, never a mid-session config change. */
export function buildOrderMessage(
  brand: Brand,
  lines: CartLine[],
  customer: CheckoutCustomer,
  payment?: CheckoutPayment,
  orderNumber?: string,
  adminFee?: { label: string; amount: number } | null,
  shipping?: { courier: string; fee: number } | null,
  discount?: { code?: string; label: string; amount: number } | null,
  // The cart's wholesale scope. This message is what the SELLER receives, so
  // pricing it per line would quote retail totals for a cart the cart UI, the
  // stored order and the confirmation table all charge at wholesale — seller and
  // system disagreeing on what is owed.
  wholesale: WholesaleScope | null = null,
  // The buyer's own note from checkout. Most owners on this platform work the
  // order out of the chat thread, so a note that never reached this message
  // would, for them, not exist.
  customerNote = "",
  // The stored order's `paymentFee` (QR PH), for the same reason as adminFee:
  // the messaged total must equal what was persisted. Appended LAST rather than
  // grouped with the other fees so no existing positional caller shifts.
  paymentFee?: { label: string; amount: number } | null,
): string {
  const currency = brand.currency || lines[0]?.product.currency || "";
  const items = lines
    .map((l) => {
      const cur = l.product.currency || currency;
      const up = unitPrice(l.product, l.qty, null, wholesale);
      const line = up * l.qty;
      const tag = isResellerQty(l.product, l.qty, wholesale)
        ? ` (reseller — ${resellerTierLabel(l.product)?.toLowerCase()} @ ${money(up, cur)}/ea)`
        : "";
      return `• ${cartDisplayName(l.product)} ×${l.qty} — ${money(line, cur)}${tag}`;
    })
    .join("\n");
  const subtotal = cartTotal(lines, null, wholesale);
  const shippingFee = shipping?.fee ?? 0;
  const discountAmount = discount?.amount ?? 0;
  // The grand total never drops below zero (a discount caps at the subtotal).
  const paymentFeeAmount = paymentFee?.amount ?? 0;
  const grandTotal = Math.max(
    0,
    subtotal - discountAmount + (adminFee?.amount ?? 0) + shippingFee + paymentFeeAmount,
  );
  // With a fee (shipping and/or admin) or a discount, break the math down so the
  // customer sees why the total differs from the items; without any, keep the
  // historical single Total line.
  const totalLines =
    adminFee || paymentFee || shippingFee > 0 || discountAmount > 0
      ? [
          `Subtotal: ${money(subtotal, currency)}`,
          ...(discountAmount > 0
            ? [
                `Discount${discount?.code ? ` (${discount.code})` : ""}: -${money(
                  discountAmount,
                  currency,
                )}`,
              ]
            : []),
          ...(shippingFee > 0
            ? [
                `Shipping${shipping?.courier ? ` (${shipping.courier})` : ""}: ${money(
                  shippingFee,
                  currency,
                )}`,
              ]
            : []),
          ...(adminFee ? [`${adminFee.label}: ${money(adminFee.amount, currency)}`] : []),
          ...(paymentFee ? [`${paymentFee.label}: ${money(paymentFee.amount, currency)}`] : []),
          `Total: ${money(grandTotal, currency)}`,
        ]
      : [`Total: ${money(subtotal, currency)}`];

  const ship = [
    customer.address,
    customer.barangay,
    customer.city,
    customer.province,
    customer.postal,
  ]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");

  // Its own block, after the address — the note is usually ABOUT the delivery,
  // and an empty heading in a chat message reads as a bug.
  const noteLines = customerNote.trim()
    ? ["", "Customer note:", customerNote.trim()]
    : [];

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
    ...totalLines,
    "",
    "Customer:",
    `Name: ${customer.name}`,
    `Email: ${customer.email}`,
    `Phone: ${customer.phone}`,
    `Ship to: ${ship || "—"}`,
    ...noteLines,
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
    case "telegram": {
      // A "+"-prefixed or all-digit value is a phone number; Telegram resolves
      // those via https://t.me/+<digits>. Anything else is a @username.
      const handle = dest.replace(/^@/, "");
      if (/^\+?[\d\s().-]+$/.test(handle)) {
        return `https://t.me/+${handle.replace(/[^\d]/g, "")}`;
      }
      return `https://t.me/${handle}`;
    }
    case "messenger":
      return `https://m.me/${dest.replace(/^@/, "")}`;
    case "instagram":
      // Opens an Instagram DM thread with the store. It cannot carry a prefilled
      // message, so channelPrefills() stays false and the checkout copies the
      // order summary to the clipboard as a paste-in fallback. URL construction
      // is shared with the email support link so the two can't drift.
      return instagramDmUrl(dest);
    case "viber":
      // Viber deep links are phone-number based: viber://chat?number=<digits>.
      return `viber://chat?number=${dest.replace(/[^\d]/g, "")}`;
    case "gmail":
      // A mailto: link opens the customer's own mail app (Gmail app, Apple Mail,
      // Outlook, …) with To/Subject/Body fully prefilled, and works reliably on
      // both mobile and desktop regardless of which Google account is signed in.
      // We previously used Gmail's https web-compose URL, but a same-tab
      // top-level navigation to it races Gmail's login/account redirect, which
      // drops the compose params (customer lands on the inbox, nothing
      // prefilled), and on mobile Safari it never opens the composer at all.
      // mailto: must be fired from a fresh user gesture (the checkout shows an
      // explicit "Email your order" button for this — see CartCheckout), because
      // browsers block a mail handler invoked programmatically after async work.
      return `mailto:${dest}?subject=${encodeURIComponent("New order")}&body=${encodeURIComponent(message)}`;
  }
}

/** Whether the channel carries the message in its URL (so no clipboard hint). */
export function channelPrefills(type: ContactChannelType): boolean {
  return type === "whatsapp" || type === "gmail";
}
