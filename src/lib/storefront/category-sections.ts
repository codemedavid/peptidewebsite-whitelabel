// Category sections — the "scroll through every category" catalog
// (FEATURES.STORE_CATEGORY_SECTIONS, operator-granted per tenant, default OFF).
//
// Instead of filtering the grid to one category at a time, the storefront lists
// EVERY category as its own section (heading + grid), in the owner's Categories
// order, with a sticky tab bar that follows the shopper's scroll.
//
// Two orders decide what the shopper sees:
//   1. Category order — the array order of branding.config.categories, the same
//      list the Categories screen already arranges. Nothing new is stored.
//   2. Product order inside each category — branding.config.categoryProductOrder,
//      a map of category id → product ids, arranged per category in the admin.
//      Each category keeps its own list, so a product's slot in one category is
//      never coupled to its slot in another.
//
// Products a category's list does not name (never arranged, newly added, or
// just moved into the category) follow the listed ones in the store's existing
// arrangement (Product.position from branding.config.productOrder, then name).
// So turning the feature on reshuffles nothing, and a newly assigned product
// lands at the end of its category.
//
// Pure module (no React, no server deps) — npm run test:category-sections.

import type { Category } from "@/storefront/types";
import { ALL_CATEGORY_ID } from "./categories";
import { normalizeProductOrder } from "./product-order";

/** The trailing section for products whose category matches none of the
 *  store's categories, so no product ever drops out of the catalog. */
export const OTHER_SECTION_ID = "__other";
export const OTHER_SECTION_LABEL = "Other";
/** The leading section of the owner's featured products (product.featured).
 *  A showcase only — each product still appears in its own category too. */
export const FEATURED_SECTION_ID = "__featured";
export const FEATURED_SECTION_LABEL = "Featured";

/** Caps on the stored map — far above any real store, stops config bloat. */
export const MAX_ORDERED_CATEGORIES = 200;
const MAX_CATEGORY_ID_LENGTH = 64;

export type CategoryProductOrder = Record<string, string[]>;

type Sectionable = { id: string; name: string; category?: string; position?: number };

export type CategorySection<T> = { id: string; label: string; products: T[] };

// ── Category matching ────────────────────────────────────────────────────────

/** The owner's own categories, in their order (no "all" tab, no duplicates). */
export function realCategories(categories: readonly Category[] | null | undefined): Category[] {
  const seen = new Set<string>();
  const out: Category[] = [];
  for (const c of categories ?? []) {
    if (!c || typeof c.id !== "string" || !c.id || c.id === ALL_CATEGORY_ID || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/**
 * Build a resolver from a product's stored `category` to one of the store's
 * category ids. Exact id first; then, ignoring case and surrounding spaces, the
 * id and then the label. Real catalogs need the loose match — products imported
 * or typed by hand carry "Peptides" where the category id is "peptides".
 * Returns null when nothing matches (the product goes to the Other section).
 */
export function categoryResolver(
  categories: readonly Category[] | null | undefined,
): (raw: string | undefined) => string | null {
  const real = realCategories(categories);
  const exact = new Set(real.map((c) => c.id));
  const byId = new Map<string, string>();
  const byLabel = new Map<string, string>();
  const key = (s: string) => s.trim().toLowerCase();
  for (const c of real) {
    if (!byId.has(key(c.id))) byId.set(key(c.id), c.id);
    const label = typeof c.label === "string" ? key(c.label) : "";
    if (label && !byLabel.has(label)) byLabel.set(label, c.id);
  }
  return (raw) => {
    if (typeof raw !== "string" || !raw.trim()) return null;
    if (exact.has(raw)) return raw;
    const k = key(raw);
    return byId.get(k) ?? byLabel.get(k) ?? null;
  };
}

// ── Stored per-category order ────────────────────────────────────────────────

/** Coerce untrusted config/client input into a clean category → ids map.
 *  Empty lists are dropped (an empty list means "never arranged"). */
export function normalizeCategoryProductOrder(raw: unknown): CategoryProductOrder {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: CategoryProductOrder = {};
  let count = 0;
  for (const [rawKey, list] of Object.entries(raw as Record<string, unknown>)) {
    const key = rawKey.trim();
    if (!key || key.length > MAX_CATEGORY_ID_LENGTH || key === ALL_CATEGORY_ID) continue;
    const ids = normalizeProductOrder(list);
    if (ids.length === 0) continue;
    out[key] = ids;
    if (++count >= MAX_ORDERED_CATEGORIES) break;
  }
  return out;
}

/** A new map with `categoryId`'s list replaced (or removed when empty). Keys
 *  for categories that no longer exist are pruned on the way. Never mutates. */
export function withCategoryProductOrder(
  current: CategoryProductOrder,
  categoryId: string,
  ids: readonly string[],
  liveCategoryIds: readonly string[],
): CategoryProductOrder {
  const live = new Set([...liveCategoryIds, OTHER_SECTION_ID]);
  const next: CategoryProductOrder = {};
  for (const [k, v] of Object.entries(current)) {
    if (k !== categoryId && live.has(k)) next[k] = [...v];
  }
  const clean = normalizeProductOrder(ids);
  if (clean.length > 0) next[categoryId] = clean;
  return next;
}

/** True when `categoryId` may carry an arrangement: a real category or Other. */
export function isArrangeableCategory(
  categoryId: unknown,
  categories: readonly Category[] | null | undefined,
): categoryId is string {
  if (typeof categoryId !== "string" || !categoryId) return false;
  if (categoryId === OTHER_SECTION_ID) return true;
  return realCategories(categories).some((c) => c.id === categoryId);
}

// ── Building the sections ────────────────────────────────────────────────────

/** The store's existing fallback order: arranged slot, then name. */
function byArrangement<T extends Sectionable>(a: T, b: T): number {
  const pa = a.position ?? Number.POSITIVE_INFINITY;
  const pb = b.position ?? Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa < pb ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/** Put one category's products in its stored order; unlisted ones follow in
 *  the store's existing arrangement. Returns a new array. */
export function orderCategoryProducts<T extends Sectionable>(
  products: readonly T[],
  ids: readonly string[] | undefined,
): T[] {
  const rank = new Map((ids ?? []).map((id, i) => [id, i]));
  const listed = products.filter((p) => rank.has(p.id));
  const rest = products.filter((p) => !rank.has(p.id));
  listed.sort((a, b) => (rank.get(a.id) as number) - (rank.get(b.id) as number));
  rest.sort(byArrangement);
  return [...listed, ...rest];
}

/**
 * Every non-empty category as a section, in the owner's category order, each
 * holding its products in that category's order — then an "Other" section for
 * products that match no category. Each product appears in exactly one section.
 */
export function buildCategorySections<T extends Sectionable>(
  products: readonly T[],
  categories: readonly Category[] | null | undefined,
  order: CategoryProductOrder | null | undefined,
): CategorySection<T>[] {
  const real = realCategories(categories);
  const resolve = categoryResolver(real);
  const buckets = new Map<string, T[]>(real.map((c) => [c.id, []]));
  const other: T[] = [];
  for (const p of products) {
    const id = resolve(p.category);
    if (id) buckets.get(id)!.push(p);
    else other.push(p);
  }
  const sections: CategorySection<T>[] = [];
  for (const c of real) {
    const list = buckets.get(c.id)!;
    if (list.length === 0) continue;
    sections.push({
      id: c.id,
      label: (typeof c.label === "string" && c.label.trim()) || c.id,
      products: orderCategoryProducts(list, order?.[c.id]),
    });
  }
  if (other.length > 0) {
    sections.push({
      id: OTHER_SECTION_ID,
      label: OTHER_SECTION_LABEL,
      products: orderCategoryProducts(other, order?.[OTHER_SECTION_ID]),
    });
  }
  return sections;
}

/**
 * Prepend a "Featured" section holding every featured product, in the order
 * they appear below (category order, then each category's arrangement), so
 * the owner's arranging also orders Featured. The products stay in their own
 * sections as well. No featured products = sections returned as they are.
 */
export function withFeaturedSection<T extends { id: string; featured?: boolean }>(
  sections: readonly CategorySection<T>[],
): CategorySection<T>[] {
  const seen = new Set<string>();
  const featured: T[] = [];
  for (const s of sections) {
    for (const p of s.products) {
      if (p.featured === true && !seen.has(p.id)) {
        seen.add(p.id);
        featured.push(p);
      }
    }
  }
  if (featured.length === 0) return [...sections];
  return [{ id: FEATURED_SECTION_ID, label: FEATURED_SECTION_LABEL, products: featured }, ...sections];
}

/** Narrow sections to products matching a search term; empty sections drop. */
export function filterSections<T extends { name: string; description?: string }>(
  sections: readonly CategorySection<T>[],
  query: string,
): CategorySection<T>[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...sections];
  return sections
    .map((s) => ({
      ...s,
      products: s.products.filter(
        (p) => p.name.toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q),
      ),
    }))
    .filter((s) => s.products.length > 0);
}

/** How many products each category id holds (loose matching, same as the
 *  sections), for the admin's per-row counts. */
export function countByCategory(
  products: readonly { category?: string }[],
  categories: readonly Category[] | null | undefined,
): Map<string, number> {
  const resolve = categoryResolver(categories);
  const counts = new Map<string, number>();
  for (const p of products) {
    const id = resolve(p.category) ?? OTHER_SECTION_ID;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

// ── Rearranging a list ───────────────────────────────────────────────────────

/** Move `id` to index `to` (clamped). Returns a new list; unknown id = copy. */
export function moveToIndex(list: readonly string[], id: string, to: number): string[] {
  const from = list.indexOf(id);
  if (from < 0) return [...list];
  const next = list.filter((x) => x !== id);
  const at = Math.max(0, Math.min(next.length, Math.trunc(to)));
  next.splice(at, 0, id);
  return next;
}

// ── Scroll tracking ──────────────────────────────────────────────────────────

/**
 * Which section the shopper is reading: the last one whose top has reached the
 * line just under the sticky header + tab bar. Above the first section, the
 * first one. Input tops are viewport-relative, in DOM order.
 */
export function pickActiveSection(
  sections: readonly { id: string; top: number }[],
  line: number,
): string | null {
  if (sections.length === 0) return null;
  let active = sections[0].id;
  for (const s of sections) {
    if (s.top - line <= 1) active = s.id;
    else break;
  }
  return active;
}
