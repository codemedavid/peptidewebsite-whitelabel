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
