// Persisting tenant feature toggles — the one DB path behind BOTH the admin
// Features editor (setTenantFeatureAction / saveFeatures) and the MCP
// connector's set_whitelabel_features tool.
//
// It lives outside src/actions because that file is "use server": every export
// there is a callable server action, and the connector must NOT go through a
// path that demands an operator session — its caller proved an admin token
// instead. Auth is the caller's job; by the time these run it is settled.
//
// The rule that matters: an override row is a DIVERGENCE from the plan, never a
// copy of it. A toggle that lands back on the plan default DELETES the row, so
// a tenant that is later moved to another plan inherits the new package instead
// of dragging stale grants behind it.

import { prisma } from "@/lib/db/prisma";
import { PLAN_FEATURES } from "@/lib/features/catalog";

/**
 * Ensure a catalog feature has its DB rows (the Feature row + a PlanFeature
 * link for every plan whose ceiling includes it), idempotently. Mirrors
 * prisma/seed.ts so a feature added to the catalog after a DB was seeded
 * self-registers the first time it is touched, instead of failing the toggle
 * with "feature not registered" and trapping the operator.
 */
export async function ensureFeatureRegistered(key: string): Promise<{ id: string }> {
  const feature = await prisma.feature.upsert({
    where: { key },
    update: {},
    create: { key },
    select: { id: true },
  });

  const planKeys = Object.entries(PLAN_FEATURES)
    .filter(([, keys]) => (keys as readonly string[]).includes(key))
    .map(([planKey]) => planKey);
  if (!planKeys.length) return feature;

  const plans = await prisma.plan.findMany({
    where: { key: { in: planKeys } },
    select: { id: true },
  });
  if (!plans.length) return feature;

  await prisma.$transaction(
    plans.map((p) =>
      prisma.planFeature.upsert({
        where: { planId_featureId: { planId: p.id, featureId: feature.id } },
        update: {},
        create: { planId: p.id, featureId: feature.id },
      }),
    ),
  );
  return feature;
}

export type FeatureWrite = {
  key: string;
  enabled: boolean;
  /** true ⇒ back on the plan default, so the override row is removed. */
  matchesPlanDefault: boolean;
};

/**
 * Apply one batch of toggles. Sequential rather than one transaction on
 * purpose: each key may have to register itself first, and a batch of toggles
 * is well under the round-trip budget a single withTenant() transaction has
 * (see docs — ~60 queries). Callers revalidate.
 */
export async function applyFeatureWrites(tenantId: string, writes: FeatureWrite[]): Promise<void> {
  for (const write of writes) {
    const feature = await ensureFeatureRegistered(write.key);
    if (write.matchesPlanDefault) {
      await prisma.tenantFeatureOverride.deleteMany({
        where: { tenantId, featureId: feature.id },
      });
      continue;
    }
    await prisma.tenantFeatureOverride.upsert({
      where: { tenantId_featureId: { tenantId, featureId: feature.id } },
      update: { enabled: write.enabled, expiresAt: null },
      create: { tenantId, featureId: feature.id, enabled: write.enabled },
    });
  }
}
