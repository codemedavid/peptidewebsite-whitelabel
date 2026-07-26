// ON-HAND shelf ordering — which "ships now" listings a store leads with.
//
// Stores that sell the same peptide two ways end up with two kinds of on-hand
// listing side by side: single per-vial products ("Tirzepatide 30mg · ₱1,050")
// and multi-vial kits carried over from the bulk sheet ("Tirzepatide · 15mg ×
// 10 vials"). Catalog order is createdAt-ascending, so whichever was created
// first leads — which is how K Glow ended up showing 10-vial kits above the
// per-vial listings its shoppers actually buy.
//
//   "catalog" (default)  — today's order. Every existing tenant is unaffected.
//   "per-vial-first"     — single per-vial listings lead, sized-but-not-vial
//                          listings (bacteriostatic water volumes) follow, and
//                          the multi-vial kits sit underneath.
//
// This RE-ORDERS only: nothing is hidden, filtered, or re-priced, so a kit the
// owner still sells stays purchasable exactly as before — just lower down.
//
// The stored value lives on branding.config (untrusted JSON), so
// normalizeOnHandOrder fails closed to "catalog". Pure module (no DB, no React)
// — the whole surface is covered by npm run test:onhand-order.

/** How the on-hand shelf is ordered. */
export type OnHandOrder = "catalog" | "per-vial-first";

/** Coerce an untrusted config value. Anything that isn't exactly
 *  "per-vial-first" keeps today's catalog order — the safe default. */
export function normalizeOnHandOrder(value: unknown): OnHandOrder {
  return value === "per-vial-first" ? "per-vial-first" : "catalog";
}

/** The fields the ordering reads. Generic so callers keep their own concrete
 *  storefront `Product` type through the sort. */
export type OnHandOrderable = {
  name: string;
  variations?: { name: string; price: number }[];
};

// "× 10 vials", "x10 vials", "10 vial" — the multi-vial packaging sellers write
// on a kit listing. The count is captured so a listing that spells out a SINGLE
// vial ("× 1 vial") is still treated as sold per vial, not demoted as a kit.
const VIAL_COUNT = /(?:^|[^\d])(\d+)\s*vials?\b/i;

function multiVialLabel(label: string): boolean {
  const match = VIAL_COUNT.exec(label);
  return match ? Number(match[1]) > 1 : false;
}

/**
 * Is this listing sold as a multi-vial kit rather than per vial? True when the
 * product name or any variation name carries a vial count above one. Size-only
 * options ("50mg") and volumes ("10ml") are not kits — a product can offer
 * sizes and still be sold one vial at a time.
 */
export function isMultiVialListing(product: OnHandOrderable): boolean {
  if (multiVialLabel(product.name || "")) return true;
  const variations = Array.isArray(product.variations) ? product.variations : [];
  return variations.some((v) => multiVialLabel(v?.name || ""));
}

/**
 * Shelf tier, lowest first:
 *   0 — a single per-vial listing (no variations, no vial count): what the
 *       owner wants shoppers to hit first.
 *   1 — offers options but isn't a vial kit (e.g. bac water 3ml / 5ml / 10ml).
 *   2 — a multi-vial kit: sits under the per-vial listings.
 */
export function onHandRank(product: OnHandOrderable): 0 | 1 | 2 {
  if (isMultiVialListing(product)) return 2;
  const variations = Array.isArray(product.variations) ? product.variations : [];
  return variations.length === 0 ? 0 : 1;
}

/**
 * Order an on-hand shelf. Always returns a NEW array — the caller's list is
 * never mutated — and never adds or drops a product. Sorting is stable, so the
 * store's own catalog order still decides the running order inside each tier.
 * "catalog" is a pass-through copy, keeping every other tenant's shelf as-is.
 */
export function orderOnHandProducts<T extends OnHandOrderable>(
  products: T[],
  order: OnHandOrder,
): T[] {
  if (order !== "per-vial-first") return [...products];
  return products
    .map((product, index) => ({ product, index, rank: onHandRank(product) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.product);
}
