// The owner's hand-arranged product order — Admin → Products lets them move
// products up/down (or drag them), and the storefront's default view follows.
//
// Stored as ONE list of product ids in branding.config.productOrder rather than
// a column per row: a reorder is then a single config write instead of N
// product updates inside one transaction (see the tx round-trip budget), and it
// needs no schema change.
//
// Products missing from the list (added after the last arrangement, or a store
// that never arranged) keep their incoming order after the arranged ones, and
// carry no `position` — so the catalog falls back to its old alphabetical order
// for them. Pure module; covered by npm run test:product-order.

/** Upper bound on stored ids — far above any real catalog, stops config bloat. */
export const MAX_PRODUCT_ORDER = 2000;
const MAX_ID_LENGTH = 100;

/** Coerce untrusted config/client input into a clean, de-duplicated id list. */
export function normalizeProductOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const id = v.trim();
    if (!id || id.length > MAX_ID_LENGTH || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_PRODUCT_ORDER) break;
  }
  return out;
}

/**
 * Put products in the owner's order and stamp each arranged one with its
 * `position` (0-based). Unlisted products follow in their incoming order with
 * `position` removed. Returns new objects; the input is never mutated.
 */
export function applyProductOrder<T extends { id: string; position?: number }>(
  products: readonly T[],
  order: readonly string[],
): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  const listed: T[] = [];
  const rest: T[] = [];
  for (const p of products) {
    const pos = rank.get(p.id);
    if (pos === undefined) {
      const { position: _drop, ...clean } = p;
      rest.push(clean as T);
    } else {
      listed.push({ ...p, position: pos });
    }
  }
  listed.sort((a, b) => (a.position as number) - (b.position as number));
  return [...listed, ...rest];
}

/** Move `id` by `delta` places (negative = up), clamped to the list ends. */
export function moveProduct(order: readonly string[], id: string, delta: number): string[] {
  const from = order.indexOf(id);
  if (from < 0) return [...order];
  const to = Math.max(0, Math.min(order.length - 1, from + delta));
  const next = order.filter((x) => x !== id);
  next.splice(to, 0, id);
  return next;
}

// ── Products follow the category order ───────────────────────────────────────
// Opt-in (Admin → Categories): when on, the shop lists products category by
// category in the owner's Categories order, and the hand arrangement above
// still decides the order INSIDE each category. Off (the default) keeps every
// store exactly as it was, so a live store's shelf never reshuffles on deploy.

/** branding.config.productsFollowCategories — only an explicit `true` is on. */
export const productsFollowCategories = (raw: unknown): boolean => raw === true;

/** The category ids in the owner's Categories order, without the synthetic
 *  "all" tab. Untrusted config in, clean de-duplicated ids out. */
export function categoryOrderIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const c of raw) {
    const id = typeof (c as { id?: unknown } | null)?.id === "string" ? (c as { id: string }).id.trim() : "";
    if (id && id !== "all") seen.add(id);
  }
  return [...seen];
}

type Groupable = { id: string; name: string; category?: string; position?: number };

/**
 * Regroup products by category, in `categoryIds` order. Inside a category the
 * arranged products keep their slots and the rest follow by name (the same
 * fallback the catalog's default view uses); products whose category is not in
 * the list go last. Every product is re-stamped with its final `position`, so
 * each reader that sorts by position — the catalog, both admin lists, the app —
 * shows this one order. Returns new objects; the input is never mutated.
 */
export function groupByCategoryOrder<T extends Groupable>(
  products: readonly T[],
  categoryIds: readonly string[],
): T[] {
  const rank = new Map(categoryIds.map((id, i) => [id, i]));
  const tail = categoryIds.length;
  const rankOf = (p: T) => rank.get(p.category ?? "") ?? tail;
  const slot = (p: T) => p.position ?? Number.POSITIVE_INFINITY;
  return [...products]
    .sort((a, b) => {
      const byCat = rankOf(a) - rankOf(b);
      if (byCat !== 0) return byCat;
      if (slot(a) !== slot(b)) return slot(a) < slot(b) ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((p, i) => ({ ...p, position: i }));
}

/** The store's product order from its branding.config: the hand arrangement,
 *  then — if the owner turned it on — grouped by the category order. The one
 *  call every product loader makes. */
export function arrangeStoreProducts<T extends Groupable>(
  products: readonly T[],
  config: { productOrder?: unknown; categories?: unknown; productsFollowCategories?: unknown } | null | undefined,
): T[] {
  const arranged = applyProductOrder(products, normalizeProductOrder(config?.productOrder));
  return productsFollowCategories(config?.productsFollowCategories)
    ? groupByCategoryOrder(arranged, categoryOrderIds(config?.categories))
    : arranged;
}

/** While products follow the category order, a move may not leave the
 *  product's own category (it would snap straight back). True when moving `id`
 *  by `delta` lands next to / onto a product of the same category. */
export function moveStaysInCategory(
  list: readonly { id: string; category?: string }[],
  id: string,
  delta: number,
): boolean {
  const from = list.findIndex((p) => p.id === id);
  if (from < 0) return false;
  const to = Math.max(0, Math.min(list.length - 1, from + delta));
  return (list[to]?.category ?? "") === (list[from]?.category ?? "");
}
