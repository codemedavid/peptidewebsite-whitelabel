// The single rule for what a product's buy controls SAY and whether they work.
//
// The card and the quick-view modal used to each own a nested ternary for this,
// and they drifted: a product whose variations were ALL sold out showed an
// "Out of stock" badge, struck-through option pills, and then a live-looking
// primary button reading "Select an option" — inviting a choice the customer
// could not make. Centralising the precedence here means the two surfaces can
// only ever agree, and the wording lives in one place.
//
// Pure (no DB, no React). Covered by scripts/test-product-cta.ts.

import type { Product } from "@/storefront/types";
import { buildProductOptions, resolveSelectedPrice } from "./variations";
import { optionStock, productOutOfStock } from "./inventory";

/** Copy used by the buy controls. One place, so the card and the modal can't
 *  drift into two different words for the same state. */
export const CTA_COPY = {
  soldOut: "Sold out",
  selectOption: "Select an option",
  addToCart: "Add to Cart",
  closed: "Closed",
  messageToOrder: "Message to order",
  messageForPrice: "Message for price",
  afterGroupBuy: "Available after group buy",
  notAvailable: "Not available",
  /** The group buy is showing as a pricing reference only — either no round is
   *  running, or the owner turned ordering off while keeping the page up. Names
   *  the GROUP BUY specifically, unlike `closed` (the whole shop). */
  groupBuyClosed: "Group Buy Ordering Closed",
} as const;

export type ProductCta = {
  /** Shown in place of the price, or `null` when a real price should render. */
  priceLabel: string | null;
  /** Text on the add-to-cart button. */
  ctaLabel: string;
  /** True when the button (and the qty stepper's "+") must be inert. */
  disabled: boolean;
  /** Units available for the current selection — caps the qty stepper. */
  stock: number;
};

/**
 * Resolve the buy-control state for a product and the customer's current pick.
 *
 * `selectedIndex` is the option picker's index; < 0 means nothing picked yet
 * (the initial state of any product that has variations). A product with no
 * variations ignores it and resolves to its base price and base stock.
 *
 * Precedence, highest first:
 *
 *  0. `storeClosed` — the owner shut the whole shop (Admin → Store Status). Top
 *     of the ladder because it is the most global thing the owner can say: with
 *     the shop closed there is nothing to message about, nothing to select and
 *     no point naming a stock state. Every other branch below describes ONE
 *     product; this one describes the business.
 *  1. `priceOnRequest` — on hand but unpriced; the customer messages the store.
 *  2. `purchasable === false` — the owner paused THIS product (Group Buys →
 *     Pricing). Above the gate and sold-out because both of those clear on their
 *     own: a round closes, stock arrives, and a product the owner deliberately
 *     took off sale would quietly go back on it. Below price-on-request, which
 *     is also owner-set but says something more specific about the price.
 *  3. `gbBlocked` — the owner paused on-hand selling while a group buy is live.
 *     Kept above "sold out" so the on-hand gate's message is never masked by an
 *     inventory state that stops mattering once the run closes.
 *  4. Every option exhausted — "Sold out". This is the case the old ternaries
 *     got wrong: it must beat "Select an option", because there is nothing left
 *     to select.
 *  5. Nothing picked yet — "Select an option".
 *  6. The picked option is exhausted — "Sold out", but the price the customer
 *     just revealed stays on screen so they can compare it with the option they
 *     switch to.
 *  7. Otherwise — buyable.
 */
export function buildProductCta(
  product: Product,
  selectedIndex: number,
  opts: { gbBlocked?: boolean; storeClosed?: boolean } = {},
): ProductCta {
  const options = buildProductOptions(product);
  const selected =
    selectedIndex >= 0 && selectedIndex < options.length
      ? options[selectedIndex]
      : null;
  const stock = selected
    ? optionStock(product, selected)
    : Math.max(0, product.stock || 0);

  // The shop itself is shut. The price stays on screen — the catalog is still
  // browsable by design, and a shopper deciding whether to come back needs to
  // see what things cost. Only the buying stops.
  if (opts.storeClosed) {
    return {
      priceLabel: null,
      ctaLabel: CTA_COPY.closed,
      disabled: true,
      stock,
    };
  }

  if (product.priceOnRequest === true) {
    return {
      priceLabel: CTA_COPY.messageForPrice,
      ctaLabel: CTA_COPY.messageToOrder,
      disabled: true,
      stock,
    };
  }

  // null = has options but none picked yet → show a prompt, not a price.
  const price = resolveSelectedPrice(product, selectedIndex);
  const needsSelection = price === null;

  // The owner took this product off sale but left it listed. The price stays on
  // screen (it is paused, not unpriced) — unless options exist and none is
  // picked, where there is no single price to show yet.
  if (product.purchasable === false) {
    return {
      priceLabel: needsSelection ? CTA_COPY.selectOption : null,
      ctaLabel: CTA_COPY.notAvailable,
      disabled: true,
      stock,
    };
  }

  if (opts.gbBlocked) {
    return {
      priceLabel: needsSelection ? CTA_COPY.selectOption : null,
      ctaLabel: CTA_COPY.afterGroupBuy,
      disabled: true,
      stock,
    };
  }

  if (productOutOfStock(product)) {
    return {
      priceLabel: CTA_COPY.soldOut,
      ctaLabel: CTA_COPY.soldOut,
      disabled: true,
      stock: 0,
    };
  }

  if (needsSelection) {
    return {
      priceLabel: CTA_COPY.selectOption,
      ctaLabel: CTA_COPY.selectOption,
      disabled: true,
      stock,
    };
  }

  if (stock <= 0) {
    return {
      priceLabel: null,
      ctaLabel: CTA_COPY.soldOut,
      disabled: true,
      stock: 0,
    };
  }

  return { priceLabel: null, ctaLabel: CTA_COPY.addToCart, disabled: false, stock };
}
