import type { Product } from "@/storefront/types";
import { resolveWholesale, parentProductId } from "./wholesale";

/**
 * The reseller order's MOQ rule. Pure — no database, no cookies — so it is
 * unit-testable (scripts/test-reseller-moq.ts) and the checkout has exactly one
 * implementation of it.
 *
 * WHY THIS EXISTS AT ALL, given the re-price already handles MOQ:
 *
 *   The server-authoritative re-price (orders.ts) makes an under-MOQ line SAFE
 *   on its own — the wholesale price simply doesn't apply, so the customer pays
 *   retail and nobody is ever charged a tier they didn't earn. That is the
 *   security property, and it holds with or without this file.
 *
 *   This is the stricter UX rule the reseller catalog advertises. That page
 *   floors every quantity stepper at the product's MOQ, so a reseller who
 *   arrives under it did so by editing the cart afterwards. Silently re-pricing
 *   them to retail would hand back a wholesale-looking order at retail totals
 *   with no explanation of why the numbers moved. Failing loudly says what to fix.
 *
 * SCOPE is deliberately narrow, so an ordinary shopper can never trip it:
 *   - only for orders already stamped `reseller` (i.e. a verified session);
 *   - only for products that actually carry a wholesale config — a reseller may
 *     still buy an ordinary retail product at any quantity;
 *   - measured on the COMBINED per-parent quantity, exactly as the pricing does,
 *     so a reseller splitting an MOQ across a product's variations qualifies.
 */

export type MoqLine = { productId?: string; name: string; qty: number };

/**
 * The first MOQ shortfall in this order, as a customer-facing message, or null
 * when every wholesale product in it reaches its minimum.
 *
 * Lines are matched to the catalog exactly the way `authoritativeItemPrice` and
 * `orderWholesaleScope` match them — by productId, else by name — because a
 * different matching rule here would let client and server disagree about
 * whether an order reached its MOQ. A line matching no live product contributes
 * nothing, mirroring the re-price's skip rule.
 */
export function resellerMoqViolation(
  items: readonly MoqLine[],
  catalog: readonly Product[],
): string | null {
  const qtyByParent = new Map<string, number>();
  for (const it of items) {
    const live = catalog.find((p) => (it.productId ? p.id === it.productId : p.name === it.name));
    if (!live) continue;
    const key = parentProductId(live);
    qtyByParent.set(key, (qtyByParent.get(key) ?? 0) + it.qty);
  }

  for (const [productId, qty] of qtyByParent) {
    const live = catalog.find((p) => p.id === productId);
    if (!live) continue;
    const cfg = resolveWholesale(live);
    if (!cfg) continue; // no wholesale tier → nothing to enforce
    if (qty >= cfg.moq) continue;
    const short = cfg.moq - qty;
    return `${live.name} has a minimum reseller order of ${cfg.moq.toLocaleString()} units — your cart has ${qty.toLocaleString()}. Add ${short.toLocaleString()} more to check out at the reseller price.`;
  }
  return null;
}
