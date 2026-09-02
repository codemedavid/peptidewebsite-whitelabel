// Made-to-order products — items manufactured AFTER the order is placed, so
// there is no inventory to count and no stock gate to pass.
//
// Why this exists: tenant `mstomato` sells vial cases and caps in up to 81
// colourways each, all produced per order. Every one of its products therefore
// carried stock = 0, which the inventory gate correctly read as "sold out" —
// badge, CTA, option pills, add-to-cart, cart drawer and the server-side
// placement guard all fired, and the storefront could not take a single order.
//
// The rule is not new. `isGroupBuyPreorder` already exempts group-buy lines for
// exactly the same reason: the supplier order goes out after the round closes,
// so on-hand units say nothing about whether the item can be sold. Made-to-order
// is that same statement made permanent and per-product, so it resolves through
// the ONE number every gate already shares — see effectiveStock in ./inventory,
// which answers Infinity here.
//
// Pure (no DB, no React). Covered by scripts/test-made-to-order.ts.

import type { Product } from "@/storefront/types";

/** The badge the catalog card shows where an out-of-stock item would show
 *  "Out of stock". One place, so the card and any future surface agree. */
export const MADE_TO_ORDER_LABEL = "Made to order";

/** Just the field the rule reads — structural so a DB row, a cart entry or a
 *  two-ways shelf item can be judged without inflating it into a full Product. */
type MadeToOrderSource = { madeToOrder?: boolean };

/**
 * Whether this product is manufactured per order (and so never stock-gated).
 *
 * Only an explicit `true` counts. `undefined` is the overwhelmingly common case
 * — every product of every other tenant — and must read as "stocked", never as
 * "unknown, allow it".
 */
export function isMadeToOrder(
  product: MadeToOrderSource | null | undefined,
): boolean {
  return product?.madeToOrder === true;
}

/**
 * Drop the flag from a catalog the tenant is not entitled to use — the same
 * fail-closed shape as `stripResellerPricing`.
 *
 * The flag lives in product metadata, which survives a feature being revoked
 * (deliberately: the owner's data is theirs). Without this strip, revoking the
 * feature would leave every marked product still bypassing its own inventory.
 * Applied at render (page.tsx) AND again at placement (orders.ts), because the
 * second is the boundary a stale tab or a hand-rolled request has to clear.
 *
 * Immutable, and returns the ORIGINAL array when there is nothing to strip so
 * an entitled tenant pays nothing for the check.
 */
export function stripMadeToOrder(products: Product[], entitled: boolean): Product[] {
  if (entitled) return products;
  if (!products.some((p) => p.madeToOrder != null)) return products;
  return products.map((p) => {
    if (p.madeToOrder == null) return p;
    const next = { ...p };
    delete next.madeToOrder;
    return next;
  });
}
