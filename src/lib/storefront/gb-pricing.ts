// Group Buy Pricing — the pure layer behind the store admin's Group Buys →
// Pricing tab, where the owner manages what each product costs INSIDE a group
// buy without going through the full product editor.
//
// The tab lists the whole catalog (not just the tagged products) so promoting a
// product into the group buy is one click on the row it already occupies. Four
// operations, all returning new objects — nothing here mutates its input:
//
//   applyGbPrice        set/replace the group-buy price (and tag it "gb")
//   removeFromGroupBuy  retire it: untag, clear the price, drop it from rounds
//   setPurchasable      pause / resume without unlisting the product
//   gbPriceError        reject a price before any of that is stored
//
// Pure (no `server-only`, no Prisma, no React) so the server action, the admin
// component and the test can all share one implementation.
// Covered by scripts/test-gb-pricing.ts.

import type { Product } from "@/storefront/types";
import { groupBuyLine } from "./two-ways";
import { formatGbMoney } from "./group-buy-page";
import type { GroupBuy } from "./group-buy";

/** One row of the pricing tab: a catalog product with its two prices resolved. */
export type GbPricingRow = {
  product: Product;
  /** Tagged as a group-buy listing (`productType === "gb"`). */
  isGroupBuy: boolean;
  /** The on-hand / list price. */
  regularPrice: number;
  /** What the group buy charges — equals regularPrice when no valid GB price is
   *  set, mirroring groupBuyLine so the admin never shows a price the storefront
   *  would not honour. */
  gbPrice: number;
  /** regularPrice − gbPrice, never negative. */
  savings: number;
  hasSavings: boolean;
  regularLabel: string;
  gbLabel: string;
  savingsLabel: string;
  /** Names of the non-archived rounds that carry this product. */
  roundNames: string[];
  /** False = paused: still listed, but not orderable (`purchasable === false`). */
  available: boolean;
};

/**
 * Which rounds carry `productId`. Archived rounds are history and never claim a
 * product. A round with an EMPTY productIds list covers the whole catalog —
 * the same rule buildGroupBuyGate and groupBuyForOrder apply — so it claims
 * every product rather than none.
 */
function roundsCarrying(productId: string, rounds: readonly GroupBuy[]): string[] {
  return rounds
    .filter((gb) => gb.status !== "archived")
    .filter((gb) => gb.productIds.length === 0 || gb.productIds.includes(productId))
    .map((gb) => gb.name);
}

/**
 * Build the pricing tab's view model over the WHOLE catalog, preserving order so
 * the tab reads in the same sequence as the Products screen. Pricing is resolved
 * through `groupBuyLine` — the storefront's own rule — so the number the owner
 * sees here is exactly the number the cart and the server will charge.
 */
export function buildGbPricingRows(
  products: readonly Product[],
  rounds: readonly GroupBuy[],
  currency: string,
): GbPricingRow[] {
  return products.map((product) => {
    const line = groupBuyLine(product);
    return {
      product,
      isGroupBuy: product.productType === "gb",
      regularPrice: line.regularPrice,
      gbPrice: line.gbPrice,
      savings: line.savings,
      hasSavings: line.hasSavings,
      regularLabel: formatGbMoney(currency, line.regularPrice),
      gbLabel: formatGbMoney(currency, line.gbPrice),
      savingsLabel: formatGbMoney(currency, line.savings),
      roundNames: roundsCarrying(product.id, rounds),
      available: product.purchasable !== false,
    };
  });
}

/**
 * Why a group-buy price can't be stored, or null when it is fine.
 *
 * A GB price only exists to be LOWER than the regular price: `groupBuyLine`
 * silently falls back to the regular price when it isn't, so storing one at or
 * above list would look saved but advertise a saving of zero — a phantom
 * discount the owner has no way to see. Rejecting here is the only place that
 * distinction is ever visible to them.
 */
export function gbPriceError(product: Product, next: number): string | null {
  if (!Number.isFinite(next)) return "Enter a group-buy price.";
  if (next <= 0) return "The group-buy price has to be more than 0.";
  const regular = Math.max(0, product.price || 0);
  if (next >= regular) {
    return `The group-buy price (${next.toLocaleString()}) has to be below the regular price (${regular.toLocaleString()}) — otherwise the storefront shows no saving.`;
  }
  return null;
}

/**
 * Set (or replace) a product's group-buy price and tag it as a group-buy
 * listing. Validate with `gbPriceError` first — this stores what it is given, so
 * the caller owns the error message.
 */
export function applyGbPrice(product: Product, price: number): Product {
  return { ...product, productType: "gb", gbPrice: price };
}

/** What removing a product from the group buy implies. */
export type GbRemoval = {
  /** The untagged product — still in the catalog, at its regular price. */
  product: Product;
  /** Rounds whose assignment has to be rewritten, with their new productIds. */
  roundUpdates: { id: string; productIds: string[] }[];
  /** True when some round is left with NO assigned products. Empty productIds
   *  reads as "covers the whole catalog" everywhere else, so the caller must
   *  warn rather than let a round silently widen from one product to all. */
  emptiesRound: boolean;
};

/**
 * Retire a product from the group buy WITHOUT deleting it: clear the "gb" tag
 * and its GB price, and drop its id from every round that lists it. The catalog
 * row, its regular price, its stock and its images are untouched — the product
 * simply goes back to being an ordinary on-hand item.
 *
 * Rounds with an empty assignment already cover the whole catalog; there is no
 * id to strip, and adding entries would narrow the round instead of leaving it
 * alone, so they are skipped.
 */
export function removeFromGroupBuy(
  product: Product,
  rounds: readonly GroupBuy[] = [],
): GbRemoval {
  const roundUpdates = rounds
    .filter((gb) => gb.productIds.length > 0 && gb.productIds.includes(product.id))
    .map((gb) => ({
      id: gb.id,
      productIds: gb.productIds.filter((id) => id !== product.id),
    }));
  return {
    product: { ...product, productType: "onhand", gbPrice: 0 },
    roundUpdates,
    emptiesRound: roundUpdates.some((u) => u.productIds.length === 0),
  };
}

/**
 * Pause or resume a product. Pausing keeps it LISTED — the storefront still
 * shows it and its price — but blocks the buy controls (product-cta), the cart
 * (store.addToCart) and order placement (orders.purchasableViolation). Distinct
 * from `available: false`, which hides the product from the storefront entirely.
 * The group-buy price is left intact so resuming restores the original offer.
 */
export function setPurchasable(product: Product, next: boolean): Product {
  return { ...product, purchasable: next };
}
