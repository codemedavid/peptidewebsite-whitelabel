// Storefront-facing presentation of the live Group Buy round: the banner shown
// above the catalog and the "Explore GB #N" scope filter. Pure + JSON-safe so
// page.tsx can compute it server-side and the client just renders. Distinct from
// GroupBuyStorefrontGate (group-buy.ts), which is the security/cart concern —
// this is purely display + an optional catalog filter, and can't change what a
// visitor is allowed to buy.

import {
  liveGroupBuys,
  type GroupBuy,
  type GroupBuyCapabilities,
} from "./group-buy";

/** Public banner for the (at most one) live round, or null when nothing is live. */
export type GroupBuyBanner = {
  id: string;
  name: string; // free-text label the owner set — "GB #5", "Holiday Round"
  description: string;
  deliveryEta: string; // customer-facing, e.g. "3–4 weeks after close"
  productIds: string[]; // products in the run (empty when coversAll)
  coversAll: boolean; // the whole catalog IS the run → the scope toggle is a no-op
};

/**
 * Build the banner for the current live round. coversAll is true when the round
 * has no product assignment, or the tenant lacks the productAssignment capability
 * — in both cases every product is part of the run, so there's nothing to scope
 * to and the UI hides the "Explore" toggle.
 */
export function buildGroupBuyBanner(
  list: GroupBuy[],
  caps: Pick<GroupBuyCapabilities, "scheduled" | "productAssignment">,
  now: Date = new Date(),
): GroupBuyBanner | null {
  const live = liveGroupBuys(list, caps, now);
  const gb = live[0];
  if (!gb) return null;

  const coversAll = !caps.productAssignment || gb.productIds.length === 0;
  return {
    id: gb.id,
    name: gb.name,
    description: gb.description,
    deliveryEta: gb.deliveryEta,
    productIds: coversAll ? [] : [...gb.productIds],
    coversAll,
  };
}

/**
 * The catalog a visitor sees given the "Explore GB #N" toggle. The toggle
 * DEFAULTS OFF, so the normal state is the full catalog. It only narrows the view
 * when a scoped (assigned) round is live and the visitor opts in — it never
 * restricts what can be bought (that's the on-hand gate's job), just what's shown.
 * A no-op when there's no live banner or the round covers the whole catalog.
 */
export function scopedCatalog<T extends { id: string }>(
  products: T[],
  banner: GroupBuyBanner | null,
  scopeOn: boolean,
): T[] {
  if (!scopeOn || !banner || banner.coversAll) return products;
  const covered = new Set(banner.productIds);
  return products.filter((p) => covered.has(p.id));
}
