// Per-variation inventory & availability — the ONE place that answers "how many
// of this line are available" and "how do I move stock when an order confirms".
//
// A product carries a base `stock` column. A variation MAY carry its own `stock`
// (opt-in). The fallback rule keeps every pre-existing product working: a
// variation with no `stock` still draws from the base column (the historical
// shared-stock behavior); only a variation with a numeric `stock` is tracked as
// its own pool. Kept pure (no DB, no React) and shared so the cart cap, the
// checkout guard, the order deduction, and the storefront display never drift.
//
// Covered by scripts/test-variant-inventory.ts.

import type { Product, OrderItem } from "@/storefront/types";
import { buildProductOptions, type ProductOption, type Variation } from "./variations";

/** Just the fields the stock rules read — keeps callers from needing the full
 *  `Product` type (and avoids an import cycle back into components). */
type StockSource = { stock?: number | null; variations?: Variation[] };

/**
 * A variation's OWN tracked stock, or `undefined` when it isn't tracked (no
 * `variationName`, no such variation, or the variation carries no numeric
 * `stock`). `undefined` is the signal to fall back to the base column — note a
 * tracked value of 0 is NOT undefined, so a sold-out variation stays sold out.
 */
export function variationStock(
  product: StockSource,
  variationName?: string,
): number | undefined {
  if (!variationName) return undefined;
  const v = (product.variations ?? []).find((x) => x.name === variationName);
  return v && typeof v.stock === "number" ? v.stock : undefined;
}

/**
 * Units available for a line: the variation's own stock when tracked, else the
 * base column. Clamped to ≥ 0 so no caller ever sees a negative count.
 */
export function effectiveStock(product: StockSource, variationName?: string): number {
  const own = variationStock(product, variationName);
  return Math.max(0, own ?? product.stock ?? 0);
}

/**
 * Return a new variations array with the named variation's stock moved by
 * `delta`, clamped at zero. Only variations that are already tracked (numeric
 * `stock`) are touched — an untracked variation is left exactly as-is, because
 * its stock lives on the base column and the caller adjusts that instead.
 * Immutable: never mutates the input.
 */
export function applyVariationStock(
  variations: readonly Variation[],
  variationName: string,
  delta: number,
): Variation[] {
  return variations.map((v) =>
    v.name === variationName && typeof v.stock === "number"
      ? { ...v, stock: Math.max(0, v.stock + delta) }
      : { ...v },
  );
}

/**
 * Apply an order's line items to a product list (− on deduct, + on restock),
 * per variation, clamping at zero. Lines match by `productId` when present, by
 * exact `name` for legacy orders — the same rule the checkout guard uses.
 *
 * A line for a TRACKED variation moves that variation's own pool and leaves the
 * base column untouched; a line for an untracked variation (or no variation)
 * moves the base column. Immutable — returns a new product list.
 */
export function applyStockMoveToProducts(
  products: readonly Product[],
  items: readonly OrderItem[],
  move: "deduct" | "restock",
): Product[] {
  const dir = move === "deduct" ? -1 : 1;
  return products.map((p) => {
    const matches = items.filter((it) =>
      it.productId ? it.productId === p.id : it.name === p.name,
    );
    if (matches.length === 0) return p;

    let variations = p.variations;
    let baseDelta = 0;
    for (const it of matches) {
      const qty = it.qty || 0;
      if (qty <= 0) continue;
      const tracked = variationStock(p, it.variation) !== undefined;
      if (it.variation && tracked) {
        variations = applyVariationStock(variations ?? [], it.variation, dir * qty);
      } else {
        baseDelta += dir * qty;
      }
    }

    const next: Product = { ...p };
    if (variations !== p.variations) next.variations = variations;
    if (baseDelta !== 0) next.stock = Math.max(0, (p.stock || 0) + baseDelta);
    return next;
  });
}

/** Available units for one option on the card/modal — the base price ("Standard")
 *  resolves to the base column, a real variation to its effective stock. */
export function optionStock(product: StockSource, option: ProductOption): number {
  return effectiveStock(product, option.variation?.name);
}

/** Whether one option can no longer be added to the cart. */
export function isOptionOutOfStock(product: StockSource, option: ProductOption): boolean {
  return optionStock(product, option) <= 0;
}

/**
 * Whether the whole product is out of stock (drives the card's "Out of stock"
 * badge and disabled CTA). With no variations this is simply the base column at
 * zero; with variations it's true ONLY when every option is exhausted — one
 * stocked option keeps the product buyable.
 */
export function productOutOfStock(product: Product): boolean {
  const options = buildProductOptions(product);
  if (options.length === 0) return Math.max(0, product.stock ?? 0) <= 0;
  return options.every((o) => isOptionOutOfStock(product, o));
}
