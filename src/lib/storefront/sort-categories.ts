// Admin-managed product sort categories — the owner-editable list behind the
// storefront catalog's sort dropdown ("Sort: Name" and friends).
//
// This REPLACES the hardcoded menus in catalog-sort.ts (CLASSIC_OPTIONS /
// SIMPLE_OPTIONS). A store owner could not previously add "Weight Loss" or
// "Anti-Aging" to that dropdown without a code change; now the whole menu is
// data in branding.config.sortCategories.
//
// An entry is one of two things:
//
//   BUILT-IN  — a behavior the code implements: name, price-asc, price-desc,
//               best-sellers, newest. The owner may rename, reorder, disable or
//               delete these, but not invent new ones (there is nothing to run).
//   GROUP     — a bucket the owner names themselves ("Weight Loss", "Healing").
//               Products are assigned to it from the product form, and picking
//               it in the dropdown floats its members to the top.
//
// Picking a group SORTS, it never FILTERS: the rest of the catalog still follows
// underneath. A sort menu that silently hid two thirds of the shelf would cost
// the store sales, and the category chips already exist for real filtering.
//
// Pure module (no DB, no React) so the admin editor, the server page and the
// client catalog all resolve the same list, and the whole surface is covered by
// npm run test:sort-categories.

import type { BestSellerCounts } from "./catalog-sort";

/** What an entry actually does when the shopper picks it. */
export type SortCategoryKind =
  | "featured"
  | "name"
  | "price-asc"
  | "price-desc"
  | "best-sellers"
  | "newest"
  | "group";

export type SortCategory = {
  id: string;
  /** The owner's own wording — this is what the dropdown shows. */
  label: string;
  kind: SortCategoryKind;
  /** Disabled entries leave the dropdown but never hide products. */
  enabled: boolean;
};

export interface SortCategoryOption {
  value: string;
  label: string;
}

/** Everything the sorters may need beyond the products themselves. */
export interface SortContext {
  /** Units sold per product id — see buildBestSellerCounts in catalog-sort.ts. */
  bestSellerCounts?: BestSellerCounts;
}

/** The minimal product shape these helpers read. */
interface SortableProduct {
  id: string;
  name: string;
  price: number;
  featured?: boolean;
  /** The group entry this product belongs to (branding metadata.sortCategory). */
  sortCategory?: string;
  /** ISO timestamp from the Product row, used by the "newest" built-in. */
  createdAt?: string;
}

const KINDS: readonly SortCategoryKind[] = [
  "featured",
  "name",
  "price-asc",
  "price-desc",
  "best-sellers",
  "newest",
  "group",
];

const isKind = (v: unknown): v is SortCategoryKind =>
  typeof v === "string" && (KINDS as readonly string[]).includes(v);

/** The classic three — today's dropdown for every store that never configured
 *  one. Kept as the hard fallback so a tenant with broken config still gets a
 *  working menu instead of an empty <select>. */
export const DEFAULT_SORT_CATEGORIES: readonly SortCategory[] = [
  { id: "featured", label: "Sort: Featured", kind: "featured", enabled: true },
  { id: "name", label: "Sort: Name", kind: "name", enabled: true },
  { id: "price-asc", label: "Price: Low to High", kind: "price-asc", enabled: true },
  { id: "price-desc", label: "Price: High to Low", kind: "price-desc", enabled: true },
] as const;

/** The "simple" HP Glow menu, seeded for tenants already on that style. */
const SIMPLE_SORT_CATEGORIES: readonly SortCategory[] = [
  { id: "featured", label: "Sort: Featured", kind: "featured", enabled: true },
  { id: "name", label: "Sort by Name", kind: "name", enabled: true },
  { id: "price-asc", label: "Sort by Price", kind: "price-asc", enabled: true },
  { id: "best", label: "Sort by Best Sellers", kind: "best-sellers", enabled: true },
] as const;

const clone = (list: readonly SortCategory[]): SortCategory[] => list.map((c) => ({ ...c }));

/**
 * The starting list for a tenant that has never configured one, derived from
 * their legacy `branding.config.catalogSortStyle`. Deploy day must not change
 * anybody's storefront: a "simple" store keeps the simple three, everyone else
 * keeps the classic three. After the owner saves once, the stored list is the
 * only source of truth and catalogSortStyle stops being consulted.
 */
export function seedSortCategories(style: unknown): SortCategory[] {
  return clone(style === "simple" ? SIMPLE_SORT_CATEGORIES : DEFAULT_SORT_CATEGORIES);
}

/**
 * Coerce whatever is in config into a usable list: drop malformed rows and
 * unknown kinds, trim labels, fall a blank label back to the id (a blank
 * dropdown option is unidentifiable), and keep the FIRST of any duplicate id —
 * a duplicate would render twice and make the second unreachable.
 *
 * Returns the built-in default when nothing usable survives, so the storefront
 * can never render an empty sort menu. This is the same never-a-dead-end rule
 * as resolveSelectableCategories in categories.ts, and for the same reason: the
 * admin screen lets an owner delete every row.
 */
export function normalizeSortCategories(raw: unknown): SortCategory[] {
  if (!Array.isArray(raw)) return clone(DEFAULT_SORT_CATEGORIES);

  const seen = new Set<string>();
  const out: SortCategory[] = [];

  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Partial<SortCategory>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    if (!id || seen.has(id)) continue;
    if (!isKind(r.kind)) continue;
    seen.add(id);
    const label = typeof r.label === "string" ? r.label.trim() : "";
    out.push({ id, label: label || id, kind: r.kind, enabled: r.enabled !== false });
  }

  return out.length > 0 ? out : clone(DEFAULT_SORT_CATEGORIES);
}

/**
 * The storefront dropdown's options: enabled entries in the owner's order. Falls
 * back to the built-in default when the owner has disabled every last one —
 * disabling the whole menu is a config mistake, not a request for a broken
 * <select>.
 */
export function sortCategoryOptions(categories: readonly SortCategory[]): SortCategoryOption[] {
  const enabled = categories.filter((c) => c.enabled);
  const source = enabled.length > 0 ? enabled : DEFAULT_SORT_CATEGORIES;
  return source.map((c) => ({ value: c.id, label: c.label }));
}

/**
 * The entries a PRODUCT can be assigned to: enabled groups only. Built-ins are
 * behaviors, not buckets — there is nothing to belong to.
 */
export function assignableSortCategories(categories: readonly SortCategory[]): SortCategory[] {
  return categories.filter((c) => c.enabled && c.kind === "group").map((c) => ({ ...c }));
}

const byName = (a: SortableProduct, b: SortableProduct) => a.name.localeCompare(b.name);

/** Milliseconds for the "newest" built-in; an unparseable/absent date sorts last. */
function createdAtMs(p: SortableProduct): number {
  const t = p.createdAt ? Date.parse(p.createdAt) : Number.NaN;
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

function unitsSold(p: SortableProduct, counts: BestSellerCounts): number {
  return counts[p.id] ?? counts[`name:${p.name}`] ?? 0;
}

/** Sort by a BUILT-IN behavior. Always name-ordered as the final tiebreak, so
 *  the result is deterministic no matter what the data looks like. */
function sortByKind<T extends SortableProduct>(
  products: readonly T[],
  kind: Exclude<SortCategoryKind, "group" | "featured">,
  ctx: SortContext,
): T[] {
  const counts = ctx.bestSellerCounts ?? {};
  return [...products].sort((a, b) => {
    if (kind === "price-asc" && a.price !== b.price) return a.price - b.price;
    if (kind === "price-desc" && a.price !== b.price) return b.price - a.price;
    if (kind === "best-sellers") {
      const diff = unitsSold(b, counts) - unitsSold(a, counts);
      if (diff !== 0) return diff;
    }
    if (kind === "newest") {
      const diff = createdAtMs(b) - createdAtMs(a);
      if (diff !== 0) return diff;
    }
    return byName(a, b);
  });
}

/**
 * Sort the catalog by the shopper's dropdown pick. A group floats its members
 * to the top (name-ordered within, and name-ordered behind); a built-in runs its
 * comparator. An unknown id — a category the owner deleted while a stale sort
 * was saved in the shopper's session — degrades to name order rather than
 * blanking or scrambling the shelf.
 *
 * Always returns a new array; the input is never mutated.
 */
export function sortByCategory<T extends SortableProduct>(
  products: readonly T[],
  categoryId: string,
  categories: readonly SortCategory[],
  ctx: SortContext = {},
): T[] {
  const category = categories.find((c) => c.id === categoryId);
  if (!category) return sortByKind(products, "name", ctx);
  // Featured is the owner's own arrangement — their category blocks in admin
  // order — with featured products floated above the lot. It is the resting
  // view the catalog used to hardcode as an unnamed <option value="">.
  if (category.kind === "featured") {
    return pinFeatured(orderCatalogByCategories(products, categories));
  }
  if (category.kind !== "group") return sortByKind(products, category.kind, ctx);

  const members: T[] = [];
  const rest: T[] = [];
  for (const p of products) (p.sortCategory === category.id ? members : rest).push(p);
  return [...members.sort(byName), ...rest.sort(byName)];
}

/**
 * The DEFAULT catalog order, with no explicit pick: one block per group in the
 * owner's configured order, then everything else. Reordering the admin list
 * therefore reorders the live storefront, which is the point of the feature.
 *
 * A DISABLED group is not a block — but its products are NOT hidden either; they
 * fall to the unassigned tail. Same for a product pointing at a category that no
 * longer exists. A sort-menu toggle must never take stock off the shelf.
 */
export function orderCatalogByCategories<T extends SortableProduct>(
  products: readonly T[],
  categories: readonly SortCategory[],
): T[] {
  const blocks = categories.filter((c) => c.enabled && c.kind === "group");
  const byCategory = new Map<string, T[]>(blocks.map((c) => [c.id, []]));
  const unassigned: T[] = [];

  for (const p of products) {
    const bucket = p.sortCategory ? byCategory.get(p.sortCategory) : undefined;
    (bucket ?? unassigned).push(p);
  }

  return [
    ...blocks.flatMap((c) => (byCategory.get(c.id) ?? []).sort(byName)),
    ...unassigned.sort(byName),
  ];
}

/**
 * Float the owner's featured products to the very top, preserving the incoming
 * order within each partition (a stable partition, so whatever sort ran before
 * still holds inside the two halves).
 *
 * Applied to the default view and to group picks, but deliberately NOT to an
 * explicit Price / Name / Best-Sellers pick: pinning under "Price: Low to High"
 * would put an expensive featured item above a cheaper one and read as a bug.
 */
export function pinFeatured<T extends SortableProduct>(products: readonly T[]): T[] {
  const featured: T[] = [];
  const rest: T[] = [];
  for (const p of products) (p.featured ? featured : rest).push(p);
  return [...featured, ...rest];
}
