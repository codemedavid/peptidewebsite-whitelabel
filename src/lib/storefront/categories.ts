// Which categories a store owner can actually ASSIGN to a product.
//
// `branding.config.categories` mixes two different things: the synthetic "all"
// tab (a storefront filter — never a real category) and the owner's own
// categories. The Add Product editor needs only the latter, and it needs at
// least one: Category is required both client-side (`canSave`) and server-side
// (`saveProductAction` rejects a falsy category), so a tenant with zero real
// categories gets a permanently disabled Save button.
//
// That is not hypothetical. AdminCategoriesManager lets the owner delete every
// category, and its `persist` re-stamps "all" on the way out — so the saved
// value becomes exactly `[{id:"all"}]`. Being non-null, it defeats the
// `brandSeed.categories ?? SEED_CATEGORIES` fallback in store.tsx, and Add
// Product dies with no way back except discovering the Categories manager.
// Tenant `k-glow` sat in that state for five days with a 31-product catalog.
//
// The fallback below makes that state unreachable: there is always exactly one
// assignable category, so adding a product is never a dead end. It is a plain
// category id, so a product saved under it behaves like any other unfiled
// product — it shows under "All Products" until the owner reassigns it.
//
// Pure (no server/React deps) so the admin editor and any server-side caller
// resolve the same set.

import type { Category } from "@/storefront/types";
import { safeImageSrc } from "./hero-media";

/** The synthetic storefront filter tab. A filter, never an assignable category. */
export const ALL_CATEGORY_ID = "all";

/** The always-available fallback, used only when the tenant has no real ones. */
export const UNCATEGORIZED_CATEGORY: Category = {
  id: "uncategorized",
  label: "Uncategorized",
};

/**
 * The categories a product may actually be assigned to: the owner's own, minus
 * the synthetic "all" tab — or the `Uncategorized` fallback when there are none,
 * so the Add Product form always has something valid to select.
 */
export function resolveSelectableCategories(
  categories?: readonly Category[] | null,
): Category[] {
  const real = (categories ?? []).filter(
    (c): c is Category => !!c && !!c.id && c.id !== ALL_CATEGORY_ID,
  );
  return real.length > 0 ? real : [UNCATEGORIZED_CATEGORY];
}

// ── Category images ──────────────────────────────────────────────────────────
// An owner may upload a picture per category for its storefront tile / badge.
// It is stored on the category itself (branding.config.categories[].image) and
// is optional: without one the tile keeps showing the first product photo.

/** The stored category image, or undefined when there is none or it is not a
 *  plain image URL. Same gate as the hero image (safeImageSrc), so a
 *  javascript: or oversized data: URL in config never reaches <img>. */
export function categoryImage(raw: unknown): string | undefined {
  return safeImageSrc(raw) || undefined;
}

/** A new category list with `id`'s image set — or cleared (key removed) when
 *  `image` is blank or unsafe. The input list is never mutated. */
export function withCategoryImage(
  categories: readonly Category[],
  id: string,
  image: string | undefined,
): Category[] {
  const clean = categoryImage(image);
  return categories.map((c) => {
    if (c.id !== id) return c;
    const { image: _previous, ...rest } = c;
    void _previous;
    return clean ? { ...rest, image: clean } : rest;
  });
}
