// Shared peptide ↔ bacteriostatic-water product classifier. The single source
// of truth for "is this product a peptide, bac water, or neither" used by the
// Order Ratio Control engine (group-buy-rules.ts) and the storefront cart.
//
// Classification is TWO-tier, matching the feature the store owner configured:
//   1. The explicit per-product tag the storefront admin sets in the product
//      editor (Product.productClass ← metadata.productClass). This always wins
//      so an operator can override any name-based guess ("configurable without
//      code changes").
//   2. A legacy name/category/sequence heuristic as the fallback for products
//      the owner never tagged — the same regex the older bac-water rules used,
//      kept here so the two engines can't drift.
//
// Pure (no server/React deps) so the storefront client, the store-admin panel
// and the order server action all classify identically.

export const PRODUCT_CLASSES = ["peptide", "bacWater", "other"] as const;
export type ProductClass = (typeof PRODUCT_CLASSES)[number];

/** Matches "Bac Water", "BacWater", "Bacteriostatic Water" anywhere. */
const BAC_WATER_RE = /\bbac(?:teriostatic)?\s*water\b/i;
/** Matches "peptide", "peptides", "pept…" as a keyword. */
const PEPTIDE_RE = /pept/i;

/** Narrow an untrusted value to a ProductClass, or undefined when it isn't one. */
export function toProductClass(v: unknown): ProductClass | undefined {
  return typeof v === "string" && (PRODUCT_CLASSES as readonly string[]).includes(v)
    ? (v as ProductClass)
    : undefined;
}

/**
 * Classify a product. `productClass` is the admin's explicit tag and takes
 * precedence; when it's absent (or not a valid class) the name/category/sequence
 * heuristic decides, defaulting to "other" so accessories (syringes, swabs)
 * never count toward the peptide↔bac-water ratio.
 */
export function classifyProductClass(p: {
  name?: string | null;
  category?: string | null;
  sequence?: string | null;
  productClass?: unknown;
}): ProductClass {
  const explicit = toProductClass(p.productClass);
  if (explicit) return explicit;

  const name = p.name || "";
  const category = p.category || "";
  if (BAC_WATER_RE.test(name) || BAC_WATER_RE.test(category)) return "bacWater";
  if (PEPTIDE_RE.test(name) || PEPTIDE_RE.test(category) || !!(p.sequence && p.sequence.trim())) {
    return "peptide";
  }
  return "other";
}
