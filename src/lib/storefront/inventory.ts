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
import { baseProductId, cartDisplayName } from "@/storefront/checkout";
import { buildProductOptions, type ProductOption, type Variation } from "./variations";
import { isGroupBuyPreorder } from "./two-ways-cart";
import type { GroupBuyPriceScope } from "./two-ways";

/** Just the fields the stock rules read — keeps callers from needing the full
 *  `Product` type (and avoids an import cycle back into components). */
type StockSource = { stock?: number | null; variations?: Variation[] };

/** What the whole-product availability rules read: the stock pools plus the base
 *  price, which decides whether a distinct "Standard" option is even offered.
 *  Structural on purpose — the two-ways shelf carries its own product shape. */
type AvailabilitySource = StockSource & { price: number };

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
export function productOutOfStock(product: AvailabilitySource): boolean {
  const options = buildProductOptions(product);
  if (options.length === 0) return Math.max(0, product.stock ?? 0) <= 0;
  return options.every((o) => isOptionOutOfStock(product, o));
}

/**
 * How many units of a product can be sold right now, across every pool it has.
 *
 * A product's stock lives in one or more independent POOLS, and summing the
 * per-option numbers would double-count: several untracked variations all draw
 * from the one base column. So the pools are counted, not the options —
 *   • each TRACKED variation contributes its own stock, and
 *   • the base column contributes ONCE, but only when something actually sells
 *     from it: a product with no variations, an untracked variation (which
 *     falls back to it), or a distinct base price offered as "Standard".
 * When every option is tracked and the base price is not separately offered,
 * the base column is not sellable and is deliberately ignored — that is the
 * stale number that used to advertise units nobody could buy.
 *
 * Agrees with productOutOfStock by construction: this is 0 exactly when every
 * option is exhausted.
 */
export function availableUnits(product: AvailabilitySource): number {
  const base = Math.max(0, product.stock ?? 0);
  const variations = product.variations ?? [];
  if (variations.length === 0) return base;

  const tracked = variations.filter((v) => typeof v.stock === "number");
  if (tracked.length === 0) return base;

  const trackedTotal = tracked.reduce((n, v) => n + Math.max(0, v.stock ?? 0), 0);
  const hasUntracked = tracked.length < variations.length;
  const offersStandard = buildProductOptions(product).some((o) => !o.variation);
  return trackedTotal + (hasUntracked || offersStandard ? base : 0);
}

/** A cart line the store can no longer fulfil. Shaped like a Smart Checkout
 *  rule violation (see checkout-rules.CheckoutRuleViolation) so the cart drawer
 *  renders and blocks on it through the one existing path, plus the base
 *  `productId` so a caller can point at the offending line. */
export type StockViolation = {
  rule: "stock";
  message: string;
  /** Always true. Unlike the owner-configurable checkout rules this is not
   *  subject to `ruleBasedCheckout`: selling stock that does not exist is not a
   *  preference. */
  blocking: true;
  productId: string;
};

/**
 * How many MORE units of a cart line the store can still supply, after what is
 * already in the cart. Drives the cart's "+" button, so a line at its cap can't
 * be incremented into a violation the customer then has to undo.
 *
 * Infinity for a group-buy pre-order: the round is supplied after it closes, so
 * there is no on-hand cap to hit.
 */
export function cartLineRoom(
  line: { product: Product; qty: number },
  scope: GroupBuyPriceScope | null = null,
): number {
  const { product, qty } = line;
  const id = baseProductId(product);
  if (isGroupBuyPreorder({ id, productType: product.productType }, scope)) return Infinity;
  return Math.max(0, effectiveStock(product, product.variantName) - qty);
}

/**
 * Every cart line the catalog can no longer cover — the CART-side half of the
 * out-of-stock gate.
 *
 * The add-to-cart cap (store.tsx) stops a sold-out item going in, and
 * placeStorefrontOrderAction re-checks at placement, but neither covers the gap
 * between: an item that sells out (owner edits stock, another customer takes
 * the last unit) WHILE it sits in the cart. Without this the customer only
 * finds out after filling in an address and uploading a payment proof.
 *
 * Expects lines already resolved against the live catalog (checkout.liveCartLines),
 * so each `product` carries current stock — a variation entry is measured against
 * its OWN pool, exactly as effectiveStock resolves it, instead of the shared base
 * column the cart's re-add used to read.
 *
 * Products inside the live round's scope are PRE-ORDERS — the supplier order is
 * placed after the round closes — so they are exempt, mirroring store.tsx
 * (isGroupBuyPreorder) and orders.ts (stockViolation).
 *
 * Unlike the server guard, which returns the FIRST offending line because it
 * only needs to reject, this returns them ALL: the customer is being asked to
 * fix the cart and should see everything wrong in one pass.
 */
export function cartStockViolations(
  lines: readonly { product: Product; qty: number }[],
  scope: GroupBuyPriceScope | null = null,
): StockViolation[] {
  const out: StockViolation[] = [];
  for (const { product, qty } of lines) {
    const id = baseProductId(product);
    if (isGroupBuyPreorder({ id, productType: product.productType }, scope)) continue;
    const stock = effectiveStock(product, product.variantName);
    if (qty <= stock) continue;
    const name = cartDisplayName(product);
    out.push({
      rule: "stock",
      productId: id,
      blocking: true,
      message:
        stock <= 0
          ? `"${name}" is out of stock — please remove it from your cart.`
          : `Only ${stock} of "${name}" left in stock — you have ${qty} in your cart.`,
    });
  }
  return out;
}
