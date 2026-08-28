// The per-product SALE — one rule for when a discount is real, what it costs,
// and how a browsing surface advertises it.
//
// WHY (store owner, 2026-08-28): "yung mga naka sale na products di lumalabas
// agad… tska lang malaman na sale siya pag nasa cart na". A product the owner
// marked down looked identical to every other card. The catalog, the quick-view
// modal and the two-ways shelf all printed `product.price`, while only
// checkout's unitPrice consulted `discountPrice` — so HP Glow's Retatrutide 30mg
// advertised ₱4,299 and charged ₱3,899. The shopper discovered the saving at the
// exact moment it had stopped being able to sell them anything.
//
// The invariant this module exists to hold: THE PRICE ON SCREEN IS THE PRICE THE
// CART CHARGES. checkout.ts and wholesale.ts price from `effectiveBasePrice`,
// and every browsing surface renders `resolveSaleView` — one function, so the
// two can no longer drift apart.
//
// WHAT COUNTS AS A SALE is deliberately stricter than the old inline ternary
// (`discountEnabled && typeof discountPrice === "number"`). The product editor
// saves the toggle with an empty price as `Number("") || 0`, and that ternary
// read a blank field as a ₱0 sale — the storefront would have advertised, and
// the cart charged, nothing at all. A discount must be a positive number BELOW
// the list price to be real; anything else falls back to the list price, which
// is the only safe direction to err.
//
// Distinct from ./promo, which is whole-cart discount CODES the shopper types in.
//
// Pure (no React, no DB) so the storefront, the store admin and the server share
// one contract. Covered by npm run test:sale-price.

import { buildProductOptions, type Variation } from "./variations";

/** Just the fields the sale rules read — keeps this module free of the full
 *  storefront `Product` type (and its import cycle back into components). */
export type SaleSource = {
  price: number;
  discountEnabled?: boolean;
  discountPrice?: number | null;
  variations?: Variation[];
};

/** The marked-down price if this product is genuinely on sale, else null. */
function activeDiscount(p: SaleSource): number | null {
  if (p.discountEnabled !== true) return null;
  const discount = Number(p.discountPrice);
  const list = Number(p.price);
  if (!Number.isFinite(discount) || !Number.isFinite(list)) return null;
  // Positive (an unset field is not a free product) and a real markdown (a
  // "discount" at or above list would raise the price, never a sale).
  if (discount <= 0 || discount >= list) return null;
  return discount;
}

/** Is a real markdown running on this product's base price right now? */
export function isDiscountActive(p: SaleSource): boolean {
  return activeDiscount(p) !== null;
}

/**
 * The non-bulk, non-group-buy price of one unit of the BASE product: the active
 * markdown, else the list price. This is what checkout charges before wholesale
 * and group-buy rules get their turn, and what the catalog must therefore show.
 */
export function effectiveBasePrice(p: SaleSource): number {
  return activeDiscount(p) ?? p.price;
}

/** Whole percent saved, rounded — 2000 → 1500 is "25". 0 when nothing is off. */
export function percentOff(list: number, price: number): number {
  if (!Number.isFinite(list) || list <= 0 || !Number.isFinite(price)) return 0;
  if (price >= list) return 0;
  return Math.round(((list - price) / list) * 100);
}

/** Badge copy. A markdown too small to round to a percent still says something —
 *  "0% off" would read as a bug to the shopper. */
export function saleBadgeLabel(percent: number): string {
  return percent >= 1 ? `${percent}% off` : "Sale";
}

/** What a browsing surface renders for the customer's current selection. */
export type SaleView = {
  /** The price of one unit — the same number checkout charges. `null` when the
   *  product has options and none is picked yet (the reveal-on-click rule). */
  price: number | null;
  /** The list price this was marked down FROM, for the struck-through figure.
   *  `null` whenever nothing is on sale, so a surface can render it blindly. */
  compareAt: number | null;
  /** Whole percent saved; 0 when not on sale. */
  percentOff: number;
  onSale: boolean;
  /** Badge copy ("25% off"), or `null` when there is no sale to badge. */
  badgeLabel: string | null;
};

const NO_SALE = (price: number | null): SaleView => ({
  price,
  compareAt: null,
  percentOff: 0,
  onSale: false,
  badgeLabel: null,
});

/**
 * Resolve the price + sale treatment for a product and the customer's pick.
 *
 * `selectedIndex` is the option picker's index; < 0 (or past the end) means
 * nothing picked. A product with no variations ignores it entirely and shows its
 * price — and its sale — immediately, which is the whole point of the fix.
 *
 * THE MARKDOWN BELONGS TO THE BASE PRICE, and only to it. A chosen variation is
 * cloned into the cart by checkout's makeVariationEntry, which deliberately
 * clears `discountEnabled`/`discountPrice` (a variation carries its own price,
 * so a base-product promo was never meant for it). Advertising a saving on a
 * variation would therefore advertise a price the cart refuses to charge — the
 * very bug this module exists to close, pointed the other way. So the sale shows
 * on a single-price product and on the "Standard" base option, and nowhere else.
 */
export function resolveSaleView(p: SaleSource, selectedIndex: number): SaleView {
  const options = buildProductOptions(p);

  if (options.length === 0) {
    // No picker: the base price is the only price, so the sale applies and shows
    // straight away.
    const discount = activeDiscount(p);
    if (discount === null) return NO_SALE(p.price);
    const percent = percentOff(p.price, discount);
    return {
      price: discount,
      compareAt: p.price,
      percentOff: percent,
      onSale: true,
      badgeLabel: saleBadgeLabel(percent),
    };
  }

  const selected =
    selectedIndex >= 0 && selectedIndex < options.length ? options[selectedIndex] : null;
  if (!selected) return NO_SALE(null);

  // A real variation prices itself; only the base ("Standard") option carries the
  // product's markdown.
  if (selected.variation) return NO_SALE(selected.price);

  const discount = activeDiscount(p);
  if (discount === null) return NO_SALE(selected.price);
  const percent = percentOff(selected.price, discount);
  return {
    price: discount,
    compareAt: selected.price,
    percentOff: percent,
    onSale: true,
    badgeLabel: saleBadgeLabel(percent),
  };
}
