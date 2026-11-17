import { authoritativeItemPrice } from "@/storefront/checkout";
import type { OrderItem, Product } from "@/storefront/types";
import type { GroupBuyPriceScope } from "@/lib/storefront/two-ways";
import type { WholesaleScope } from "@/lib/storefront/wholesale";

/**
 * Re-price every order line from the live catalog, so the order is STORED — and
 * every percentage fee and discount is charged — at the CURRENT price, never a
 * stale or tampered client value.
 *
 * Every line must resolve to a live product (and, when it names one, a live
 * variation of it). A line that doesn't is REFUSED rather than kept at the
 * price the browser sent: keeping it let a hand-rolled request order an
 * invented "item" at any price it liked. A real cart always matches — both the
 * website and the app send the catalog row id — so the only honest way to hit
 * this is a product or option the owner removed mid-session, and the message
 * tells that shopper what to do.
 *
 * All-or-nothing: on refusal nothing is repriced. On success it returns a NEW
 * items array; the input is never mutated.
 */
export type RepriceResult = { ok: true; items: OrderItem[] } | { ok: false; error: string };

export function repriceOrderItems(
  items: readonly OrderItem[],
  catalog: Product[],
  groupBuyScope: GroupBuyPriceScope | null = null,
  wholesaleScope: WholesaleScope | null = null,
): RepriceResult {
  const repriced: OrderItem[] = [];
  for (const it of items) {
    const live = authoritativeItemPrice(it, catalog, groupBuyScope, wholesaleScope);
    if (live == null) {
      const label = it.variation ? `${it.name} (${it.variation})` : it.name;
      return {
        ok: false,
        error: `"${label}" isn't available anymore. Please remove it from your cart and try again.`,
      };
    }
    repriced.push({ ...it, price: live });
  }
  return { ok: true, items: repriced };
}
