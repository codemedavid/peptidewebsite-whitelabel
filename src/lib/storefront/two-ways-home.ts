// "Two ways to order" HOME view-model — the presentation core behind the
// storefront home layout (design: "K Glow Store.dc.html"). It composes the tested
// two-ways primitives (slotProgress) and the group-buy-page helpers (countdown /
// initial / money) into what the home renders: the ON-HAND product list (ships
// now) and, while a round is live, a GROUP BUY TEASER — round chrome plus how
// many items are in the round, linking to the dedicated #groupbuy page. The
// round's products themselves are listed only there (group-buy-page.ts), never
// alongside the on-hand shelf. Pure + JSON-safe (no React, no DB), so it drives
// an SSR compute and is trivially testable (npm run test:two-ways-home).

import { isBoutiqueLayout, type HomeLayout } from "./boutique-home";
import {
  isGroupBuyProduct,
  slotProgress,
  type SlotProgress,
  type TwoWaysInput,
} from "./two-ways";
import { gbCountdownLabel, productInitial, formatGbMoney } from "./group-buy-page";
import type { GroupBuyBanner } from "./group-buy-banner";
import { orderOnHandProducts, type OnHandOrder } from "./on-hand-order";
import { availableUnits, productOutOfStock } from "./inventory";
import {
  TWO_WAYS_MODE_DEFAULT,
  normalizeTwoWaysMode,
  visibleWayCount,
  waysHeading,
  type TwoWaysMode,
  type WayState,
} from "./two-ways-mode";

/** The minimal product shape the home reads. Generic so the caller keeps its own
 *  concrete Product type through the view (id/name/image/stock for the rows). */
export type TwhProduct = TwoWaysInput & {
  id: string;
  name: string;
  image?: string | null;
  stock?: number;
  /** Size/dosage options — read to tell a per-vial listing from a multi-vial
   *  kit when the shelf is ordered per-vial-first, and for `stock` when a dose
   *  tracks its own pool (see ./inventory). */
  variations?: { name: string; price: number; stock?: number }[];
};

/** One on-hand ("ships now") product row. */
export type OnHandLine<T extends TwhProduct = TwhProduct> = {
  product: T;
  initial: string;
  price: number;
  priceLabel: string;
  /** True when stock is unknown, or when at least one option can still be
   *  bought — mirrors the catalog's "in stock" treatment (absent stock is not a
   *  sold-out signal, and one stocked dose keeps the product buyable). */
  inStock: boolean;
  /** "12 in stock" — the units sellable across every pool (see
   *  inventory.availableUnits). Empty when no pool carries a stock number. */
  stockLabel: string;
  /** Can this line actually be added to a cart? Stock AND the on-hand way being
   *  open — an owner who paused on-hand sales still shows the shelf (so the
   *  pause is explained), but nothing on it sells. */
  buyable: boolean;
};

/** The live round as the home surfaces it: chrome + how many items are in the
 *  round, but NOT the products themselves — those live on the dedicated
 *  #groupbuy page (see buildTwoWaysHomeView). */
export type GbHomeTeaser = {
  /** A round is live (banner present) AND the group-buy way is open. The teaser
   *  renders when open && count > 0. An owner who closed or hid the way stops
   *  the join path here, whatever the round says. */
  open: boolean;
  /** Does the dedicated group-buy page have anything to show right now? True
   *  while a round covers products, AND between rounds when the catalog holds
   *  gb-tagged listings the page can present view-only. False for a hidden way.
   *
   *  Lets the way CARD link out even when it reads "Closed", instead of
   *  dead-ending: the prices are still there to browse. Mirrors the rule in
   *  storefront/visibility.ts, so the card and the nav link can never disagree
   *  about whether that page exists. */
  browsable: boolean;
  /** The group-buy way as the owner set it — what the way CARD renders
   *  (open / marked closed / gone). */
  state: WayState;
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
  onHand: {
    count: number;
    lines: OnHandLine<T>[];
    /** The on-hand way as the owner set it. "hidden" empties the shelf. */
    state: WayState;
  };
  gb: GbHomeTeaser;
  /** How many order paths the page actually shows (a CLOSED way still counts). */
  visibleWays: number;
  /** The heading above the ways split — a one-way store never claims two. */
  heading: string;
};

/**
 * Resolve the effective home layout.
 *
 * Two different kinds of layout meet here, and the difference is the whole
 * point of the branching:
 *
 *   • "two-ways" is a SOLD module. The operator entitlement (Super Admin →
 *     Features → Group Buy → "Two ways to order" home) is the ONLY way in —
 *     catalog.ts has it operator-grantable, default OFF — so the owner-writable
 *     branding.config.homeLayout must never self-enable it. Config can only opt
 *     OUT: an explicit "classic" wins even while the grant is on, and an
 *     unentitled tenant gets the classic home whatever its config says.
 *
 *   • "boutique" is a LAYOUT CHOICE. It re-composes data every tenant already
 *     has (hero, categories, catalog, contact channels) and unlocks no module,
 *     so it is owner-selectable and needs no grant. It is checked FIRST, which
 *     is what lets an unentitled tenant reach it.
 *
 * Anything unrecognised falls through to the pre-boutique answer, so a garbage
 * config value still fails closed to a layout the tenant is allowed to have.
 */
export function resolveHomeLayout(
  entitled: boolean,
  configLayout: string | undefined | null,
): HomeLayout {
  if (isBoutiqueLayout(configLayout)) return "boutique";
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

function onHandLine<T extends TwhProduct>(
  product: T,
  currency: string,
  wayOpen: boolean,
): OnHandLine<T> {
  const price = Math.max(0, product.price || 0);
  // Availability comes from the shared inventory rules, not the base column
  // alone: a product whose doses track their own stock has as many pools as it
  // has options, and reading `product.stock` HID products whose doses were
  // stocked (empty base column) while ADVERTISING ones whose doses were all
  // sold out (stale positive base column).
  const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  // Stock is genuinely UNKNOWN only when no pool carries a number. Unknown is
  // not a sold-out signal — such a product stays buyable and unlabelled, the
  // same treatment the catalog gives it.
  const known = isNum(product.stock) || (product.variations ?? []).some((v) => isNum(v.stock));
  const inStock = known ? !productOutOfStock(product) : true;
  return {
    product,
    initial: productInitial(product.name),
    price,
    priceLabel: formatGbMoney(currency, price),
    inStock,
    stockLabel: known ? `${availableUnits(product)} in stock` : "",
    buyable: inStock && wayOpen,
  };
}

/**
 * Build the home view-model. The LIVE ROUND is the source of truth for what's in
 * the round: a product belongs to it when it's in the round's scope (coversAll,
 * or its id is in the round's assigned productIds) — matching what the store
 * admin shows, regardless of the product's productType tag.
 *
 * The ON-HAND shelf is NOT simply "everything else". A product is ships-now
 * stock only when it is neither in the round NOR tagged productType "gb": a
 * group-buy listing is a pre-order with no ready stock behind it, so it must
 * never appear on the shelf — least of all when a round CLOSES and the round's
 * scope stops excluding it (the k-glow bug, 2026-08-17). Between rounds the
 * shelf shows exactly the products it showed while the round was live.
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
 *
 * `ways` (./two-ways-mode) lets a store sell only ONE way. A hidden way drops
 * out of the page entirely — the on-hand shelf comes back empty, or the group-buy
 * teaser never opens — and a closed way is still shown but sells nothing. Omitting
 * the argument leaves both ways open, i.e. exactly the home every existing tenant
 * already has. Note that hiding the group-buy way does NOT return the round's
 * products to the on-hand shelf: they are pre-orders priced at gbPrice, so the
 * round's scope keeps excluding them either way.
 */
export function buildTwoWaysHomeView<T extends TwhProduct>(
  products: T[],
  banner: GroupBuyBanner | null,
  currency: string,
  now: Date = new Date(),
  onHandOrder: OnHandOrder = "catalog",
  ways: TwoWaysMode = TWO_WAYS_MODE_DEFAULT,
): TwoWaysHomeView<T> {
  const mode = normalizeTwoWaysMode(ways);
  const covered = banner && !banner.coversAll ? new Set(banner.productIds) : null;
  const inRound = (p: T): boolean =>
    !!banner && (banner.coversAll || (covered?.has(p.id) ?? false));

  // What may be sold as SHIPS-NOW stock. Two independent reasons to leave the
  // shelf, and a product needs only one of them:
  //
  //   • the productType "gb" TAG — the intrinsic split. A group-buy listing is a
  //     pre-order priced at gbPrice and has no ready stock behind it, whether or
  //     not a round happens to be running.
  //   • the LIVE ROUND's scope — an owner can pull an untagged product into a
  //     round, and while that round runs it sells on the group-buy terms.
  //
  // Reading the round ALONE was the k-glow bug (2026-08-17): its catalog is ~25
  // tagged PasaBuy listings plus 6 separately-seeded on-hand rows, so the moment
  // a round closed (null banner) all 25 pre-orders reappeared on the ships-now
  // shelf at their group-buy prices. The shelf must not change when a round ends.
  const isOnHandStock = (p: T): boolean => !isGroupBuyProduct(p) && !inRound(p);

  const onHandLines =
    mode.onHand === "hidden"
      ? []
      : orderOnHandProducts(products.filter(isOnHandStock), onHandOrder).map((p) =>
          onHandLine(p, currency, mode.onHand === "open"),
        );
  const gbProductIds = banner ? products.filter(inRound).map((p) => p.id) : [];

  // What the group-buy PAGE would list right now — the round's members while one
  // runs, else the gb-tagged listings it shows view-only. Same two-regime
  // membership as buildGroupBuyPageView, so the card never offers a page that
  // renders empty (nor withholds one that doesn't).
  const gbPageCount = banner ? gbProductIds.length : products.filter(isGroupBuyProduct).length;

  return {
    onHand: { count: onHandLines.length, lines: onHandLines, state: mode.onHand },
    visibleWays: visibleWayCount(mode),
    heading: waysHeading(mode),
    gb: {
      open: !!banner && mode.groupBuy === "open",
      browsable: mode.groupBuy !== "hidden" && gbPageCount > 0,
      state: mode.groupBuy,
      name: banner?.name ?? "",
      deliveryEta: banner?.deliveryEta ?? "",
      countdown: gbCountdownLabel(banner?.endsAt, now),
      slots: slotProgress(banner?.slotGoal ?? 0, banner?.filled ?? 0),
      count: gbProductIds.length,
      productIds: gbProductIds,
    },
  };
}
