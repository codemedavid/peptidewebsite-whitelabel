// What still stops the Add / Edit Product form from saving, in plain words.
//
// The Save button used to just turn grey. An owner who left the Description
// blank (it was required then) could not tell why and reported "I can't add a
// product". The form now lists these reasons beside the disabled button, and
// Description is no longer required: the server accepts an empty one and every
// storefront surface skips it when blank.

export interface ProductSaveInput {
  name: string;
  category: string;
  /** The raw Base Price field value. Blank means 0, which is allowed. */
  price: string | number;
  /** Names of options that have no price yet (unpricedVariationNames). */
  unpricedOptions: readonly string[];
  /** The wholesale rule's validation message, or "" when it is fine/off. */
  wholesaleError: string;
}

/** Each entry names one missing thing, in the order the form shows it. Empty = can save. */
export function productSaveBlockers(input: ProductSaveInput): string[] {
  const price = Number(input.price);
  return [
    input.name.trim() ? null : "Product name",
    input.category ? null : "Category",
    Number.isFinite(price) && price >= 0 ? null : "A base price of 0 or more",
    input.unpricedOptions.length ? `A price for ${input.unpricedOptions.join(", ")}` : null,
    input.wholesaleError ? `Wholesale: ${input.wholesaleError}` : null,
  ].filter((b): b is string => b !== null);
}
