// Voucher ladder — the Shopee "spend ₱X more, get ₱Y off" pattern for a store's
// own promo codes. Codes the owner marks "Show in cart" (PromoCode.showInCart)
// are listed in the cart as rungs, cheapest minimum first, each with how far
// away the shopper is; the best rung the cart reaches is applied by itself, so
// nobody has to find and type a code to get a deal the store meant to give.
//
// The ladder never invents validity. A rung is "unlocked" only when the shared
// promoCodeError says the code is valid for this subtotal — the same check the
// checkout's Apply button and the server's stampDiscount run — so an
// auto-applied code is exactly a code the shopper could have typed. A rung
// whose only problem is the minimum spend is "locked" (a target); anything else
// wrong with it (inactive, expired, used up, a campaign-only code outside the
// sale) keeps it off the ladder entirely.
//
// Display only: the order carries the chosen code by name and the server
// re-derives the discount from config. Gated on FEATURES.STORE_VOUCHER_LADDER.
// Pure — covered by npm run test:mega-sale.

import type { PromoCode } from "@/storefront/types";
import type { CampaignWindow } from "./sale-campaign";
import { promoCodeError, promoDiscountAmount } from "./promo";

export type VoucherRungState = "applied" | "unlocked" | "locked";

export type VoucherRung = {
  code: string;
  /** "₱300 off" / "10% off". */
  offLabel: string;
  minPurchase: number;
  state: VoucherRungState;
  /** Spend still needed; 0 unless locked. */
  remaining: number;
  /** What it takes off THIS cart right now (0 while locked). */
  discount: number;
};

export type VoucherLadderOptions = {
  currency: string;
  campaignWindow: CampaignWindow | null;
  /** The code currently applied (typed or automatic), to mark its rung. */
  appliedCode?: string | null;
  now?: Date;
};

/** A subtotal large enough that any real percent or fixed code is worth > 0. */
const LADDER_PROBE_SUBTOTAL = 1_000_000;

function offLabel(p: PromoCode, currency: string): string {
  return p.type === "percent" ? `${p.value}% off` : `${currency}${p.value.toLocaleString()} off`;
}

/** Valid for this subtotal except, possibly, for falling short of its minimum. */
function onlyShortOfMinimum(p: PromoCode, opts: VoucherLadderOptions): boolean {
  // Probe at a cart comfortably past the code's minimum: if it is valid there,
  // the minimum is the only thing a smaller cart can be missing. (Probing AT a
  // tiny minimum rounds a percent code's discount to 0 and wrongly drops it.)
  const probe = Math.max(p.minPurchase, LADDER_PROBE_SUBTOTAL);
  return promoCodeError(p, probe, opts.currency, opts.now ?? new Date(), opts.campaignWindow) === null;
}

/** The cart's ladder rungs, lowest minimum first. Empty = nothing to show. */
export function buildVoucherLadder(
  codes: PromoCode[],
  subtotal: number,
  opts: VoucherLadderOptions,
): VoucherRung[] {
  const now = opts.now ?? new Date();
  const applied = (opts.appliedCode ?? "").toUpperCase();
  return codes
    .filter((p) => p.showInCart === true && onlyShortOfMinimum(p, opts))
    .map((p): VoucherRung => {
      const valid = promoCodeError(p, subtotal, opts.currency, now, opts.campaignWindow) === null;
      const state: VoucherRungState = !valid
        ? "locked"
        : p.code.toUpperCase() === applied
          ? "applied"
          : "unlocked";
      return {
        code: p.code,
        offLabel: offLabel(p, opts.currency),
        minPurchase: p.minPurchase,
        state,
        remaining: valid ? 0 : Math.max(0, Math.round((p.minPurchase - subtotal) * 100) / 100),
        discount: valid ? promoDiscountAmount(p, subtotal) : 0,
      };
    })
    .sort((a, b) => a.minPurchase - b.minPurchase || b.discount - a.discount);
}

/**
 * The best "Show in cart" code this subtotal qualifies for — the biggest
 * discount, ties going to the higher minimum (the deal the shopper worked
 * for) — or null when none qualifies.
 */
export function bestAutoVoucher(
  codes: PromoCode[],
  subtotal: number,
  opts: Omit<VoucherLadderOptions, "appliedCode">,
): PromoCode | null {
  const now = opts.now ?? new Date();
  let best: PromoCode | null = null;
  let bestAmount = 0;
  for (const p of codes) {
    if (p.showInCart !== true) continue;
    if (promoCodeError(p, subtotal, opts.currency, now, opts.campaignWindow) !== null) continue;
    const amount = promoDiscountAmount(p, subtotal);
    if (amount > bestAmount || (amount === bestAmount && best && p.minPurchase > best.minPurchase)) {
      best = p;
      bestAmount = amount;
    }
  }
  return bestAmount > 0 ? best : null;
}

/** The next locked rung — what the cart nudge talks about — or null. */
export function nextVoucherTarget(rungs: VoucherRung[]): VoucherRung | null {
  return rungs.find((r) => r.state === "locked") ?? null;
}
