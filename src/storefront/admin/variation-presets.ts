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
/** `image` is the option's own hosted photo (an ImageKit URL from
 *  uploadProductImageAction). Present only once the seller uploads or pastes
 *  one; the storefront card turns these into a swipe gallery. */
export type VariationDraft = {
  name: string;
  price: number | string;
  stock?: number | string;
  image?: string;
};

/**
 * Assign a batch of uploaded photos to variation rows, immutably.
 *
 * WHY: a seller with 81 colorways will not click through 81 separate file
 * pickers — a per-row upload on its own is a feature nobody finishes using.
 * This spreads one multi-select upload across the rows in a single step.
 *
 * Matching is by FILENAME first: "silk-barbie.jpg" finds the "Silk Barbie" row
 * wherever it sits, so a seller can pick a whole folder in any order and each
 * photo lands on its own colorway. Comparison ignores case, punctuation and the
 * extension, because "Trans. Ocean" is realistically saved as "trans-ocean.png".
 *
 * Anything matching no row falls back to filling the first rows that still have
 * no photo, in order — a sensible result for files named DSC_0001.jpg, and never
 * one that silently overwrites a photo the seller already placed.
 */
export function assignVariationImages(
  items: readonly VariationDraft[],
  uploads: readonly { fileName: string; url: string }[],
): VariationDraft[] {
  const key = (s: string) =>
    s
      .replace(/\.[a-z0-9]+$/i, "") // drop the extension
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");

  const next = items.map((it) => ({ ...it }));
  const claimed = new Set<number>();
  const leftovers: string[] = [];

  for (const upload of uploads) {
    const wanted = key(upload.fileName);
    const at = next.findIndex(
      (it, i) => !claimed.has(i) && it.name.trim() !== "" && key(it.name) === wanted,
    );
    if (at === -1) {
      leftovers.push(upload.url);
      continue;
    }
    next[at] = { ...next[at], image: upload.url };
    claimed.add(at);
  }

  for (const url of leftovers) {
    const at = next.findIndex(
      (it, i) => !claimed.has(i) && it.name.trim() !== "" && !(it.image ?? "").trim(),
    );
    if (at === -1) break; // more photos than empty rows — drop the rest
    next[at] = { ...next[at], image: url };
    claimed.add(at);
  }

  return next;
}

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
