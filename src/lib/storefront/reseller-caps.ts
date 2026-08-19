// Server-side resolution of the tenant's reseller/wholesale entitlements.
// Mirrors resolveGroupBuyCaps: every child is ANDed with the parent switch, so
// revoking `storefront.reseller` turns the whole feature off in one move no
// matter what the children say.

import { getEntitlements } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";

/**
 * The two children are INDEPENDENT siblings — neither implies the other:
 *
 *   enabled  wholesale  page    what the tenant gets
 *   -------  ---------  ----    --------------------------------------------
 *   off      –          –       pure retail; no wholesale anywhere
 *   on       on         off     wholesale pricing on the regular storefront
 *   on       off        on      the gated #merchant portal only (today's stores)
 *   on       on         on      both surfaces, one engine, one product config
 *
 * A tenant can therefore run wholesale pricing without ever creating a reseller
 * page, which is the point of the split.
 */
export type ResellerCapabilities = {
  /** The parent switch. False means every capability below is false. */
  enabled: boolean;
  /** MOQ pricing on the regular storefront, cart and checkout. */
  wholesalePricing: boolean;
  /** The dedicated, access-code gated #merchant page and its admin manager. */
  resellerPage: boolean;
};

export const RESELLER_CAPS_OFF: ResellerCapabilities = {
  enabled: false,
  wholesalePricing: false,
  resellerPage: false,
};

/**
 * The capability shape for a resolved entitlement set. Pure, so the gate can be
 * asserted directly without a tenant or a database. Every child is ANDed with
 * the parent here — this is the single place that AND lives.
 */
export function resellerCapsFrom(set: ReadonlySet<string>): ResellerCapabilities {
  if (!set.has(FEATURES.STORE_RESELLER_PORTAL)) return RESELLER_CAPS_OFF;
  return {
    enabled: true,
    wholesalePricing: set.has(FEATURES.STORE_WHOLESALE_PRICING),
    resellerPage: set.has(FEATURES.STORE_RESELLER_PAGE),
  };
}

export async function resolveResellerCaps(tenantId: string): Promise<ResellerCapabilities> {
  return resellerCapsFrom(await getEntitlements(tenantId));
}
