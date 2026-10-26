// Group-buy MOQ + vials-per-kit — two owner settings for group-buy-only stores.
//
//   MOQ (GroupBuy.moqVials) — set once when the owner opens a round, and the
//     same for every product in it: each CUSTOMER ORDER placed in the round
//     must carry at least this many group-buy vials. Replaces the round-level
//     Minimum / Maximum vials on group-buy-only stores, which measured the whole
//     round and so could not say anything about a single product's kit.
//
//   Vials per kit (product metadata.vialsPerKit) — how many vials the supplier
//     packs in one kit of THIS product. Kits differ per product, which is why it
//     lives on the product, not the round. Drives the shopper-facing "7 of 10
//     vials" kit progress and the supplier report's kits-to-order column.
//
// Pure + JSON-safe so the cart (CartCheckout) and placeStorefrontOrderAction
// share one contract. Tested by npm run test:gb-moq-kits.

import type { GroupBuyBanner } from "./group-buy-banner";
import type { GroupBuyPriceScope } from "./two-ways";
import { gbScopeFromBanner, isGroupBuyPreorder, type PreorderProduct } from "./two-ways-cart";

/** Largest kit size accepted — a typo guard, not a business rule. */
const MAX_VIALS_PER_KIT = 1000;

/** A cart / order line as the MOQ rule reads it. */
export type MoqLine = PreorderProduct & { qty: number };

/**
 * Why this order is below the live round's per-customer MOQ, or null when it
 * passes. Only lines inside the round count (the same pre-order membership the
 * stock exemption uses), summed across products; an order with no group-buy
 * lines at all is not this rule's business.
 */
export function groupBuyMoqViolation(
  lines: readonly MoqLine[],
  scope: GroupBuyPriceScope | null | undefined,
  moqVials: number | null | undefined,
): string | null {
  if (!scope || !moqVials || moqVials <= 0) return null;
  const vials = lines
    .filter((line) => isGroupBuyPreorder(line, scope))
    .reduce((sum, line) => sum + Math.max(0, line.qty), 0);
  if (vials === 0 || vials >= moqVials) return null;
  const more = moqVials - vials;
  return `This group buy has a minimum order of ${moqVials} vials — add ${more} more to check out.`;
}

export type KitProgress = {
  /** Vials in the kit currently filling (a just-completed kit reads as full). */
  inKit: number;
  perKit: number;
  /** Vials still needed to complete that kit. 0 = it is complete. */
  remaining: number;
  /** Kits completed so far. */
  fullKits: number;
};

/** Where a product's round demand sits against its kit size, or null when the
 *  product has no vials-per-kit set. */
export function kitProgress(
  totalVials: number,
  vialsPerKit: number | null | undefined,
): KitProgress | null {
  if (!vialsPerKit || vialsPerKit <= 0) return null;
  const total = Math.max(0, Math.floor(totalVials));
  const fullKits = Math.floor(total / vialsPerKit);
  const rest = total % vialsPerKit;
  // An exact multiple shows the kit it just completed, not an empty next one.
  const inKit = rest === 0 && total > 0 ? vialsPerKit : rest;
  return { inKit, perKit: vialsPerKit, remaining: vialsPerKit - inKit, fullKits };
}

/** The shopper-facing kit progress for one product: only while a round is live,
 *  only for a product inside it, and only when the owner set a kit size. */
export function roundKitProgress(
  product: PreorderProduct & { vialsPerKit?: number },
  banner: GroupBuyBanner | null | undefined,
): KitProgress | null {
  if (!banner || !product.vialsPerKit) return null;
  if (!isGroupBuyPreorder(product, gbScopeFromBanner(banner))) return null;
  return kitProgress(banner.kitVials?.[product.id] ?? 0, product.vialsPerKit);
}

/** Whole kits to order from the supplier for `vials` of demand, and how many
 *  vials short the last kit is (0 = every kit is full). Null without a kit size. */
export function kitsToOrder(
  vials: number,
  vialsPerKit: number | null | undefined,
): { kits: number; shortBy: number } | null {
  if (!vialsPerKit || vialsPerKit <= 0) return null;
  const total = Math.max(0, Math.floor(vials));
  const kits = Math.ceil(total / vialsPerKit);
  return { kits, shortBy: kits * vialsPerKit - total };
}

/** Round demand in vials per product id, from the round's orders' line items
 *  (StorefrontOrder.items JSON — untrusted shape). Variations share their
 *  product's id, so every dose fills the same kit. */
export function tallyKitVials(
  orders: readonly { items: unknown }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const order of orders) {
    if (!Array.isArray(order.items)) continue;
    for (const raw of order.items) {
      const item = (raw ?? {}) as { productId?: unknown; qty?: unknown };
      const id = typeof item.productId === "string" ? item.productId : "";
      const qty = Math.floor(Number(item.qty));
      if (!id || !Number.isFinite(qty) || qty <= 0) continue;
      out[id] = (out[id] ?? 0) + qty;
    }
  }
  return out;
}

/** Kit columns for one supplier-report row: null when its product has no kit
 *  size (or the line predates productIds). */
export type KitColumns = {
  vialsPerKit: number | null;
  kits: number | null;
  shortBy: number | null;
};

/** Decorate supplier "Products to Order" rows with kits to order and how short
 *  the last kit is, from product id → vials per kit. Returns new rows. */
export function withKitColumns<R extends { productId: string | null; vials: number }>(
  rows: readonly R[],
  kitSizes: Readonly<Record<string, number>>,
): Array<R & KitColumns> {
  return rows.map((row) => {
    const perKit = row.productId ? kitSizes[row.productId] : undefined;
    const kit = kitsToOrder(row.vials, perKit);
    return {
      ...row,
      vialsPerKit: kit ? (perKit as number) : null,
      kits: kit?.kits ?? null,
      shortBy: kit?.shortBy ?? null,
    };
  });
}

/** Untrusted vials-per-kit → a positive whole number, or undefined (not set). */
export function normalizeVialsPerKit(raw: unknown): number | undefined {
  const n = typeof raw === "string" ? Number(raw.trim() || NaN) : Number(raw);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.min(MAX_VIALS_PER_KIT, Math.floor(n));
}
