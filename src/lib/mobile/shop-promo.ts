// The promo engine (Sale Campaign, voucher ladder, free shipping over ₱X) as
// the app's shop sees it. Pure — no DB, no Next — so npm run test:app-promo can
// run it; the server halves (shop-catalog.ts, shop-flow.ts) only feed it.
//
// Nothing here invents a rule: every decision is the website's own function
// (lib/storefront/sale-campaign, voucher-ladder, free-shipping), applied to the
// same inputs the website cart uses, so the app and the website can never
// disagree about a voucher, a shipping waiver or whether the sale is on.

import {
  campaignWindow,
  normalizeSaleCampaign,
  type CampaignWindow,
  type SaleCampaignConfig,
} from "@/lib/storefront/sale-campaign";
import { bestAutoVoucher, buildVoucherLadder } from "@/lib/storefront/voucher-ladder";
import {
  freeShippingProgress,
  normalizeFreeShippingThreshold,
  type FreeShippingThreshold,
} from "@/lib/storefront/free-shipping";
import { normalizePromoCodes } from "@/lib/storefront/promo";
import type { PromoCode } from "@/storefront/types";
import type { ShopFreeShippingProgress, ShopSaleCampaign, ShopVoucherRung } from "./shop-contract";

/**
 * The catalog's Sale Campaign: only while the operator granted it AND the
 * owner's campaign can run (switched on, valid dates). Fails closed to null.
 */
export function toShopSaleCampaign(
  campaign: SaleCampaignConfig | null | undefined,
  entitled: boolean,
): ShopSaleCampaign | null {
  if (!campaign || !campaignWindow(campaign, entitled)) return null;
  return {
    name: campaign.name,
    startsAt: campaign.startsAt,
    endsAt: campaign.endsAt,
    teaser: campaign.teaser,
    teaserDays: campaign.teaserDays,
    showBar: campaign.showBar,
  };
}

/** Everything the quote's promo extras need, read once per quote. */
export type ShopPromoContext = {
  currency: string;
  ladderEntitled: boolean;
  freeShippingEntitled: boolean;
  campaignWindow: CampaignWindow | null;
  freeShipping: FreeShippingThreshold;
  /** Only the owner's "Show in cart" codes — the rest never reach the phone. */
  ladderCodes: PromoCode[];
};

export type PromoGrants = { ladder: boolean; freeShipping: boolean; campaign: boolean };

/** Build the context from branding.config + the three operator grants. */
export function shopPromoContext(config: Record<string, unknown>, grants: PromoGrants): ShopPromoContext {
  const currency = typeof config.currency === "string" && config.currency ? config.currency : "₱";
  return {
    currency,
    ladderEntitled: grants.ladder,
    freeShippingEntitled: grants.freeShipping,
    campaignWindow: campaignWindow(normalizeSaleCampaign(config.saleCampaign), grants.campaign),
    freeShipping: normalizeFreeShippingThreshold(config.freeShippingThreshold),
    ladderCodes: grants.ladder ? normalizePromoCodes(config.promoCodes).filter((c) => c.showInCart === true) : [],
  };
}

/**
 * The code to auto-apply to a cart the shopper typed nothing into — the
 * website cart's bestAutoVoucher — or null. A typed code always wins.
 */
export function autoVoucherCode(
  ctx: ShopPromoContext,
  subtotal: number,
  typedCode: string,
  now: Date = new Date(),
): string | null {
  if (typedCode || !ctx.ladderEntitled) return null;
  const best = bestAutoVoucher(ctx.ladderCodes, subtotal, {
    currency: ctx.currency,
    campaignWindow: ctx.campaignWindow,
    now,
  });
  return best?.code ?? null;
}

export type ShopQuotePromo = {
  vouchers: ShopVoucherRung[];
  freeShipping: ShopFreeShippingProgress | null;
};

/** The ladder rungs + free-shipping bar for a quoted subtotal (pre-discount). */
export function shopQuotePromo(
  ctx: ShopPromoContext,
  subtotal: number,
  appliedCode: string | null,
  now: Date = new Date(),
): ShopQuotePromo {
  const vouchers = ctx.ladderEntitled
    ? buildVoucherLadder(ctx.ladderCodes, subtotal, {
        currency: ctx.currency,
        campaignWindow: ctx.campaignWindow,
        appliedCode,
        now,
      })
    : [];
  const freeShipping = freeShippingProgress(ctx.freeShipping, subtotal, {
    entitled: ctx.freeShippingEntitled,
    campaignWindow: ctx.campaignWindow,
    now: now.getTime(),
  });
  return { vouchers, freeShipping };
}
