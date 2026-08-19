// Wholesale (MOQ) pricing — the single engine behind BOTH wholesale surfaces:
// the regular storefront/cart and the dedicated reseller page. There is one
// product-level config and one resolver; neither surface carries pricing rules
// of its own.
//
// THE RULE
//   The MOQ and the wholesale unit price are configured ONCE on the PARENT
//   product. Every variation shares them, and the quantities of all variations
//   COMBINE toward that one MOQ. Reaching it prices the WHOLE quantity at the
//   wholesale price — the MOQ is a floor, never a cap.
//
//     Vial Caps — retail P10, wholesale P7, MOQ 1,000
//       Red 250 + Black 250 + Blue 250 + Yellow 250 = 1,000  ->  all 1,000 at P7
//
//   Parents are evaluated INDEPENDENTLY: 800 Vial Caps (of 1,000) plus 300
//   Syringes (of 500) is not 1,100 units of anything, and unlocks neither.

import type { Product } from "@/storefront/types";

/** The product-level wholesale config: one MOQ, one wholesale unit price. */
export type WholesaleConfig = NonNullable<Product["wholesale"]>;

/**
 * Bulk threshold for a LEGACY reseller leg that set no `minQty` of its own.
 *
 * This is the old global default, and it survives only on the legacy path. The
 * new config has no global fallback: an MOQ is per product and required (see
 * `resolveWholesale`), because a store-wide number cannot be right for both a
 * 1,000-piece cap and a 100-piece box.
 */
export const RESELLER_MIN_QTY = 10;

/**
 * The underlying catalog product id for a cart entry — the real row id for a
 * variation clone, or the entry's own id for an ordinary product. This is the
 * key everything wholesale groups by, and it is the same key stock deduction and
 * group-buy scoping already use.
 *
 * `checkout.baseProductId` is the long-standing public name and delegates here,
 * so there is exactly one implementation. It lives in this module rather than in
 * checkout.ts because checkout.ts imports this file, not the reverse.
 */
export function parentProductId(p: Pick<Product, "id" | "variantOf">): string {
  return p.variantOf ?? p.id;
}

/**
 * The wholesale config in force for a product, or null if it offers none.
 *
 * Two shapes resolve here, deliberately, and this is the ONLY place that knows
 * both:
 *
 *  1. `wholesale` — the current config the Product Management screen writes
 *     (stored in `metadata.wholesale`). It wins whenever present, and it is the
 *     shape that propagates to a variation clone, so variations of one parent
 *     share one MOQ and one price.
 *
 *  2. `reseller` — the legacy two-tier leg (vials only / complete set) that
 *     predates this feature and still prices live stores. Deriving it here
 *     instead of migrating the data means those stores keep their exact current
 *     prices, and it never reaches a variation: `makeVariationEntry` drops
 *     `reseller` (see the k-glow note there), so a legacy product's variations
 *     behave exactly as they do today.
 *
 * An incomplete config resolves to null rather than to a partial rule — the
 * admin screen blocks saving one, and a price of 0 or an MOQ of 0 is not a tier.
 */
export function resolveWholesale(p: Product): WholesaleConfig | null {
  const w = p.wholesale;
  if (w) {
    if (!w.enabled) return null;
    return w.moq > 0 && w.price > 0 ? w : null;
  }

  const r = p.reseller;
  if (!r) return null;
  const price = r.completeSet || r.vialsOnly || 0;
  if (price <= 0) return null;
  const moq = typeof r.minQty === "number" && r.minQty > 0 ? r.minQty : RESELLER_MIN_QTY;
  return { enabled: true, moq, price };
}

/**
 * Cart-level wholesale context: how many units of each PARENT product the cart
 * holds in total. Threaded into pricing the same way `GroupBuyPriceScope` is —
 * an optional argument that defaults to null, so a caller that has no cart (a
 * lone product card, a legacy call site) prices exactly as it did before.
 */
export type WholesaleScope = {
  readonly qtyByParent: ReadonlyMap<string, number>;
};

/**
 * Sum the cart by parent product. `enabled` is the tenant's wholesale-pricing
 * entitlement: without it this returns null and every caller falls back to
 * per-line quantities, which is today's behavior exactly.
 *
 * Grouping by parent id is what keeps products independent — two different
 * products can never pool, because they are different keys. It is also why a
 * future add-on line cannot count toward a product's MOQ: an add-on is its own
 * product row, so it lands under its own key.
 */
export function buildWholesaleScope(
  lines: readonly { product: Product; qty: number }[],
  enabled: boolean,
): WholesaleScope | null {
  if (!enabled) return null;
  const qtyByParent = new Map<string, number>();
  for (const l of lines) {
    const key = parentProductId(l.product);
    qtyByParent.set(key, (qtyByParent.get(key) ?? 0) + l.qty);
  }
  return { qtyByParent };
}

/**
 * The quantity a line is measured against for MOQ purposes: its parent's
 * combined cart quantity when a scope is present, else the line's own quantity.
 */
export function wholesaleQty(p: Product, qty: number, scope: WholesaleScope | null): number {
  if (!scope) return qty;
  return scope.qtyByParent.get(parentProductId(p)) ?? qty;
}

/**
 * The server-side counterpart of `buildWholesaleScope`: the same per-parent
 * quantities, built from a STORED order's lines instead of the cart's.
 *
 * The client stamps `productId` with the parent id already, but a line is
 * matched here exactly the way `authoritativeItemPrice` matches it — by
 * productId, else by name — and keyed by the resolved row's own id. Diverging
 * from that matching is the one way client and server could disagree on whether
 * an order reached its MOQ, so the two must stay identical. A line matching no
 * live product contributes nothing, mirroring the re-price's skip rule.
 */
export function orderWholesaleScope(
  items: readonly { productId?: string; name: string; qty: number }[],
  catalog: readonly Product[],
  enabled: boolean,
): WholesaleScope | null {
  if (!enabled) return null;
  const qtyByParent = new Map<string, number>();
  for (const it of items) {
    const live = catalog.find((p) => (it.productId ? p.id === it.productId : p.name === it.name));
    if (!live) continue;
    qtyByParent.set(live.id, (qtyByParent.get(live.id) ?? 0) + it.qty);
  }
  return { qtyByParent };
}

/**
 * How many MORE units of this product's parent unlock the wholesale price, or 0
 * when there is nothing useful to say — no rule, already qualified, or a rule
 * that could never apply because its price is not below what the line pays now.
 *
 * This is the cart's "buy N more" nudge, and it counts the COMBINED quantity for
 * the same reason the price does. With 250 Red + 250 Black + 250 Blue against a
 * 1,000 MOQ the customer needs 250 more, not 750 — a per-line answer would tell
 * them to buy three times what they actually need.
 */
export function wholesaleRemaining(
  p: Product,
  qty: number,
  scope: WholesaleScope | null,
): number {
  const cfg = resolveWholesale(p);
  if (!cfg) return 0;
  const base = p.discountEnabled && typeof p.discountPrice === "number" ? p.discountPrice : p.price;
  if (cfg.price >= base) return 0;
  return Math.max(0, cfg.moq - wholesaleQty(p, qty, scope));
}
