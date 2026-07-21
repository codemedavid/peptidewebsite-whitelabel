// The K Glow "Group Buy" page view-model — the presentation core behind the
// dedicated group-buy route (design: "Group Buy Page.dc.html"). It composes the
// two-ways primitives (isGroupBuyProduct / groupBuyLine / slotProgress) and the
// live-round banner into everything the page renders: the round's group-buy
// products at ONE price each (the gbPrice the cart + server actually charge — no
// on-hand-vs-GB comparison shown), plus the round chrome (countdown from endsAt,
// slot-goal progress, delivery ETA). Pure + JSON-safe (no React, no DB), so it's
// trivially testable (npm run test:group-buy-page) and can drive an SSR compute.

import {
  isGroupBuyProduct,
  groupBuyLine,
  slotProgress,
  type SlotProgress,
  type TwoWaysInput,
} from "./two-ways";
import type { GroupBuyBanner } from "./group-buy-banner";

const DAY_MS = 86_400_000;

/** The round's countdown pill — "Closes in 5 days" from endsAt. Empty string for
 *  an open-ended round (no endsAt) or an unparseable date; "Closed" once the
 *  close boundary has passed. Days are rounded UP, so any time left in the final
 *  24 h still reads "Closes in 1 day" rather than prematurely "Closed". */
export function gbCountdownLabel(
  endsAt: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!endsAt) return "";
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return "";
  const diff = end - now.getTime();
  if (diff <= 0) return "Closed";
  const days = Math.ceil(diff / DAY_MS);
  return days === 1 ? "Closes in 1 day" : `Closes in ${days} days`;
}

/** The card's monogram tile: the first non-space letter of the name, uppercased.
 *  Falls back to a neutral bullet when the name is empty/blank. */
export function productInitial(name: string): string {
  const ch = (name || "").trim().charAt(0);
  return ch ? ch.toUpperCase() : "•";
}

/** "₱1,200" — the currency glyph + grouped amount, matching the catalog card.
 *  Negative amounts (never expected, but guarded) render as the zero baseline. */
export function formatGbMoney(currency: string, amount: number): string {
  return `${currency}${Math.max(0, amount || 0).toLocaleString()}`;
}

/** The minimal product shape the page reads. Generic so the caller keeps its own
 *  concrete Product type through the view (id/name/image for the card). */
export type GbPageProduct = TwoWaysInput & {
  id: string;
  name: string;
  image?: string | null;
};

/** One product card on the group-buy page: the product, its monogram, and the
 *  single (group-buy) price shown — the same price the cart + server charge. */
export type GroupBuyPageLine<T extends GbPageProduct = GbPageProduct> = {
  product: T;
  initial: string;
  /** The group-buy per-unit price (gbPrice, clamped to a valid value). */
  price: number;
  /** "₱560" — display-ready. */
  priceLabel: string;
};

/** The full page view-model for a live round (or an empty, not-live shell). */
export type GroupBuyPageView<T extends GbPageProduct = GbPageProduct> = {
  live: boolean;
  name: string;
  description: string;
  deliveryEta: string;
  countdown: string;
  slots: SlotProgress;
  count: number;
  lines: GroupBuyPageLine<T>[];
};

/** Resolve one product into its group-buy card line. */
function pageLine<T extends GbPageProduct>(product: T, currency: string): GroupBuyPageLine<T> {
  const price = groupBuyLine(product).gbPrice;
  return {
    product,
    initial: productInitial(product.name),
    price,
    priceLabel: formatGbMoney(currency, price),
  };
}

/**
 * Build the group-buy page view-model. Lists only the round's GROUP-BUY products
 * (productType "gb"): when the round assigns a product subset (coversAll false)
 * the list is narrowed to those ids; otherwise every GB product in the catalog is
 * shown. On-hand products never appear here — this is the group-buy path. A null
 * banner (no live round) yields a not-live, empty shell the page renders as its
 * "no group buy right now" state. Order within each path is preserved.
 */
export function buildGroupBuyPageView<T extends GbPageProduct>(
  products: T[],
  banner: GroupBuyBanner | null,
  currency: string,
  now: Date = new Date(),
): GroupBuyPageView<T> {
  if (!banner) {
    return {
      live: false,
      name: "",
      description: "",
      deliveryEta: "",
      countdown: "",
      slots: slotProgress(0, 0),
      count: 0,
      lines: [],
    };
  }
  let gbProducts = products.filter(isGroupBuyProduct);
  if (!banner.coversAll) {
    const covered = new Set(banner.productIds);
    gbProducts = gbProducts.filter((p) => covered.has(p.id));
  }
  const lines = gbProducts.map((p) => pageLine(p, currency));
  return {
    live: true,
    name: banner.name,
    description: banner.description,
    deliveryEta: banner.deliveryEta,
    countdown: gbCountdownLabel(banner.endsAt, now),
    slots: slotProgress(banner.slotGoal, banner.filled),
    count: lines.length,
    lines,
  };
}
