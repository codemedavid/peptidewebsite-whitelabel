// The get-started checkout's "Amount to pay" — one pure function so the wizard
// paybox, the review summary, and any future server-side record all agree.
// PURE module (no server-only): the wizard imports it client-side.

import {
  PRO_TRIAL_PRICE_CENTS,
  STARTER_EXTRA_FEATURE_PRICE_CENTS,
} from "@/lib/onboarding/schema";

/** The pricing fields checkoutQuote needs from a marketing Package. */
export type QuotablePackage = {
  priceCents: number; // effective first payment (first-month promo when set, else list)
  setupFeeCents: number; // one-time setup fee (0 = none)
  setupFeeWaived: boolean; // fee shown struck through as FREE setup
};

export type CheckoutQuote = {
  baseCents: number; // trial price, or the package's effective first payment
  addonCents: number; // Starter extra features beyond the included allotment
  setupFeeCents: number; // what's actually charged (0 when waived/none)
  setupFeeWaived: boolean; // a nonzero fee exists but is FREE (show it struck through)
  totalCents: number;
};

/** Amount due at onboarding checkout. The Business trial always includes FREE
 *  setup (the intro offer's promise), regardless of the plan's waived flag. */
export function checkoutQuote(
  pkg: QuotablePackage,
  opts: { trial: boolean; extraFeatureCount: number },
): CheckoutQuote {
  const baseCents = opts.trial ? PRO_TRIAL_PRICE_CENTS : pkg.priceCents;
  const addonCents =
    Math.max(0, Math.floor(opts.extraFeatureCount)) * STARTER_EXTRA_FEATURE_PRICE_CENTS;
  const waived = pkg.setupFeeCents > 0 && (pkg.setupFeeWaived || opts.trial);
  const setupFeeCents = pkg.setupFeeCents > 0 && !waived ? pkg.setupFeeCents : 0;
  return {
    baseCents,
    addonCents,
    setupFeeCents,
    setupFeeWaived: waived,
    totalCents: baseCents + addonCents + setupFeeCents,
  };
}
