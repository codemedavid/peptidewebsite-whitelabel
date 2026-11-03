// Search + category filtering for the storefront listings that are NOT the
// shared Catalog: the group-buy page (the whole home of a "groupbuy" layout
// store — mnm-pepsabuy) and the two-ways home's on-hand shelf. The classic,
// boutique, editorial and showcase layouts all funnel through Catalog's own
// search; these two listings used to have nothing, so a 40-line price list
// could only be scrolled.
//
// Pure and React-free so `npm run test:listing-filter` can pin the rules.

import { listedVariations } from "./variation-availability";

/** The few product fields the filter reads. */
export type FilterableProduct = {
  name: string;
  description?: string;
  category?: string;
  variations?: { name: string; available?: boolean }[];
};

export type ListingCategory = { id: string; label: string };

/** The "everything" chip. Matches Catalog's convention (category === "all"). */
export const ALL_CATEGORY = "all";

/** Below this many items a search box is clutter — the whole list fits on screen. */
export const MIN_ITEMS_FOR_SEARCH = 4;

/** Lower-cased, accent-folded, whitespace-collapsed — "Tirzépatide  10mg" and
 *  "tirzepatide 10mg" are the same search. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** True when every word of `query` appears somewhere in the product's name,
 *  display name, description or dose names. Word-wise (not one substring) so
 *  "reta 10" finds "Retatrutide — 10mg". An empty query matches everything. */
export function matchesListingQuery(
  product: FilterableProduct,
  query: string,
  displayName?: string,
): boolean {
  const words = normalizeSearchText(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeSearchText(
    [
      product.name,
      displayName ?? "",
      product.description ?? "",
      // A hidden option (available: false) must not make its product match.
      ...listedVariations(product.variations).map((v) => v.name),
    ].join(" "),
  );
  return words.every((w) => haystack.includes(w));
}

/** Filters `items` by query + category, keeping their order. `pick` maps an item
 *  to its product (and optional card heading), so lines and bare products share
 *  one rule. Never mutates the input. */
export function filterListing<T>(
  items: readonly T[],
  filter: { query: string; category: string },
  pick: (item: T) => { product: FilterableProduct; displayName?: string },
): T[] {
  const byCategory = filter.category && filter.category !== ALL_CATEGORY;
  return items.filter((item) => {
    const { product, displayName } = pick(item);
    if (byCategory && product.category !== filter.category) return false;
    return matchesListingQuery(product, filter.query, displayName);
  });
}

/** The category chips worth drawing for a listing: only categories that hold at
 *  least one listed product, in the store's configured order, each with its
 *  count. A seed/stale category list (mstomato's peptide chips) never leaks in,
 *  and fewer than two real categories → [] (one chip filters nothing). */
export function listingCategories(
  products: readonly FilterableProduct[],
  categories: readonly ListingCategory[],
): (ListingCategory & { count: number })[] {
  const counts = new Map<string, number>();
  for (const p of products) {
    if (p.category) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  }
  const chips = categories
    .filter((c) => c.id !== ALL_CATEGORY && (counts.get(c.id) ?? 0) > 0)
    .map((c) => ({ id: c.id, label: c.label, count: counts.get(c.id) ?? 0 }));
  return chips.length >= 2 ? chips : [];
}
