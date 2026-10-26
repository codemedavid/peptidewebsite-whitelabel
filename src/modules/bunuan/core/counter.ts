/**
 * The admin's Bunuan counter and the checkout cap's count.
 *
 * Both count CLAIMS: every placed, non-cancelled order holds its vials, paid or
 * not. Under pay_first the kit rule (countsTowardKits) counts only checked
 * orders — but Start Bunuan is blocked until every Open order is checked, so
 * the only unchecked orders during Bunuan are Bunuan's own. If those didn't
 * hold their vials, two buyers could each be sold the same last 7. Ligwak and
 * the supplier report still use the payment-mode rule (and Lock is blocked
 * while any order awaits its check), so nothing is ever counted twice.
 *
 * Pure. Tested by npm run test:gb-stage-sync and the Bunuan flow.
 */

import {
  indexProducts,
  kitMath,
  kitSizeForLine,
  tallyKits,
  type GbPaymentMode,
  type KitOrder,
  type KitProduct,
  type KitTally,
  type KitTallyEntry,
} from "@/lib/storefront/gb-kits";
import { allKitsFilled, bunuanOpenItems } from "./rules";

/** Every placed, non-cancelled order's vials, per kit. */
export function bunuanClaimsTally(orders: readonly KitOrder[], products: readonly KitProduct[]): KitTally {
  return tallyKits(orders, products, "pay_later");
}

export type CounterKit = KitTallyEntry & { pendingVials: number };

/** What a shopper sees in Bunuan time: the options still buyable and the
 *  vials each can take, from the cached demand lines + the catalog's kit
 *  sizes. Display only — the checkout recounts live. By name. */
export function bunuanShopState(
  lines: readonly { productId: string | null; variation: string | null; name: string; vials: number }[],
  products: readonly KitProduct[],
): { open: { productId: string; variation: string | null; name: string; allowance: number }[] } {
  const index = indexProducts(products);
  const open = lines.flatMap((l) => {
    if (!l.productId) return [];
    const size = kitSizeForLine({ productId: l.productId, variation: l.variation ?? undefined }, index);
    const { vialsNeeded } = kitMath(l.vials, size);
    return vialsNeeded > 0 ? [{ productId: l.productId, variation: l.variation, name: l.name, allowance: vialsNeeded }] : [];
  });
  return { open: open.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Per kit: the claims, how many vials are still needed, and (pay_first) how
 *  many of the vials are on orders still awaiting a payment check. By name. */
export function bunuanCounter(
  orders: readonly KitOrder[],
  products: readonly KitProduct[],
  mode: GbPaymentMode,
): { kits: CounterKit[]; openCount: number; allFilled: boolean; claims: KitTally } {
  const claims = bunuanClaimsTally(orders, products);
  const checked = mode === "pay_first" ? tallyKits(orders, products, "pay_first") : claims;
  const kits = Object.values(claims)
    .map((k) => ({ ...k, pendingVials: k.vials - (checked[k.key]?.vials ?? 0) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  return { kits, openCount: bunuanOpenItems(claims).length, allFilled: allKitsFilled(claims), claims };
}
