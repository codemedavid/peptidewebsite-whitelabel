// Quick-fill presets for the product editor's Variations list.
//
// Peptide sellers reach for the same two options on almost every product — the
// vials on their own, or the complete set with its inclusions — and typing the
// labels by hand lets them drift ("vials only", "Vials Only", "Vial only"),
// which shows up verbatim on the storefront picker. These presets keep one
// spelling. They are ordinary variations once added: freely renamed, priced or
// removed, and the storefront picker only appears when at least one is filled
// in (see cleanVariations in src/lib/storefront/product-mapping.ts).

/** An in-progress variation row. `price` and `stock` stay `number | string` so
 *  the inputs can be cleared to "" while editing — the save path coerces them
 *  back. `stock` left blank means "untracked → fall back to the base product
 *  stock" (see effectiveStock in lib/storefront/inventory.ts); a number tracks
 *  that option's own inventory. Mirrors the editor row in AdminAddProduct.tsx. */
export type VariationDraft = { name: string; price: number | string; stock?: number | string };

export const VARIATION_PRESETS = ["Vials only", "Complete set"] as const;

export type VariationPreset = (typeof VARIATION_PRESETS)[number];

const normalize = (name: string) => name.trim().toLowerCase();

/**
 * Add `preset` to the variation list, immutably.
 *
 *   - already present (ignoring case and surrounding whitespace) → unchanged,
 *     so double-clicking a preset button can't create a duplicate option;
 *   - a row with a blank name exists → that row is named instead of appending,
 *     so clicking "+ Add variation" and then a preset doesn't leave an empty
 *     row stranded above the new one. Any price already typed there is kept;
 *   - otherwise → appended with a blank price, ready to type into.
 */
export function applyVariationPreset(
  items: readonly VariationDraft[],
  preset: VariationPreset,
): VariationDraft[] {
  const exists = items.some((it) => normalize(it.name) === normalize(preset));
  if (exists) return [...items];

  const blank = items.findIndex((it) => normalize(it.name) === "");
  if (blank !== -1) {
    return items.map((it, i) => (i === blank ? { ...it, name: preset } : it));
  }

  return [...items, { name: preset, price: "" }];
}
