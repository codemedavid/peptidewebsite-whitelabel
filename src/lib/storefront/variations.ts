// Shared rules for per-product variations (the size/dosage options a seller
// defines, e.g. "Vials only" / "Complete set" / "5mg").
//
// Lives here rather than in either consumer because the storefront card and the
// store-admin editor must agree on them: the card decides what a customer can
// pick and pay, the editor decides what a seller is allowed to save. Splitting
// the rules across the two is how a variation ends up sellable at a price the
// editor never meant to allow.

import { formatMoney } from "./currency";

/**
 * A dose written into a name — "5mg", "0.1 mg", "10ml", "500mcg", "10iu".
 *
 * Lives here, beside the variation rules, because two surfaces must agree on
 * what counts as a dose: the group-buy card (which appends one to a bare name)
 * and the checkout line (which must not append a second). Deliberately carries
 * no `g` flag, so `test`/`match` stay stateless and sharing one instance across
 * callers can't leak a `lastIndex` between them.
 */
export const DOSE_PATTERN = /\d+(?:\.\d+)?\s*(?:mcg|mg|iu|ml|g)\b/i;

/** Does this name already carry its own dose ("Lemon Bottle 10ml")? Such a name
 *  is left alone everywhere — appending would read "Lemon Bottle 10ml 10ml". */
export function hasDoseToken(name: string): boolean {
  return DOSE_PATTERN.test(name || "");
}

/** A saved variation: name plus its own price, in the storefront's major units.
 *  `stock` is OPTIONAL and opt-in: when a seller sets a number the variation is
 *  tracked independently; when absent the variation falls back to the base
 *  product's `stock` (the historical shared-stock behavior). See
 *  `variationStock` / `effectiveStock` in ./inventory. */
/** `gbPrice` is likewise optional and per-variation: a multi-size listing prices
 *  each dose's group buy separately, and an option WITHOUT one sells at its own
 *  price rather than inheriting the base option's discount (see
 *  makeVariationEntry / gbPageOptions). Mirrors `Product.variations`. */
/** `image` is likewise optional and per-variation: a hosted photo of THIS option.
 *  It exists because a seller's variations are not always doses — mstomato sells
 *  vial cases in 81 colorways ("Silk Barbie", "Trans. Ocean"), and a name-only
 *  pill tells a customer nothing about what they are buying. Present only when
 *  the seller uploaded one; the card's gallery is built from these (see
 *  ./product-gallery) and a product with none renders exactly as it always has. */
export type Variation = {
  name: string;
  price: number;
  stock?: number;
  gbPrice?: number;
  image?: string;
};

/** An option offered on the product card. `variation` is absent on the product's
 *  own base price ("Standard") and present on every real variation — the cart
 *  needs it to clone the product via makeVariationEntry. */
export type ProductOption = {
  name: string;
  price: number;
  variation?: Variation;
};

/** Just the fields the option rules read. Keeps this module free of the full
 *  storefront `Product` type (and its import cycle back into components). */
type OptionSource = { price: number; variations?: Variation[] };

const variationsOf = (p: OptionSource): Variation[] =>
  Array.isArray(p.variations) ? p.variations : [];

/**
 * The options a customer can choose between on the product card.
 *
 * A product with no variations returns `[]` — the card keeps its plain
 * single-price behavior and never renders a picker. Otherwise the product's own
 * base price leads as "Standard", so a seller who adds one variation still
 * offers a genuine choice, and the variations follow in the order the seller
 * arranged them. A base price of 0 is skipped rather than offered: a "Standard"
 * option at zero would be a free checkout, not a choice.
 *
 * "Standard" is also skipped when a named variation already carries the base
 * price. Sellers routinely re-enter the base price as the first variation
 * ("5mg · ₱1,099" on a ₱1,099 product) — offering "Standard" alongside it just
 * repeats the same price with no size info, and the customer can't tell what a
 * nameless "Standard" would even ship.
 */
export function buildProductOptions(product: OptionSource): ProductOption[] {
  const variations = variationsOf(product);
  if (variations.length === 0) return [];

  const baseIsDistinct =
    product.price > 0 && !variations.some((v) => v.price === product.price);

  return [
    ...(baseIsDistinct ? [{ name: "Standard", price: product.price }] : []),
    ...variations.map((v) => ({ name: v.name, price: v.price, variation: v })),
  ];
}

/**
 * Should the card render its option picker?
 *
 * Any variation at all earns one. This deliberately does NOT key off the option
 * count: a product priced at 0 with a single variation produces exactly one
 * option, and the old `options.length > 1` rule hid it — the seller had set a
 * price the customer could pay but never see named.
 */
export function shouldShowOptionPicker(product: OptionSource): boolean {
  return variationsOf(product).length > 0;
}

// ── Collapsing a long option list ───────────────────────────────────────────

/**
 * How many option pills a card renders before hiding the rest behind a reveal.
 *
 * Sized to the card, not to a data model: six pills is roughly two rows in the
 * catalog grid at every breakpoint, which reads as "here are some options" while
 * leaving the description, price and buy controls above the fold. Sellers with
 * 2-4 variations (nearly all of them) never reach it and see no change at all.
 */
export const VARIATION_PREVIEW_COUNT = 6;

/** One rendered pill: the option plus its index in the FULL option list. The
 *  index is the whole point — the card calls setOptIdx(index) and reads
 *  optionStock[index] with it, so a truncated list must not renumber. */
export type VisibleOption = { option: ProductOption; index: number };

export type OptionSplit = {
  /** The pills to render right now, in seller order, each with its true index. */
  visible: VisibleOption[];
  /** How many options are NOT rendered — the number on the "+75 more" button. */
  hiddenCount: number;
  /** Is this list long enough to be worth collapsing at all? Drives whether the
   *  reveal button exists; stays true while expanded so it can offer "show less". */
  collapsible: boolean;
};

/**
 * Split an option list into the pills to show now and a count of the rest.
 *
 * WHY (mstomato, 2026-08-28): the picker rendered every option unconditionally.
 * A tenant selling vial cases in 81 colorways turned a single product card into
 * a multi-screen wall of pills, burying the price and the Add to Cart button.
 *
 * Three rules, in order:
 *
 *   - A list at or under `previewCount` is returned WHOLE and reports
 *     `collapsible: false`. This is the non-regression guarantee: the 2-4
 *     variation products every other tenant sells render exactly as before, with
 *     no reveal button appearing out of nowhere.
 *   - `expanded` returns everything, but stays `collapsible` so the caller can
 *     still offer "show less".
 *   - Collapsed, the SELECTED option is always pulled into view even when it
 *     lives in the hidden tail. Without this, picking "Verdance" (option 60) and
 *     then collapsing would hide the customer's own choice while the price and
 *     cart still refer to it.
 *
 * The pulled-in selection is appended rather than sorted into place, so it sits
 * next to the reveal button and reads as "your pick", and it carries its real
 * index so the cart adds the colorway the customer actually chose.
 */
export function splitOptionsForCard(
  options: readonly ProductOption[],
  opts: { expanded?: boolean; selectedIndex?: number; previewCount?: number } = {},
): OptionSplit {
  // Clamp rather than trust: a previewCount of 0 or NaN would render a picker
  // with no pills and only a "+81 more" button, which looks broken.
  const raw = Math.round(Number(opts.previewCount ?? VARIATION_PREVIEW_COUNT));
  const previewCount = Number.isFinite(raw) ? Math.max(1, raw) : VARIATION_PREVIEW_COUNT;

  const all: VisibleOption[] = options.map((option, index) => ({ option, index }));
  const collapsible = all.length > previewCount;
  if (!collapsible || opts.expanded) {
    return { visible: all, hiddenCount: 0, collapsible };
  }

  const selectedIndex = opts.selectedIndex ?? -1;
  // Only a selection genuinely in the TAIL needs pulling in — one already inside
  // the preview would be rendered twice.
  const pulled =
    selectedIndex >= previewCount && selectedIndex < all.length ? [all[selectedIndex]] : [];
  const visible = [...all.slice(0, previewCount), ...pulled];

  return { visible, hiddenCount: all.length - visible.length, collapsible };
}

/** Label for one option pill, e.g. "Vials only · ₱2,500". Still used by the
 *  Two-Ways home / group-buy rows, where prices sit inline on each option. The
 *  catalog card + detail modal instead render the bare `option.name` and reveal
 *  the price only once a pill is clicked (see resolveSelectedPrice). */
export function optionLabel(option: ProductOption, currency: string): string {
  return `${option.name} · ${formatMoney(option.price, currency, { decimals: false })}`;
}

/**
 * The price the card shows for the current selection, or `null` when the product
 * offers options but the customer hasn't picked one yet.
 *
 * This drives the "reveal price on click" rule: a product with variations shows
 * no price until one of its option pills is clicked, so the price on screen
 * always names the option the customer chose. A product with no variations has
 * no picker and always resolves to its single base price, so its card is
 * unchanged.
 *
 * `selectedIndex` is the picker's chosen option index; a value < 0 (the card's
 * initial "nothing picked" state) or one at/past the end of the option list
 * means no selection, hence `null`.
 */
export function resolveSelectedPrice(
  product: OptionSource,
  selectedIndex: number,
): number | null {
  const options = buildProductOptions(product);
  if (options.length === 0) return product.price;
  if (selectedIndex < 0 || selectedIndex >= options.length) return null;
  return options[selectedIndex].price;
}

/**
 * Names of variations that are named but carry no usable price (blank, zero or
 * negative) — the editor blocks saving while this is non-empty.
 *
 * Without this a one-click preset adds "Vials only" with an empty price, the
 * save path coerces it (`Number("") || 0`) to 0, and the storefront happily
 * sells it for nothing. Rows with no name are ignored: the save path drops them
 * as empty, so they are not an error the seller needs to act on.
 */
export function unpricedVariationNames(
  items: readonly { name: string; price: number | string }[],
): string[] {
  return items
    .filter((it) => it.name.trim() !== "")
    .filter((it) => {
      // A blank string must not read as 0 here — it is exactly the case we are
      // catching, and `Number("") === 0` would otherwise pass a `>= 0` test.
      const price = typeof it.price === "string" ? it.price.trim() : it.price;
      if (price === "") return true;
      const n = Number(price);
      return !Number.isFinite(n) || n <= 0;
    })
    .map((it) => it.name.trim());
}
