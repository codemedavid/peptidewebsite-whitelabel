/**
 * Upgrade order-summary math (pure, client-safe — test:trial-upgrade).
 * Business monthly (plan_config list price — the same figure MRR/billing use,
 * promos excluded) minus the trial credit, clamped at zero. The credit applies
 * to every trial-governed tenant — active OR expired — matching the brief:
 * "your trial payment is credited when you upgrade".
 */

import { planConfigPriceCents, type PlanConfig } from "@/lib/platform/plan-config";

export type UpgradeQuote = {
  businessCents: number;
  creditCents: number;
  dueTodayCents: number;
};

export function upgradeQuote(config: PlanConfig, trialGoverned: boolean): UpgradeQuote {
  const businessCents = planConfigPriceCents(config, "pro");
  const creditCents = trialGoverned ? config.trialPriceCents : 0;
  return {
    businessCents,
    creditCents,
    dueTodayCents: Math.max(0, businessCents - creditCents),
  };
}
