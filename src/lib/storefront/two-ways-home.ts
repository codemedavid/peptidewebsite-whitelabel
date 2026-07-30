// "Two ways to order" HOME view-model — the presentation core behind the
// storefront home layout (design: "K Glow Store.dc.html"). It composes the tested
// two-ways primitives (slotProgress) and the group-buy-page helpers (countdown /
// initial / money) into what the home renders: the ON-HAND product list (ships
// now) and, while a round is live, a GROUP BUY TEASER — round chrome plus how
// many items are in the round, linking to the dedicated #groupbuy page. The
// round's products themselves are listed only there (group-buy-page.ts), never
// alongside the on-hand shelf. Pure + JSON-safe (no React, no DB), so it drives
// an SSR compute and is trivially testable (npm run test:two-ways-home).

import { slotProgress, type SlotProgress, type TwoWaysInput } from "./two-ways";
import { gbCountdownLabel, productInitial, formatGbMoney } from "./group-buy-page";
import type { GroupBuyBanner } from "./group-buy-banner";
import { orderOnHandProducts, type OnHandOrder } from "./on-hand-order";

/** The minimal product shape the home reads. Generic so the caller keeps its own
 *  concrete Product type through the view (id/name/image/stock for the rows). */
export type TwhProduct = TwoWaysInput & {
  id: string;
  name: string;
  image?: string | null;
  stock?: number;
  /** Size/dosage options — read only to tell a per-vial listing from a
   *  multi-vial kit when the shelf is ordered per-vial-first. */
  variations?: { name: string; price: number }[];
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

/** The live round as the home surfaces it: chrome + how many items are in the
 *  round, but NOT the products themselves — those live on the dedicated
 *  #groupbuy page (see buildTwoWaysHomeView). */
export type GbHomeTeaser = {
  /** A round is live (banner present). The teaser renders when open && count > 0. */
  open: boolean;
  name: string;
  deliveryEta: string;
  countdown: string;
  slots: SlotProgress;
  /** How many catalog products the round covers — "12 items in this round". */
  count: number;
  /** The ids the round covers. Lets callers (and the cross-check test) confirm
   *  the home and the group-buy page agree on membership without the home
   *  carrying priced product lines. */
  productIds: string[];
};

/** The full home view-model: the on-hand shelf and the live-round teaser. */
export type TwoWaysHomeView<T extends TwhProduct = TwhProduct> = {
  onHand: { count: number; lines: OnHandLine<T>[] };
  gb: GbHomeTeaser;
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

/**
 * Build the home view-model. The LIVE ROUND is the source of truth for what's in
 * the group buy: a product belongs to the round when it's in the round's scope
 * (coversAll, or its id is in the round's assigned productIds) — matching what the
 * store admin shows, regardless of the product's productType tag. Everything else
 * is ON-HAND.
 *
 * An open round NEVER shares this page with the on-hand shelf: the round's
 * products are listed only on the dedicated #groupbuy page, so the home returns
 * their ids and count for the teaser (chrome + "N items", CTA to that page) and no
 * product lines. That also means the home offers no way to add a round item to a
 * cart that already holds on-hand stock — the mixed-cart rule (./two-ways-cart)
 * can't be tripped from one screen. A null banner (no live round) puts every
 * product on-hand and closes the GB path.
 *
 * Availability filtering is the caller's job. On-hand order is preserved, except
 * that `onHandOrder: "per-vial-first"` floats the shelf's single per-vial listings
 * above its multi-vial kits (see ./on-hand-order). The input is never mutated.
 */
export function buildTwoWaysHomeView<T extends TwhProduct>(
  products: T[],
  banner: GroupBuyBanner | null,
  currency: string,
  now: Date = new Date(),
  onHandOrder: OnHandOrder = "catalog",
): TwoWaysHomeView<T> {
  const covered = banner && !banner.coversAll ? new Set(banner.productIds) : null;
  const inRound = (p: T): boolean =>
    !!banner && (banner.coversAll || (covered?.has(p.id) ?? false));

  const onHandLines = orderOnHandProducts(
    products.filter((p) => !inRound(p)),
    onHandOrder,
  ).map((p) => onHandLine(p, currency));
  const gbProductIds = banner ? products.filter(inRound).map((p) => p.id) : [];

  return {
    onHand: { count: onHandLines.length, lines: onHandLines },
    gb: {
      open: !!banner,
      name: banner?.name ?? "",
      deliveryEta: banner?.deliveryEta ?? "",
      countdown: gbCountdownLabel(banner?.endsAt, now),
      slots: slotProgress(banner?.slotGoal ?? 0, banner?.filled ?? 0),
      count: gbProductIds.length,
      productIds: gbProductIds,
    },
  };
}
