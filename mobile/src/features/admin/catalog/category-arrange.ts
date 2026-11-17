/**
 * Arranging the products INSIDE one category — the website's Admin →
 * Categories → "Arrange products" (category sections). Mirrors
 * categoryResolver + orderCategoryProducts in the website's
 * lib/storefront/category-sections.ts (the app can't import website code);
 * npm run test:app-promo holds the two to the same answer. Pure.
 *
 * Saved through saveCategoryProductOrderAction(categoryId, ids) into
 * branding.config.categoryProductOrder[categoryId].
 */

type Cat = { id: string; label?: string };
type Arrangeable = { id: string; category?: string };

const ALL = "all";

/** The trailing section for products that match no category (category-sections.ts). */
export const OTHER_SECTION_ID = "__other";
export const OTHER_SECTION_LABEL = "Other";

/** Product's stored category → one of the store's category ids (exact id,
 *  then case/space-insensitive id, then label), or null. */
export function categoryResolver(categories: readonly Cat[]): (raw: string | undefined) => string | null {
  const real = categories.filter((c) => c && c.id && c.id !== ALL);
  const exact = new Set(real.map((c) => c.id));
  const key = (s: string) => s.trim().toLowerCase();
  const byId = new Map<string, string>();
  const byLabel = new Map<string, string>();
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

/** The saved per-category order map, read defensively from the brand. */
export function categoryOrderOf(brand: Record<string, unknown> | undefined): Record<string, string[]> {
  const raw = brand?.categoryProductOrder;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string");
  }
  return out;
}

/**
 * One category's products in the order the shop shows them: the stored list
 * first, then everything it doesn't name in the store's arrangement (the
 * order of `products`, which the admin list already is). New arrays only.
 */
export function categoryProducts<T extends Arrangeable>(
  products: readonly T[],
  categories: readonly Cat[],
  order: Record<string, string[]>,
  categoryId: string,
): T[] {
  const resolve = categoryResolver(categories);
  // "Other" holds every product that resolves to no category.
  const inCategory =
    categoryId === OTHER_SECTION_ID ? products.filter((p) => resolve(p.category) === null) : products.filter((p) => resolve(p.category) === categoryId);
  const rank = new Map((order[categoryId] ?? []).map((id, i) => [id, i]));
  const listed = inCategory.filter((p) => rank.has(p.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const rest = inCategory.filter((p) => !rank.has(p.id));
  return [...listed, ...rest];
}

/**
 * Products per category the way the storefront sections count them (loose
 * matching; unmatched → OTHER_SECTION_ID) — category-sections.ts countByCategory.
 */
export function countByCategory(products: readonly { category?: string }[], categories: readonly Cat[]): Map<string, number> {
  const resolve = categoryResolver(categories);
  const counts = new Map<string, number>();
  for (const p of products) {
    const id = resolve(p.category) ?? OTHER_SECTION_ID;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Move one id by `delta` places (clamped). Unknown id = unchanged copy. */
export function moveId(ids: readonly string[], id: string, delta: number): string[] {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Can this store arrange inside categories at all? (operator grant) */
export function categoryArrangeEnabled(brand: Record<string, unknown> | undefined): boolean {
  return brand?.categorySectionsEntitled === true;
}
