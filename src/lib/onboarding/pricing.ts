// The get-started checkout's "Amount to pay" — one pure function so the wizard
// paybox, the review summary, and any future server-side record all agree.
// PURE module (no server-only): the wizard imports it client-side.

import {
  PRO_TRIAL_PRICE_CENTS,
  STARTER_EXTRA_FEATURE_PRICE_CENTS,
} from "@/lib/onboarding/schema";
import { planMeta } from "@/lib/admin/plans";
import type { PlanConfig } from "@/lib/platform/plan-config";

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
 *  setup (the intro offer's promise), regardless of the plan's waived flag.
 *  `trialPriceCents` overrides the code-default trial price (the operator can
 *  edit it in plan config); the wizard display uses the default. */
export function checkoutQuote(
  pkg: QuotablePackage,
  opts: { trial: boolean; extraFeatureCount: number; trialPriceCents?: number },
): CheckoutQuote {
  const baseCents = opts.trial ? (opts.trialPriceCents ?? PRO_TRIAL_PRICE_CENTS) : pkg.priceCents;
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

/** The server-authoritative total stamped onto OnboardingSubmission.amountDueCents:
 *  the same checkoutQuote, fed from the operator-edited plan config (first-month
 *  promo as the effective price, config trialPriceCents for trials). Accepts
 *  legacy plan aliases (business → pro etc.). */
export function amountDueFromConfig(
  config: PlanConfig,
  opts: { planKey: string; trial: boolean; extraFeatureCount: number },
): number {
  const key = planMeta(opts.planKey).key;
  const plan = config.plans.find((p) => p.key === key);
  if (!plan) return 0;
  const discounted = Boolean(plan.discountPriceCents && plan.discountPriceCents < plan.priceCents);
  return checkoutQuote(
    {
      priceCents: discounted ? (plan.discountPriceCents as number) : plan.priceCents,
      setupFeeCents: plan.setupFeeCents,
      setupFeeWaived: plan.setupFeeWaived,
    },
    {
      trial: opts.trial,
      extraFeatureCount: opts.extraFeatureCount,
      trialPriceCents: config.trialPriceCents,
    },
  ).totalCents;
}
