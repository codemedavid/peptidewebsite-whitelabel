import "server-only";

// Server half of the promo engine (pure rules: sale-campaign.ts,
// free-shipping.ts, voucher-ladder.ts). ONE resolver for the three operator
// grants, shared by every server surface that prices a cart — order placement
// and quotes (orders.ts) and the public price refresh (products.ts) — so they
// can never disagree with the storefront render (storefront-brand.ts), which
// makes the same decisions from the same inputs.

import { FEATURES } from "@/lib/features/catalog";
import { getEntitlements } from "@/lib/features/entitlements";
import { campaignWindow, normalizeSaleCampaign, type CampaignWindow } from "./sale-campaign";
import { normalizeFreeShippingThreshold, type FreeShippingThreshold } from "./free-shipping";

export type PromoEngineContext = {
  /** The Sale Campaign window, or null when no campaign may run. */
  campaignWindow: CampaignWindow | null;
  freeShippingEntitled: boolean;
  /** The free-shipping rule as `config` states it (already market-projected
   *  when the caller passes a market view of the config). */
  freeShipping: FreeShippingThreshold;
};

export async function resolvePromoEngine(
  tenantId: string,
  config: Record<string, unknown>,
): Promise<PromoEngineContext> {
  const entitlements = await getEntitlements(tenantId);
  return {
    campaignWindow: campaignWindow(
      normalizeSaleCampaign(config.saleCampaign),
      entitlements.has(FEATURES.STORE_SALE_CAMPAIGN),
    ),
    freeShippingEntitled: entitlements.has(FEATURES.STORE_FREE_SHIPPING_THRESHOLD),
    freeShipping: normalizeFreeShippingThreshold(config.freeShippingThreshold),
  };
}
