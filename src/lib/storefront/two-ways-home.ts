// "Two ways to order" HOME view-model — the presentation core behind the
// storefront home layout (design: "K Glow Store.dc.html"). It composes the
// tested two-ways primitives (splitTwoWays / groupBuyLine / slotProgress) and the
// group-buy-page helpers (countdown / initial / money) into everything the home
// renders: the ON-HAND product list (ships now) and the GROUP BUY card (the live
// round's group-buy products at their gbPrice, with the on-hand-vs-GB saving
// surfaced — the "two ways" contrast). Distinct from group-buy-page.ts, which is
// the dedicated #groupbuy route showing ONE price per item. Pure + JSON-safe (no
// React, no DB), so it drives an SSR compute and is trivially testable
// (npm run test:two-ways-home).

import {
  groupBuyLine,
  slotProgress,
  type SlotProgress,
  type TwoWaysInput,
} from "./two-ways";
import { gbCountdownLabel, productInitial, formatGbMoney } from "./group-buy-page";
import type { GroupBuyBanner } from "./group-buy-banner";

/** The minimal product shape the home reads. Generic so the caller keeps its own
 *  concrete Product type through the view (id/name/image/stock for the rows). */
export type TwhProduct = TwoWaysInput & {
  id: string;
  name: string;
  image?: string | null;
  stock?: number;
};

/** One on-hand ("ships now") product row. */
export type OnHandLine<T extends TwhProduct = TwhProduct> = {
  product: T;
  initial: string;
  price: number;
  priceLabel: string;
  /** True when stock is unknown (undefined) or positive — mirrors the catalog's
   *  "in stock" treatment (absent stock is not a sold-out signal). */
  inStock: boolean;
  /** "12 in stock" — empty string when the product carries no stock number. */
  stockLabel: string;
};

/** One group-buy card row: the product with its regular vs gb price + saving. */
export type GbHomeLine<T extends TwhProduct = TwhProduct> = {
  product: T;
  initial: string;
  regularPrice: number;
  gbPrice: number;
  savings: number;
  hasSavings: boolean;
  regularLabel: string;
  gbLabel: string;
  saveLabel: string;
};

/** The full home view-model: the two order paths and the live-round chrome. */
export type TwoWaysHomeView<T extends TwhProduct = TwhProduct> = {
  onHand: { count: number; lines: OnHandLine<T>[] };
  gb: {
    /** A round is live (banner present). The GB section renders when open && count > 0. */
    open: boolean;
    name: string;
    deliveryEta: string;
    countdown: string;
    slots: SlotProgress;
    count: number;
    lines: GbHomeLine<T>[];
  };
};

/**
 * Resolve the effective home layout. The operator entitlement (Super Admin →
 * Features → Group Buy → "Two ways to order" home) is the ONLY way in — the
 * feature is sold per tenant (catalog.ts: operator-grantable, default OFF), so
 * the owner-writable branding.config.homeLayout must never self-enable it.
 * Config can only opt OUT: an explicit "classic" wins even while the grant is
 * on. Unentitled (whatever the config says) → the classic hero → catalog home.
 */
export function resolveHomeLayout(
  entitled: boolean,
  configLayout: string | undefined | null,
): "classic" | "two-ways" {
  if (!entitled) return "classic";
  return configLayout === "classic" ? "classic" : "two-ways";
}

/**
 * Where the live group-buy CTA (and the "Open now" way card) on the two-ways home
 * should take the shopper. Both point at the dedicated group-buy page so a click
 * lands on the open round — but once the cart has items the CTA instead reviews
 * them ("checkout", i.e. open the cart), so a mid-shop click doesn't bounce the
 * shopper away from their cart. A non-positive / non-finite count reads as empty.
 */
export function groupBuyCtaTarget(cartCount: number): "groupbuy" | "checkout" {
  return Number.isFinite(cartCount) && cartCount > 0 ? "checkout" : "groupbuy";
}

function onHandLine<T extends TwhProduct>(product: T, currency: string): OnHandLine<T> {
  const price = Math.max(0, product.price || 0);
  const hasStock = typeof product.stock === "number" && Number.isFinite(product.stock);
  const stock = hasStock ? Math.max(0, Math.floor(product.stock as number)) : undefined;
  return {
    product,
    initial: productInitial(product.name),
    price,
    priceLabel: formatGbMoney(currency, price),
    inStock: stock === undefined ? true : stock > 0,
    stockLabel: stock === undefined ? "" : `${stock} in stock`,
  };
}

function gbHomeLine<T extends TwhProduct>(product: T, currency: string): GbHomeLine<T> {
  const line = groupBuyLine(product);
  return {
    product,
    initial: productInitial(product.name),
    regularPrice: line.regularPrice,
    gbPrice: line.gbPrice,
    savings: line.savings,
    hasSavings: line.hasSavings,
    regularLabel: formatGbMoney(currency, line.regularPrice),
    gbLabel: formatGbMoney(currency, line.gbPrice),
    saveLabel: formatGbMoney(currency, line.savings),
  };
}

/**
 * Build the home view-model. The LIVE ROUND is the source of truth for what's in
 * the group buy: a product is a GROUP BUY line when it's in the live round's scope
 * (coversAll, or its id is in the round's assigned productIds) — matching what the
 * store admin shows, regardless of the product's productType tag. Everything else
 * is ON-HAND. A null banner (no live round) puts every product on-hand and closes
 * the GB path. Pricing still honours gbPrice (groupBuyLine) so a round product with
 * a gbPrice shows its saving, while an untagged round product simply lists at its
 * regular price. Availability filtering is the caller's job. Order is preserved
 * within each path; the input is never mutated.
 */
export function buildTwoWaysHomeView<T extends TwhProduct>(
  products: T[],
  banner: GroupBuyBanner | null,
  currency: string,
  now: Date = new Date(),
): TwoWaysHomeView<T> {
  const covered = banner && !banner.coversAll ? new Set(banner.productIds) : null;
  const inRound = (p: T): boolean =>
    !!banner && (banner.coversAll || (covered?.has(p.id) ?? false));

  const onHandLines = products.filter((p) => !inRound(p)).map((p) => onHandLine(p, currency));
  const gbLines = banner
    ? products.filter((p) => inRound(p)).map((p) => gbHomeLine(p, currency))
    : [];

  return {
    onHand: { count: onHandLines.length, lines: onHandLines },
    gb: {
      open: !!banner,
      name: banner?.name ?? "",
      deliveryEta: banner?.deliveryEta ?? "",
      countdown: gbCountdownLabel(banner?.endsAt, now),
      slots: slotProgress(banner?.slotGoal ?? 0, banner?.filled ?? 0),
      count: gbLines.length,
      lines: gbLines,
    },
  };
}
