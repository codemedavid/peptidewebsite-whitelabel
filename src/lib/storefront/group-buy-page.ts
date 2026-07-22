// The K Glow "Group Buy" page view-model — the presentation core behind the
// dedicated group-buy route (design: "Group Buy Page.dc.html"). It composes the
// two-ways primitives (isGroupBuyProduct / groupBuyLine / slotProgress) and the
// live-round banner into everything the page renders: the round's group-buy
// products at ONE price each (the gbPrice the cart + server actually charge — no
// on-hand-vs-GB comparison shown), plus the round chrome (countdown from endsAt,
// slot-goal progress, delivery ETA). Pure + JSON-safe (no React, no DB), so it's
// trivially testable (npm run test:group-buy-page) and can drive an SSR compute.

import {
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

/** One product card on the group-buy page. `price`/`priceLabel` are the primary
 *  (group-buy) price — the same price the cart + server charge. The design also
 *  surfaces the regular price struck through and a "save ₱X" badge, so the line
 *  carries the regular price and the saving too; `hasSavings` gates the badge +
 *  strikethrough so a GB product with no valid gbPrice never shows a phantom cut. */
export type GroupBuyPageLine<T extends GbPageProduct = GbPageProduct> = {
  product: T;
  initial: string;
  /** The group-buy per-unit price (gbPrice, clamped to a valid value). */
  price: number;
  /** "₱560" — display-ready. */
  priceLabel: string;
  /** The regular / on-hand list price (product.price). */
  regularPrice: number;
  /** regularPrice − price, never negative. */
  savings: number;
  /** True only when there is a real saving (valid gbPrice below regular). */
  hasSavings: boolean;
  /** "₱700" — the regular price, shown struck through beside the GB price. */
  regularLabel: string;
  /** "₱140" — the per-unit saving, shown in the "save" badge. */
  saveLabel: string;
};

/** The sticky cart bar's running summary for the group-buy page: how many of the
 *  page's products are in the cart, the total at the GB prices, and the saving
 *  vs the regular prices. Scoped to the products shown on THIS page (the round's
 *  lines) — a cart entry for a product not on the page is ignored, so the bar's
 *  total always matches what the page advertises. */
export type GroupBuyCartSummary = {
  totalQty: number;
  /** Sum of price × qty across the page's lines. */
  total: number;
  /** Sum of regularPrice × qty — the "before" total. */
  regularTotal: number;
  /** regularTotal − total, never negative. */
  savings: number;
  totalLabel: string;
  savingsLabel: string;
  /** True when at least one of the page's products is in the cart. */
  hasItems: boolean;
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

/** Resolve one product into its group-buy card line — the GB price is primary,
 *  with the regular price + saving carried for the design's strikethrough + badge. */
function pageLine<T extends GbPageProduct>(product: T, currency: string): GroupBuyPageLine<T> {
  const line = groupBuyLine(product);
  return {
    product,
    initial: productInitial(product.name),
    price: line.gbPrice,
    priceLabel: formatGbMoney(currency, line.gbPrice),
    regularPrice: line.regularPrice,
    savings: line.savings,
    hasSavings: line.hasSavings,
    regularLabel: formatGbMoney(currency, line.regularPrice),
    saveLabel: formatGbMoney(currency, line.savings),
  };
}

/**
 * Roll the cart up into the sticky bar's summary. `qtyById` maps a product id to
 * its quantity in the cart; only ids present in `lines` (the page's products)
 * contribute, so a stray on-hand or out-of-round entry can't skew the total or
 * the advertised saving. Quantities are clamped ≥ 0 and floored. Pure + JSON-safe.
 */
export function groupBuyCartSummary<T extends GbPageProduct>(
  lines: GroupBuyPageLine<T>[],
  qtyById: Record<string, number>,
  currency: string,
): GroupBuyCartSummary {
  let totalQty = 0;
  let total = 0;
  let regularTotal = 0;
  for (const line of lines) {
    const raw = qtyById[line.product.id];
    const qty = Math.max(0, Math.floor(Number.isFinite(raw) ? raw : 0));
    if (qty <= 0) continue;
    totalQty += qty;
    total += line.price * qty;
    regularTotal += line.regularPrice * qty;
  }
  const savings = Math.max(0, regularTotal - total);
  return {
    totalQty,
    total,
    regularTotal,
    savings,
    totalLabel: formatGbMoney(currency, total),
    savingsLabel: formatGbMoney(currency, savings),
    hasItems: totalQty > 0,
  };
}

/**
 * Build the group-buy page view-model. The LIVE ROUND is the source of truth for
 * what's in the group buy — a product is listed when it's in the round's scope
 * (coversAll, or its id is in the round's assigned productIds), regardless of the
 * product's productType tag. This is the SAME membership rule the two-ways home
 * uses (buildTwoWaysHomeView), so the home and this page never disagree about
 * whether a round is open. Pricing still honours gbPrice (groupBuyLine): an
 * assigned product with a gbPrice shows its saving, an untagged one lists at its
 * regular price. A null banner (no live round) yields a not-live, empty shell the
 * page renders as its "no group buy right now" state. Order is preserved.
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
  const covered = !banner.coversAll ? new Set(banner.productIds) : null;
  const inRound = (p: T): boolean => banner.coversAll || (covered?.has(p.id) ?? false);
  const lines = products.filter(inRound).map((p) => pageLine(p, currency));
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
