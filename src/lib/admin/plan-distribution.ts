// Pure aggregation for the Super Admin "Plans & Billing" page (/admin/plans).
// No fs/prisma/Next imports — testable in isolation (scripts/test-plan-distribution.ts).
//
// The platform sells a ONE-TIME website build per plan, not a subscription, so
// this intentionally has NO recurring/annualized concept: `revenueCents` is the
// one-time sum of what active sites paid for their plan — never an MRR×12 ARR.

import { planMeta } from "@/lib/admin/plans";
import { planConfigPriceCents, type PlanConfig } from "@/lib/platform/plan-config";

/** One canonical plan row: how many sites are on it and what they paid (one-time). */
export type PlanRow = {
  key: string;
  label: string;
  priceCents: number;
  count: number;
  revenueCents: number; // one-time revenue from ACTIVE sites on this plan
};

export type PlanDistribution = {
  rows: PlanRow[];
  revenueCents: number; // one-time total across active sites (no recurring/ARR)
  activeCount: number;
};

const CANONICAL_KEYS = ["starter", "pro", "enterprise"] as const;

/** Plan distribution + one-time revenue collected. Pure: caller supplies the data. */
export function aggregatePlanDistribution(
  tenants: ReadonlyArray<{ planKey: string; status: string }>,
  planConfig: PlanConfig,
): PlanDistribution {
  const byKey = new Map<string, { count: number; revenueCents: number }>();
  for (const t of tenants) {
    const pm = planMeta(t.planKey); // folds legacy/unknown keys onto a canonical key
    const cur = byKey.get(pm.key) ?? { count: 0, revenueCents: 0 };
    cur.count += 1;
    if (t.status === "active") cur.revenueCents += planConfigPriceCents(planConfig, pm.key);
    byKey.set(pm.key, cur);
  }

  const rows: PlanRow[] = CANONICAL_KEYS.map((key) => {
    const pm = planMeta(key);
    const agg = byKey.get(key) ?? { count: 0, revenueCents: 0 };
    return {
      key,
      label: pm.label,
      priceCents: planConfigPriceCents(planConfig, key),
      count: agg.count,
      revenueCents: agg.revenueCents,
    };
  });

  const revenueCents = rows.reduce((s, r) => s + r.revenueCents, 0);
  const activeCount = tenants.filter((t) => t.status === "active").length;
  return { rows, revenueCents, activeCount };
}
