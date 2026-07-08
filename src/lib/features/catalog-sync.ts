// Reconcile the DB feature catalog (features + plans + plan_features) to the
// source-of-truth in ./catalog. This is what makes "create a tenant on a plan →
// it gets exactly that plan's features" reliable: getEntitlements() reads
// plan_features live, so those rows MUST match PLAN_FEATURES.
//
// Unlike the old additive seed, this removes stale plan_features too, so editing
// a plan's ceiling in catalog.ts and re-running keeps the DB honest (no drift).
// Features themselves are only upserted, never deleted — overrides and history
// reference them.
//
// Shared by: prisma/seed.ts, scripts/sync-plan-features.ts (npm run
// db:sync-features), and the "Sync plan features" action on /admin/plans.

import type { PrismaClient } from "@prisma/client";
import { ALL_FEATURES, PLAN_FEATURES } from "./catalog";

const PLAN_NAMES: Record<string, string> = {
  starter: "Starter",
  pro: "Pro",
  enterprise: "Enterprise",
};

export interface PlanSyncDiff {
  key: string;
  added: string[];
  removed: string[];
}

export interface SyncSummary {
  featuresUpserted: number;
  plans: PlanSyncDiff[];
}

/**
 * Idempotent: same catalog + same DB → empty diffs. Returns what changed so the
 * caller (script / server action) can log it — silent reconciliation hides drift.
 *
 * `planFeatureSets` is the plan→feature ceiling to reconcile the DB to; it
 * defaults to the hardcoded catalog PLAN_FEATURES. The Super Admin passes the
 * operator-edited, resolved sets (plan-feature-config) so a saved package edit
 * reconciles straight into plan_features instead of being reset to catalog.
 */
export async function syncPlanCatalog(
  prisma: PrismaClient,
  planFeatureSets: Record<string, readonly string[]> = PLAN_FEATURES,
): Promise<SyncSummary> {
  // 1. Features — upsert every catalog key (never delete).
  for (const key of ALL_FEATURES) {
    await prisma.feature.upsert({ where: { key }, update: {}, create: { key } });
  }
  const features = await prisma.feature.findMany({ select: { id: true, key: true } });
  const idByKey = new Map(features.map((f) => [f.key, f.id]));
  const keyById = new Map(features.map((f) => [f.id, f.key]));

  const summary: SyncSummary = { featuresUpserted: ALL_FEATURES.length, plans: [] };

  // 2. Plans + plan_features — reconcile to the given ceiling (add missing, remove stale).
  for (const [planKey, featureKeys] of Object.entries(planFeatureSets)) {
    const plan = await prisma.plan.upsert({
      where: { key: planKey },
      update: { name: PLAN_NAMES[planKey] ?? planKey },
      create: { key: planKey, name: PLAN_NAMES[planKey] ?? planKey },
    });

    const desired = new Set(
      featureKeys.map((k) => idByKey.get(k)).filter((id): id is string => Boolean(id)),
    );
    const existing = await prisma.planFeature.findMany({
      where: { planId: plan.id },
      select: { featureId: true },
    });
    const existingIds = new Set(existing.map((e) => e.featureId));

    const toAdd = [...desired].filter((id) => !existingIds.has(id));
    const toRemove = [...existingIds].filter((id) => !desired.has(id));

    if (toAdd.length > 0) {
      await prisma.planFeature.createMany({
        data: toAdd.map((featureId) => ({ planId: plan.id, featureId })),
        skipDuplicates: true,
      });
    }
    if (toRemove.length > 0) {
      await prisma.planFeature.deleteMany({
        where: { planId: plan.id, featureId: { in: toRemove } },
      });
    }

    summary.plans.push({
      key: planKey,
      added: toAdd.map((id) => keyById.get(id) ?? id).sort(),
      removed: toRemove.map((id) => keyById.get(id) ?? id).sort(),
    });
  }

  return summary;
}
