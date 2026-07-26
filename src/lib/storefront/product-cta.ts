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
  messageToOrder: "Message to order",
  messageForPrice: "Message for price",
  afterGroupBuy: "Available after group buy",
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
 *  1. `priceOnRequest` — on hand but unpriced; the customer messages the store.
 *  2. `gbBlocked` — the owner paused on-hand selling while a group buy is live.
 *     Kept above "sold out" so the on-hand gate's message is never masked by an
 *     inventory state that stops mattering once the run closes.
 *  3. Every option exhausted — "Sold out". This is the case the old ternaries
 *     got wrong: it must beat "Select an option", because there is nothing left
 *     to select.
 *  4. Nothing picked yet — "Select an option".
 *  5. The picked option is exhausted — "Sold out", but the price the customer
 *     just revealed stays on screen so they can compare it with the option they
 *     switch to.
 *  6. Otherwise — buyable.
 */
export function buildProductCta(
  product: Product,
  selectedIndex: number,
  opts: { gbBlocked?: boolean } = {},
): ProductCta {
  const options = buildProductOptions(product);
  const selected =
    selectedIndex >= 0 && selectedIndex < options.length
      ? options[selectedIndex]
      : null;
  const stock = selected
    ? optionStock(product, selected)
    : Math.max(0, product.stock || 0);

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
