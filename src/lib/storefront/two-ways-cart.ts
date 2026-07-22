// Two-ways CART rules — the add-to-cart / checkout consequences of a live
// group-buy round. Two behaviors, both keyed off the round's pricing scope:
//
//   1. PRE-ORDER STOCK EXEMPTION — a product inside the live round's scope is a
//      pre-order: the bulk supplier order is placed after the round closes, so
//      on-hand stock must not gate adding it to the cart (or checkout). Without
//      this, a round whose products carry stock 0 renders a "Join GB" button
//      that silently does nothing — the bug this module fixes.
//
//   2. NO MIXED CARTS — on-hand items ship now, group-buy items ship after the
//      round closes; one order can't do both. Adding across the split is
//      rejected at add time (the friendliest spot), and the server re-checks
//      the same rule at placement so a stale/tampered client can't mix them.
//
// Pure + JSON-safe (no React, no DB) so the storefront cart (store.tsx) and
// placeStorefrontOrderAction share one contract — the same pattern as
// checkout-rules.ts. Tested by npm run test:two-ways-cart.

import { isInGroupBuyScope, type GroupBuyPriceScope } from "./two-ways";
import type { GroupBuyBanner } from "./group-buy-banner";

/** The live round's pricing scope, derived from the storefront banner the page
 *  computed server-side. Null when no round is live — every rule below is off. */
export function gbScopeFromBanner(
  banner: GroupBuyBanner | null | undefined,
): GroupBuyPriceScope | null {
  if (!banner) return null;
  return banner.coversAll
    ? { coversAll: true, productIds: [] }
    : { coversAll: false, productIds: [...banner.productIds] };
}

/** True when the product is a group-buy PRE-ORDER (inside the live round's
 *  scope): stock is ordered from the supplier after the round closes, so the
 *  on-hand stock cap must not apply to it. */
export function isGroupBuyPreorder(
  productId: string,
  scope: GroupBuyPriceScope | null | undefined,
): boolean {
  return isInGroupBuyScope(productId, scope);
}

/** Customer-facing copy for the mixing rule, per direction of the rejected add. */
export const TWO_WAYS_MIX_MESSAGES = {
  gbIntoOnHand:
    "Group-buy items ship after the round closes, so they're ordered separately — please check out your on-hand items first.",
  onHandIntoGb:
    "On-hand items ship now and can't join a group-buy order — please check out your group-buy items first.",
} as const;

/**
 * Why adding `productId` to the current cart is rejected (mixing on-hand with
 * group-buy), or null when the add is allowed. Off when no round is live, and
 * moot when the round covers the whole catalog (everything is group-buy).
 */
export function twoWaysAddViolation(
  productId: string,
  cartProductIds: readonly string[],
  scope: GroupBuyPriceScope | null | undefined,
): string | null {
  if (!scope || scope.coversAll || cartProductIds.length === 0) return null;
  const addingGb = isGroupBuyPreorder(productId, scope);
  const cartHasGb = cartProductIds.some((id) => isGroupBuyPreorder(id, scope));
  const cartHasOnHand = cartProductIds.some((id) => !isGroupBuyPreorder(id, scope));
  if (addingGb && cartHasOnHand) return TWO_WAYS_MIX_MESSAGES.gbIntoOnHand;
  if (!addingGb && cartHasGb) return TWO_WAYS_MIX_MESSAGES.onHandIntoGb;
  return null;
}

/**
 * Server-side re-check at placement: the first mixing violation across the
 * order's lines, or null when the order stays on one path. Runs against the
 * SAME scope the attribution/re-pricing used (stampGroupBuy), so what the cart
 * blocked is exactly what checkout rejects.
 */
export function twoWaysOrderViolation(
  productIds: readonly string[],
  scope: GroupBuyPriceScope | null | undefined,
): string | null {
  if (!scope || scope.coversAll) return null;
  const hasGb = productIds.some((id) => isGroupBuyPreorder(id, scope));
  const hasOnHand = productIds.some((id) => !isGroupBuyPreorder(id, scope));
  return hasGb && hasOnHand
    ? "This order mixes group-buy and on-hand items — they ship separately, so please place them as two orders."
    : null;
}
