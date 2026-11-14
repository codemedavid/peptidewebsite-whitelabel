// Store-wide free shipping over a minimum spend — "Free shipping on orders
// ₱1,500+", with the "Add ₱300 more for free shipping" nudge in the cart.
//
// Distinct from the per-product Product.freeShipping flag (checkout.ts
// hasFreeShippingLine): that one waives shipping whenever a tagged product is
// in the cart; this one waives it once the ITEMS subtotal reaches the owner's
// minimum. Either is enough.
//
// The subtotal is the items subtotal BEFORE any promo-code discount — the same
// base a promo code's own minimum is measured on (promo.ts), so the voucher
// ladder and the shipping bar in the cart count toward their targets in the
// same currency units and never disagree about how far away a shopper is.
//
// Only the shipping-LOCATION fee is waived. A cash-on-delivery courier already
// costs nothing here, and a pay-after-close group buy's flat fee belongs to the
// round invoice, which runs after this and keeps its own rule.
//
// Stored in branding.config.freeShippingThreshold; gated on the operator grant
// FEATURES.STORE_FREE_SHIPPING_THRESHOLD, re-checked at placement (orders.ts
// stampShipping) so display and charge use one rule. Pure — covered by
// npm run test:mega-sale.

import { isWindowLive, type CampaignWindow } from "./sale-campaign";

export type FreeShippingThreshold = {
  enabled: boolean;
  /** Items subtotal (store currency) that unlocks free shipping. */
  minSubtotal: number;
  /** Dual-currency stores: the International (USD) minimum. Absent = the
   *  International cart never gets free shipping from this rule. */
  usdMinSubtotal?: number;
  /** Only while the Sale Campaign is live. */
  campaignOnly: boolean;
};

export const EMPTY_FREE_SHIPPING: FreeShippingThreshold = {
  enabled: false,
  minSubtotal: 0,
  campaignOnly: false,
};

function positive(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

/** Coerce untrusted config/client input. An "on" rule with no minimum would
 *  make every order ship free by accident, so it is saved switched off. */
export function normalizeFreeShippingThreshold(input: unknown): FreeShippingThreshold {
  const o = (input ?? {}) as Record<string, unknown>;
  const minSubtotal = positive(o.minSubtotal);
  const usd = positive(o.usdMinSubtotal);
  return {
    enabled: o.enabled === true && minSubtotal > 0,
    minSubtotal,
    ...(usd > 0 ? { usdMinSubtotal: usd } : {}),
    campaignOnly: o.campaignOnly === true,
  };
}

/** The International market's view: its USD minimum, or switched off. */
export function intlFreeShippingThreshold(input: unknown): FreeShippingThreshold {
  const t = normalizeFreeShippingThreshold(input);
  if (!t.usdMinSubtotal) return { ...t, enabled: false, minSubtotal: 0 };
  return { ...t, minSubtotal: t.usdMinSubtotal };
}

export type FreeShippingContext = {
  /** The operator grant. */
  entitled: boolean;
  /** The Sale Campaign window (null = no campaign running at all). */
  campaignWindow: CampaignWindow | null;
  now?: number;
};

/** Is the rule switched on and allowed to run right now? */
export function freeShippingRuleActive(t: FreeShippingThreshold, ctx: FreeShippingContext): boolean {
  if (!ctx.entitled || !t.enabled || t.minSubtotal <= 0) return false;
  if (t.campaignOnly && !isWindowLive(ctx.campaignWindow, ctx.now ?? Date.now())) return false;
  return true;
}

/** Does this items subtotal ship free under the rule? */
export function qualifiesForFreeShipping(
  t: FreeShippingThreshold,
  subtotal: number,
  ctx: FreeShippingContext,
): boolean {
  return freeShippingRuleActive(t, ctx) && subtotal >= t.minSubtotal;
}

export type FreeShippingProgress = {
  threshold: number;
  /** How much more to spend; 0 once reached. */
  remaining: number;
  reached: boolean;
  /** 0–1 for the progress bar. */
  fraction: number;
};

/** The cart nudge, or null when the rule isn't running. */
export function freeShippingProgress(
  t: FreeShippingThreshold,
  subtotal: number,
  ctx: FreeShippingContext,
): FreeShippingProgress | null {
  if (!freeShippingRuleActive(t, ctx)) return null;
  const remaining = Math.max(0, Math.round((t.minSubtotal - subtotal) * 100) / 100);
  return {
    threshold: t.minSubtotal,
    remaining,
    reached: remaining === 0,
    fraction: Math.max(0, Math.min(1, subtotal / t.minSubtotal)),
  };
}
