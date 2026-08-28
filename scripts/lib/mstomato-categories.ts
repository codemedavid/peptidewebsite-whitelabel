// The mstomato shelf: which of the owner's three categories a product belongs to.
//
// Pure and separate from the migration script so the mapping can be tested
// without a database — the split fix-peppies-categories.ts lacked, which is why
// its per-name map could only be verified by clicking chips on the live
// storefront. Covered by scripts/test-mstomato-categories.ts.
//
// The owner asked for "vial caps" and "vial case", and chose to add
// "Accessories" for the seven products that are neither.

/** The three shelf labels. Exported individually so the test and the migration
 *  can't drift on spelling — a typo here silently creates a fourth category. */
export const VIAL_CAPS = "Vial Caps";
export const VIAL_CASES = "Vial Cases";
export const ACCESSORIES = "Accessories";

/** Shelf order, as the chips should read left-to-right on the storefront. */
export const MSTOMATO_CATEGORY_LABELS = [VIAL_CAPS, VIAL_CASES, ACCESSORIES] as const;

export type MstomatoCategory = (typeof MSTOMATO_CATEGORY_LABELS)[number];

/**
 * Which shelf a product belongs on, from its name.
 *
 * Deliberately matches the two-word phrases "vial cap" and "vial case" rather
 * than the bare words "cap"/"case". The catalog contains
 * "Hard Cartridge Caps – Pen Cartridge", which is a cap for a PEN CARTRIDGE and
 * not for a vial; an `includes("caps")` rule files it under Vial Caps, and
 * "3 mL Vial Topper" and "Cartridge Spacer" go wrong the same way. Those three
 * mistakes are invisible until someone clicks every chip on the live site, so
 * the phrase match is the whole point of this function.
 *
 * Anything unrecognized falls back to Accessories rather than "" — an empty
 * category is rejected by the product editor (`saveProductAction`) and hides the
 * product from every storefront chip, so "unsure" must still be a real shelf.
 */
export function classifyMstomatoProduct(name: string): MstomatoCategory {
  const n = String(name ?? "").toLowerCase();
  // Singular stems, so "Vial Caps" / "Vial Case" / "Vial Cases" all match.
  if (n.includes("vial cap")) return VIAL_CAPS;
  if (n.includes("vial case")) return VIAL_CASES;
  return ACCESSORIES;
}

/** A storefront category record, mirroring `Category` in src/storefront/types.ts. */
export type CategoryRecord = { id: string; label: string };

/**
 * The full list to persist to `branding.config.categories`.
 *
 * The synthetic "all" tab leads it, because AdminCategoriesManager re-stamps
 * `{id:"all", label:"All Products"}` at the head on every save — writing the
 * list without it would make the owner's next edit in that screen look like it
 * silently added a category.
 *
 * `makeId` is injected (rather than calling Date.now/Math.random here) so the
 * test can assert the shape with stable ids, while the migration keeps using the
 * app's own `cat${Date.now()}_${rand}` format.
 */
export function buildMstomatoCategories(
  makeId: (index: number) => string,
): CategoryRecord[] {
  return [
    { id: "all", label: "All Products" },
    ...MSTOMATO_CATEGORY_LABELS.map((label, i) => ({ id: makeId(i), label })),
  ];
}
