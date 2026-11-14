// Category sections for the app's shop — the website's CategorySectionsCatalog
// rules (lib/storefront/category-sections), applied on the server so the app
// shows exactly the sections, order and Featured lead the storefront shows.
// Pure (no DB) — covered by npm run test:app-promo.

import {
  buildCategorySections,
  withFeaturedSection,
  type CategoryProductOrder,
} from "@/lib/storefront/category-sections";
import type { Category } from "@/storefront/types";
import type { ShopCatalogSection } from "./shop-contract";

type SectionProduct = { id: string; name: string; category?: string; position?: number; featured?: boolean };

/**
 * Every non-empty category as { id, label, productIds }, in the owner's
 * category order and per-category arrangement, led by "Featured". `products`
 * must be the listed (available) products, already in the store's arrangement.
 */
export function toShopSections(
  products: readonly SectionProduct[],
  categories: readonly Category[] | null | undefined,
  order: CategoryProductOrder | null | undefined,
): ShopCatalogSection[] {
  return withFeaturedSection(buildCategorySections(products, categories, order)).map((s) => ({
    id: s.id,
    label: s.label,
    productIds: s.products.map((p) => p.id),
  }));
}
