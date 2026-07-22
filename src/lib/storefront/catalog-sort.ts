// Catalog sort menu styles — the per-tenant branding.config.catalogSortStyle
// flag that picks which sort dropdown the storefront catalog renders:
//
//   "classic" (default) — today's menu: Sort: Name / Price: Low to High /
//                         Price: High to Low. Every store keeps this unless
//                         explicitly switched.
//   "simple"            — the 3-option HP Glow menu: Sort by Name / Sort by
//                         Price / Sort by Best Sellers, where best sellers
//                         rank by real units sold from storefront orders.
//
// Pure module (no DB, no React) so the whole surface is covered by
// npm run test:catalog-sort. The server page builds the best-seller counts
// (buildBestSellerCounts) and ships them on the brand; the client catalog
// only ever runs the pure sorter.

export type CatalogSortStyle = "classic" | "simple";

export interface CatalogSortOption {
  value: string;
  label: string;
}

/** Units sold per catalog product id (or `name:<name>` for legacy order lines
 *  that predate productId stamping). Serializable — ships server → client. */
export type BestSellerCounts = Record<string, number>;

/** The minimal order shape the counter needs — matches StorefrontOrder rows
 *  (`status` column + `items` JSON) and the demo store's saved orders. */
export interface BestSellerOrderInput {
  status: string;
  items: { name: string; qty: number; productId?: string }[];
}

/** The minimal product shape the sorter needs. */
interface SortableProduct {
  id: string;
  name: string;
  price: number;
}

// Same demand definition as group-buy reporting (orderCountsAsDemand):
// everything except cancelled/refunded counts as a sale signal. Kept local so
// this stays a leaf module with no import cycles.
const EXCLUDED_STATUSES = new Set(["cancelled", "canceled", "refunded"]);

const CLASSIC_OPTIONS: readonly CatalogSortOption[] = [
  { value: "name", label: "Sort: Name" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
];

const SIMPLE_OPTIONS: readonly CatalogSortOption[] = [
  { value: "name", label: "Sort by Name" },
  { value: "price-asc", label: "Sort by Price" },
  { value: "best", label: "Sort by Best Sellers" },
];

/** Coerce an untrusted config value into a known style. Anything that isn't
 *  exactly "simple" is the classic menu — the safe default for every store. */
export function normalizeCatalogSortStyle(raw: unknown): CatalogSortStyle {
  return raw === "simple" ? "simple" : "classic";
}

/** The dropdown's option list for a style. Fresh copies — callers can't
 *  mutate the shared constants. */
export function catalogSortOptions(style: CatalogSortStyle): CatalogSortOption[] {
  const source = style === "simple" ? SIMPLE_OPTIONS : CLASSIC_OPTIONS;
  return source.map((o) => ({ ...o }));
}

/**
 * Units sold per product across the store's orders. Cancelled/refunded orders
 * never count; variation lines already carry the BASE catalog id (stamped at
 * checkout via baseProductId), so their units roll up to the real product row.
 * Lines without a productId (legacy orders) key by `name:<name>` and are
 * matched by product name at sort time. Bad quantities (NaN, ≤ 0) are skipped.
 */
export function buildBestSellerCounts(orders: BestSellerOrderInput[]): BestSellerCounts {
  const counts: BestSellerCounts = {};
  for (const order of orders) {
    if (EXCLUDED_STATUSES.has((order.status || "").toLowerCase())) continue;
    for (const item of order.items) {
      const qty = Number(item.qty);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const key = item.productId || `name:${item.name}`;
      counts[key] = (counts[key] ?? 0) + qty;
    }
  }
  return counts;
}

function unitsSold(p: SortableProduct, counts: BestSellerCounts): number {
  return counts[p.id] ?? counts[`name:${p.name}`] ?? 0;
}

/**
 * Sort a catalog list by a dropdown value. Always returns a new array — the
 * input list is never mutated. Unknown values (and "best" with no counts to
 * rank by) fall back to name order, so a stale saved sort can never blank or
 * scramble the catalog.
 */
export function sortCatalogProducts<T extends SortableProduct>(
  products: T[],
  sort: string,
  counts: BestSellerCounts = {},
): T[] {
  return [...products].sort((a, b) => {
    if (sort === "price-asc") return a.price - b.price;
    if (sort === "price-desc") return b.price - a.price;
    if (sort === "best") {
      const diff = unitsSold(b, counts) - unitsSold(a, counts);
      if (diff !== 0) return diff;
    }
    return a.name.localeCompare(b.name);
  });
}
