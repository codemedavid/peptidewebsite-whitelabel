// Shared rules for per-product variations (the size/dosage options a seller
// defines, e.g. "Vials only" / "Complete set" / "5mg").
//
// Lives here rather than in either consumer because the storefront card and the
// store-admin editor must agree on them: the card decides what a customer can
// pick and pay, the editor decides what a seller is allowed to save. Splitting
// the rules across the two is how a variation ends up sellable at a price the
// editor never meant to allow.

/** A saved variation: name plus its own price, in the storefront's major units.
 *  `stock` is OPTIONAL and opt-in: when a seller sets a number the variation is
 *  tracked independently; when absent the variation falls back to the base
 *  product's `stock` (the historical shared-stock behavior). See
 *  `variationStock` / `effectiveStock` in ./inventory. */
export type Variation = { name: string; price: number; stock?: number };

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

/** Label for one option pill, e.g. "Vials only · ₱2,500". Still used by the
 *  Two-Ways home / group-buy rows, where prices sit inline on each option. The
 *  catalog card + detail modal instead render the bare `option.name` and reveal
 *  the price only once a pill is clicked (see resolveSelectedPrice). */
export function optionLabel(option: ProductOption, currency: string): string {
  return `${option.name} · ${currency}${option.price.toLocaleString()}`;
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
