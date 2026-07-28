// The get-started checkout's "Amount to pay" — one pure function so the wizard
// paybox, the review summary, and any future server-side record all agree.
// PURE module (no server-only): the wizard imports it client-side.

import {
  PRO_TRIAL_PRICE_CENTS,
  STARTER_EXTRA_FEATURE_PRICE_CENTS,
  normalizeOnboardingCycle,
  type OnboardingBillingCycle,
} from "@/lib/onboarding/schema";
import { planMeta } from "@/lib/admin/plans";
import type { PlanConfig } from "@/lib/platform/plan-config";

/** The pricing fields checkoutQuote needs from a marketing Package. */
export type QuotablePackage = {
  priceCents: number; // effective first payment (first-month promo when set, else list)
  yearlyPriceCents: number; // flat prepaid 12-month term price
  setupFeeCents: number; // one-time setup fee (0 = none)
  setupFeeWaived: boolean; // fee shown struck through as FREE setup
};

export type CheckoutQuote = {
  billingCycle: OnboardingBillingCycle; // what the base price actually covers
  baseCents: number; // trial price, the effective first payment, or the yearly term
  addonCents: number; // Starter extra features beyond the included allotment
  setupFeeCents: number; // what's actually charged (0 when waived/none)
  setupFeeWaived: boolean; // a nonzero fee exists but is FREE (show it struck through)
  totalCents: number;
};

/** Amount due at onboarding checkout. The Business trial always includes FREE
 *  setup (the intro offer's promise), regardless of the plan's waived flag.
 *  `trialPriceCents` overrides the code-default trial price (the operator can
 *  edit it in plan config); the wizard display uses the default.
 *
 *  `billingCycle` (default monthly) only swaps the subscription base: a yearly
 *  sign-up prepays the flat term price instead of one month. Everything else is
 *  cycle-independent — the one-time setup fee is charged/waived exactly as
 *  before, and Starter's extra add-on features stay a flat per-feature charge
 *  rather than scaling with the term. The ₱699 trial is by definition a
 *  one-month offer, so choosing it forces the cycle back to monthly. */
export function checkoutQuote(
  pkg: QuotablePackage,
  opts: {
    trial: boolean;
    extraFeatureCount: number;
    trialPriceCents?: number;
    billingCycle?: OnboardingBillingCycle;
  },
): CheckoutQuote {
  const billingCycle = opts.trial ? "monthly" : normalizeOnboardingCycle(opts.billingCycle);
  const subscriptionCents = billingCycle === "yearly" ? pkg.yearlyPriceCents : pkg.priceCents;
  const baseCents = opts.trial ? (opts.trialPriceCents ?? PRO_TRIAL_PRICE_CENTS) : subscriptionCents;
  const addonCents =
    Math.max(0, Math.floor(opts.extraFeatureCount)) * STARTER_EXTRA_FEATURE_PRICE_CENTS;
  const waived = pkg.setupFeeCents > 0 && (pkg.setupFeeWaived || opts.trial);
  const setupFeeCents = pkg.setupFeeCents > 0 && !waived ? pkg.setupFeeCents : 0;
  return {
    billingCycle,
    baseCents,
    addonCents,
    setupFeeCents,
    setupFeeWaived: waived,
    totalCents: baseCents + addonCents + setupFeeCents,
  };
}

/** What a prepaid year saves against 12 months at the list price (never
 *  negative — an operator may price a year above 12 months, which simply means
 *  there is no saving to advertise). */
export function yearlySavingsCents(monthlyCents: number, yearlyCents: number): number {
  return Math.max(0, monthlyCents * 12 - yearlyCents);
}

/** The same saving as a whole percent, for the "Save 38%" badge. */
export function yearlySavingsPercent(monthlyCents: number, yearlyCents: number): number {
  const full = monthlyCents * 12;
  if (full <= 0) return 0;
  return Math.round((yearlySavingsCents(monthlyCents, yearlyCents) / full) * 100);
}

/** The server-authoritative total stamped onto OnboardingSubmission.amountDueCents:
 *  the same checkoutQuote, fed from the operator-edited plan config (first-month
 *  promo as the effective price, config trialPriceCents for trials). Accepts
 *  legacy plan aliases (business → pro etc.). */
export function amountDueFromConfig(
  config: PlanConfig,
  opts: {
    planKey: string;
    trial: boolean;
    extraFeatureCount: number;
    billingCycle?: OnboardingBillingCycle;
  },
): number {
  const key = planMeta(opts.planKey).key;
  const plan = config.plans.find((p) => p.key === key);
  if (!plan) return 0;
  const discounted = Boolean(plan.discountPriceCents && plan.discountPriceCents < plan.priceCents);
  return checkoutQuote(
    {
      // The first-month promo is a monthly-only offer; the yearly term price
      // stands on its own and is never discounted a second time.
      priceCents: discounted ? (plan.discountPriceCents as number) : plan.priceCents,
      yearlyPriceCents: plan.yearlyPriceCents,
      setupFeeCents: plan.setupFeeCents,
      setupFeeWaived: plan.setupFeeWaived,
    },
    {
      trial: opts.trial,
      extraFeatureCount: opts.extraFeatureCount,
      trialPriceCents: config.trialPriceCents,
      billingCycle: opts.billingCycle,
    },
  ).totalCents;
}
