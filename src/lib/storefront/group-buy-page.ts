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
  isGroupBuyProduct,
  slotProgress,
  type SlotProgress,
  type TwoWaysInput,
} from "./two-ways";
import type { WayState } from "./two-ways-mode";
import type { GroupBuyBanner } from "./group-buy-banner";
import { formatMoney } from "./currency";
import {
  buildProductOptions,
  DOSE_PATTERN,
  hasDoseToken,
  type Variation,
} from "./variations";

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

/** "₱1,200" — the store's currency + grouped amount, matching the catalog card.
 *  Negative amounts (never expected, but guarded) render as the zero baseline.
 *
 *  Goes through formatMoney so a word-like currency is spaced off its digits
 *  ("SAR 1,200"). This used to concatenate, which read fine while every store
 *  sold pesos and rendered "SAR1,200" the moment one didn't. */
export function formatGbMoney(currency: string, amount: number): string {
  return formatMoney(Math.max(0, amount || 0), currency, { decimals: false });
}

/**
 * The name the group-buy card shows: the product name with its dose appended.
 *
 * WHY (k-glow, 2026-07-31): sellers put the dose in the VARIATIONS, not the
 * product name — the row is "Semaglutide" and "5mg × 10 vials" is a variation.
 * The catalog card and the two-ways home both render an option picker, so the
 * dose is visible there; this page has no picker and rendered the bare name, so
 * with a round open every card read "Semaglutide" and the mg was simply gone.
 *
 * Rules, in order:
 *  - Name already carries a dose ("Lemon Bottle 10ml", "BPC 10mg + TB 10mg")
 *    → left alone. Appending would read "Lemon Bottle 10ml 10ml / 50ml".
 *  - Exactly one variation → its FULL name, so the pack size survives
 *    ("Semaglutide 5mg × 10 vials").
 *  - Several variations → just the dose token from each ("5mg / 10mg / 15mg").
 *    k-glow's Tirzepatide has nine, whose full names run past 140 characters.
 *  - A variation with no dose token ("Vials only") → fall back to full names, so
 *    a non-dose option list is still named rather than silently dropped.
 */
export function gbDisplayName(
  name: string,
  variations: readonly Variation[] | null | undefined,
): string {
  const base = (name || "").trim();
  if (hasDoseToken(base)) return base;

  const names = (Array.isArray(variations) ? variations : [])
    .map((v) => (v?.name || "").trim())
    .filter((n) => n !== "");
  if (names.length === 0) return base;
  if (names.length === 1) return `${base} ${names[0]}`.trim();

  const doses = names.map((n) => n.match(DOSE_PATTERN)?.[0]);
  const suffix = doses.every(Boolean) ? doses.join(" / ") : names.join(" / ");
  return `${base} ${suffix}`.trim();
}

/** The two lines of the view-only notice card. */
export type GbClosedNotice = { title: string; message: string };

/**
 * The notice a view-only group buy page shows above its listing.
 *
 * Two reasons to be view-only, and the copy must not confuse them: with NO round
 * running the honest explanation is that there isn't one, but while a round IS
 * running and the owner has simply turned ordering off, "there is no active
 * Group Buy" would be a lie the countdown on the same page contradicts.
 *
 * Deliberately worded as a status, not a failure — no "sorry", no "unavailable",
 * no error vocabulary. The page is doing exactly what the owner asked: showing
 * prices for reference. A shopper who reads this should understand they can look
 * now and buy later, not that something broke.
 */
export function gbClosedNotice(live: boolean): GbClosedNotice {
  const why = live
    ? "ordering is currently closed for this group buy"
    : "there is no active Group Buy";
  return {
    title: "Group Buy Currently Closed",
    message:
      `Please note that these items are currently not available for ordering because ${why}. ` +
      "Products and prices are displayed for viewing purposes only.",
  };
}

/** The minimal product shape the page reads. Generic so the caller keeps its own
 *  concrete Product type through the view (id/name/image for the card, and the
 *  variations the dose is read from — see gbDisplayName). */
export type GbPageProduct = TwoWaysInput & {
  id: string;
  name: string;
  image?: string | null;
  variations?: Variation[];
};

/**
 * One dose a group-buy card can be joined at: the seller's option name, the
 * price the round actually charges for it, and the variation the cart needs to
 * clone (absent on the product's own base price, which reads "Standard").
 */
export type GbPageOption = {
  name: string;
  /** The group-buy price for THIS option — what unitPrice charges for it. */
  price: number;
  /** The option's own regular (on-hand) price. */
  regularPrice: number;
  /** "₱3,866" — display-ready. */
  priceLabel: string;
  /** Absent on the base "Standard" option; present on every real variation. */
  variation?: Variation;
};

/**
 * The doses a group-buy card offers, priced at the round's prices.
 *
 * The catalog card and the two-ways home have always had an option picker; this
 * page did not, so "Join GB" added the bare catalog row — the cart line lost the
 * dose AND paid the base option's group price. The options are the same ones
 * those surfaces build (buildProductOptions), re-priced through groupBuyLine so
 * each dose shows the price the cart and the server both charge for it: a
 * variation with its own gbPrice gets it, and one WITHOUT sells at its own
 * price rather than inheriting a discount meant for a smaller size (see
 * makeVariationEntry).
 */
export function gbPageOptions(product: GbPageProduct, currency: string): GbPageOption[] {
  return buildProductOptions(product).map((option) => {
    const priced = groupBuyLine({
      ...product,
      price: option.price,
      gbPrice: option.variation ? option.variation.gbPrice : product.gbPrice,
    });
    return {
      name: option.name,
      price: priced.gbPrice,
      regularPrice: priced.regularPrice,
      priceLabel: formatGbMoney(currency, priced.gbPrice),
      variation: option.variation,
    };
  });
}

/**
 * Which option a card has selected on load: the first one carrying a dose.
 *
 * Not simply index 0. A seller who prices the base product distinctly gets a
 * "Standard" option at the head of the list (buildProductOptions), which names
 * no dose at all — defaulting to it would put "Semax" in the cart with the mg
 * gone, which is the whole bug. With no dosed option anywhere (or no options),
 * the first one stands.
 */
export function defaultGbOptionIndex(options: readonly GbPageOption[]): number {
  const dosed = options.findIndex((o) => hasDoseToken(o.name));
  return dosed >= 0 ? dosed : 0;
}

/**
 * The addToCart call a card makes for the option at `selectedIndex` — the
 * product plus the variation to clone (none when the product has no options, or
 * when the base "Standard" price is the selection). An index outside the option
 * list falls back to the card's default rather than crashing or, worse, silently
 * adding the wrong dose.
 */
export function gbCardAddition<T extends GbPageProduct>(
  line: GroupBuyPageLine<T>,
  selectedIndex: number,
): { product: T; variation?: Variation } {
  const options = line.options;
  if (options.length === 0) return { product: line.product };
  const inRange = selectedIndex >= 0 && selectedIndex < options.length;
  const option = options[inRange ? selectedIndex : line.defaultOptionIndex] ?? options[0];
  return { product: line.product, variation: option.variation };
}

/** One product card on the group-buy page. `price`/`priceLabel` are the primary
 *  (group-buy) price — the same price the cart + server charge. The design also
 *  surfaces the regular price struck through and a "save ₱X" badge, so the line
 *  carries the regular price and the saving too; `hasSavings` gates the badge +
 *  strikethrough so a GB product with no valid gbPrice never shows a phantom cut. */
export type GroupBuyPageLine<T extends GbPageProduct = GbPageProduct> = {
  product: T;
  /** The card's heading — the product name carrying its dose (gbDisplayName). */
  displayName: string;
  /** The doses this card can be joined at, priced at the round's prices. Empty
   *  when the seller defined no variations (the card keeps its single price). */
  options: GbPageOption[];
  /** The option the card has selected on load (see defaultGbOptionIndex). */
  defaultOptionIndex: number;
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

/** The full page view-model: a live round, or the view-only pricing reference. */
export type GroupBuyPageView<T extends GbPageProduct = GbPageProduct> = {
  /** Is a group-buy round actually running? Drives the round CHROME (status
   *  pill, countdown, slot bar) — all of which is meaningless between rounds. */
  live: boolean;
  /** Can nothing here be ordered? True when no round is running, or when the
   *  owner turned the group-buy way off. The page still renders products and
   *  prices — it shows the "Group Buy Currently Closed" notice and inert buy
   *  controls instead. Always the inverse of "a live round on an open way", so a
   *  surface can never render a buy button the cart would refuse. */
  viewOnly: boolean;
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
  const options = gbPageOptions(product, currency);
  return {
    product,
    displayName: gbDisplayName(product.name, product.variations),
    options,
    defaultOptionIndex: defaultGbOptionIndex(options),
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

/** One cart unit as the sticky bar counts it: the BASE product id it resolves
 *  to, the unit price checkout actually charges for it (a variation clone's own
 *  charged price, not the base line's), and the entry's own regular price. */
export type GbCartEntry = { id: string; unit: number; regular: number };

/**
 * Roll the cart up into the sticky bar's summary from per-unit entries the
 * caller prices with the SAME machinery checkout uses (unitPrice) — so a
 * variation clone counts at its charged price and the bar's total always
 * matches what checkout charges. Only entries whose base id is on the page (in
 * `lines`) contribute, so a stray on-hand or out-of-round entry can't skew the
 * total or the advertised saving. Non-finite prices clamp to 0. Pure + JSON-safe.
 */
export function groupBuyCartSummary<T extends GbPageProduct>(
  lines: GroupBuyPageLine<T>[],
  entries: readonly GbCartEntry[],
  currency: string,
): GroupBuyCartSummary {
  const onPage = new Set(lines.map((l) => l.product.id));
  let totalQty = 0;
  let total = 0;
  let regularTotal = 0;
  for (const entry of entries) {
    if (!onPage.has(entry.id)) continue;
    const unit = Number.isFinite(entry.unit) ? Math.max(0, entry.unit) : 0;
    const regular = Number.isFinite(entry.regular) ? Math.max(0, entry.regular) : unit;
    totalQty += 1;
    total += unit;
    regularTotal += regular;
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
 * Build the group-buy page view-model.
 *
 * WHAT IS LISTED, in two regimes:
 *
 *  • A round is LIVE — the round is the source of truth. A product is listed
 *    when it's in the round's scope (coversAll, or its id is in the assigned
 *    productIds), regardless of its productType tag: an owner can pull an
 *    untagged product into a round. This is the SAME membership rule the
 *    two-ways home uses (buildTwoWaysHomeView), so the home teaser and this page
 *    never disagree about what a round covers.
 *
 *  • BETWEEN rounds — there is no scope to read, so membership falls back to the
 *    productType "gb" TAG. That is exactly the rule that keeps those pre-orders
 *    OFF the on-hand shelf (two-ways-home.isOnHandStock), so the shelf and this
 *    page stay exact complements: every product sits on precisely one of them,
 *    never both and never neither. Listing them is what lets an owner keep the
 *    group buy up as a catalog/pricing reference between rounds.
 *
 * WHAT IS ORDERABLE is a separate question, answered by `viewOnly`: only a LIVE
 * round on an OPEN way can be joined. A closed way, or no round at all, still
 * renders every product and price — the page just shows the closed notice and
 * inert buy controls. `groupBuyWay` defaults to "open" so a caller that doesn't
 * manage per-way state gets exactly the previous live-round behaviour.
 *
 * Pricing is identical in both regimes and always honours gbPrice
 * (groupBuyLine): a product with a gbPrice lists at it, one without lists at its
 * regular price, so a reference price is never a phantom discount. Order is
 * preserved and the input is never mutated.
 */
export function buildGroupBuyPageView<T extends GbPageProduct>(
  products: T[],
  banner: GroupBuyBanner | null,
  currency: string,
  now: Date = new Date(),
  groupBuyWay: WayState = "open",
): GroupBuyPageView<T> {
  // Only a live round on an open way can be joined. Everything else — a closed
  // or hidden way, or no round at all — is a browsable pricing reference.
  const viewOnly = !banner || groupBuyWay !== "open";

  if (!banner) {
    // Between rounds: the tag is the only membership signal left. The round
    // chrome stays empty because there is no round to describe.
    const lines = products.filter(isGroupBuyProduct).map((p) => pageLine(p, currency));
    return {
      live: false,
      viewOnly,
      name: "",
      description: "",
      deliveryEta: "",
      countdown: "",
      slots: slotProgress(0, 0),
      count: lines.length,
      lines,
    };
  }
  const covered = !banner.coversAll ? new Set(banner.productIds) : null;
  const inRound = (p: T): boolean => banner.coversAll || (covered?.has(p.id) ?? false);
  const lines = products.filter(inRound).map((p) => pageLine(p, currency));
  return {
    live: true,
    viewOnly,
    name: banner.name,
    description: banner.description,
    deliveryEta: banner.deliveryEta,
    countdown: gbCountdownLabel(banner.endsAt, now),
    slots: slotProgress(banner.slotGoal, banner.filled),
    count: lines.length,
    lines,
  };
}
