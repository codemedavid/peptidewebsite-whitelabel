// Operator-editable plan pricing + feature lists. Edited in the Super Admin
// (/admin/plans) and persisted as the "plan_config" PlatformSetting row (or
// .demo-data/platform-settings.json in demo mode). The hardcoded PLAN_CARDS in
// lib/admin/plans.ts are the fallback/default; plan keys and display names stay
// fixed (they're identity — planMeta labels, feature-catalog ranks, DB Plan rows).
//
// Client-safe: no fs/prisma imports — types and pure helpers only.

import { PLAN_CARDS, planMeta } from "@/lib/admin/plans";

export const PLAN_CONFIG_KEY = "plan_config";

export type EditablePlanCard = {
  key: string; // canonical plan key (starter | pro | enterprise) — fixed
  name: string; // display label — fixed, mirrors planMeta
  priceCents: number; // monthly (list) price in PHP centavos
  discountPriceCents?: number; // optional first-month promo price (< priceCents); display only — MRR/billing use priceCents
  setupFeeCents: number; // one-time setup fee in PHP centavos (0 = no fee)
  setupFeeWaived: boolean; // show the fee struck through as "FREE setup"
  blurb: string; // short pitch under the price
  tag: string; // card badge, e.g. "Popular" ("" = none)
  feats: string[]; // feature bullets shown on the card
};

export type PlanConfig = {
  plans: EditablePlanCard[];
  /** The one-month Business trial's price (PHP centavos) — the credit applied
   *  on upgrade (trial system). Operator-editable; defaults to ₱699. */
  trialPriceCents: number;
};

/** The ₱699 1-month Business trial (matches OnboardingSubmission.trial). */
export const DEFAULT_TRIAL_PRICE_CENTS = 69_900;

/** The hardcoded PLAN_CARDS, lifted into the editable shape. */
export function defaultPlanConfig(): PlanConfig {
  return {
    trialPriceCents: DEFAULT_TRIAL_PRICE_CENTS,
    plans: PLAN_CARDS.map((p) => {
      const card = p as (typeof PLAN_CARDS)[number] & { discountPriceCents?: number; tag?: string };
      return {
        key: p.key,
        name: p.name,
        priceCents: p.priceCents,
        ...(card.discountPriceCents ? { discountPriceCents: card.discountPriceCents } : {}),
        setupFeeCents: p.setupFeeCents,
        setupFeeWaived: p.setupFeeWaived,
        blurb: p.blurb,
        tag: card.tag ?? "",
        feats: [...p.feats],
      };
    }),
  };
}

const MAX_FEATS = 12;
const MAX_PRICE_CENTS = 100_000_000; // ₱1M/mo guardrail

/** Sanitize an untrusted/stored value into a well-formed config (never throws).
 *  Always returns exactly the canonical plans, in order, falling back per-field. */
export function normalizePlanConfig(input: unknown): PlanConfig {
  const o = (input ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(o.plans) ? (o.plans as unknown[]) : [];
  const trialCents = Math.round(Number(o.trialPriceCents));
  return {
    trialPriceCents:
      Number.isFinite(trialCents) && trialCents > 0
        ? Math.min(trialCents, MAX_PRICE_CENTS)
        : DEFAULT_TRIAL_PRICE_CENTS,
    plans: defaultPlanConfig().plans.map((d) => {
      const r = (raw.find((x) => (x as Record<string, unknown> | null)?.key === d.key) ??
        {}) as Record<string, unknown>;
      const cents = Math.round(Number(r.priceCents));
      const priceCents = Number.isFinite(cents) && cents > 0 ? Math.min(cents, MAX_PRICE_CENTS) : d.priceCents;
      // Promo price is optional and only valid when it's a positive amount strictly
      // below the list price; anything else means "no discount" and is dropped.
      const discount = Math.round(Number(r.discountPriceCents));
      const discountPriceCents =
        Number.isFinite(discount) && discount > 0 && discount < priceCents ? discount : undefined;
      // Setup fee: 0 is a valid "no fee"; anything malformed falls back per-plan.
      const setup = Math.round(Number(r.setupFeeCents));
      const setupFeeCents =
        Number.isFinite(setup) && setup >= 0 ? Math.min(setup, MAX_PRICE_CENTS) : d.setupFeeCents;
      const rawFeats = Array.isArray(r.feats) ? (r.feats as unknown[]) : null;
      return {
        key: d.key,
        name: d.name,
        priceCents,
        ...(discountPriceCents ? { discountPriceCents } : {}),
        setupFeeCents,
        setupFeeWaived: typeof r.setupFeeWaived === "boolean" ? r.setupFeeWaived : d.setupFeeWaived,
        blurb: typeof r.blurb === "string" ? r.blurb.slice(0, 300) : d.blurb,
        tag: typeof r.tag === "string" ? r.tag.slice(0, 40) : d.tag,
        feats: rawFeats
          ? rawFeats.map((f) => String(f ?? "").trim().slice(0, 160)).filter(Boolean).slice(0, MAX_FEATS)
          : [...d.feats],
      };
    }),
  };
}

/** Effective monthly price for any plan key (incl. legacy aliases). */
export function planConfigPriceCents(config: PlanConfig, key: string): number {
  const pm = planMeta(key);
  return config.plans.find((p) => p.key === pm.key)?.priceCents ?? pm.priceCents;
}
