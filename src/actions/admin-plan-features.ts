"use server";

// Super Admin action for the plan→feature CEILING — which functionalities each
// package (Starter / Business / Automated) includes. Operator-gated. Persists the
// "plan_features_config" PlatformSetting, then reconciles the DB plan_features
// join to the saved ceiling (syncPlanCatalog) so entitlements resolve to the new
// package contents for EVERY tenant on that plan. Per-tenant TenantFeatureOverride
// grants/revokes still win. Demo mode persists to .demo-data/platform-settings.json
// and the demo entitlement resolver reads the same config.

import { Prisma } from "@prisma/client";
import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { requirePlatformUser } from "@/lib/auth/session";
import { isDemoMode, saveDemoPlatformSetting } from "@/lib/demo/fixtures";
import {
  PLAN_FEATURES_CONFIG_KEY,
  normalizePlanFeatureConfig,
  resolvePlanFeatureSets,
  type PlanFeatureConfig,
} from "@/lib/platform/plan-feature-config";
import { syncPlanCatalog } from "@/lib/features/catalog-sync";
import { getFeatureRegistry, persistFeatureRegistry } from "@/lib/platform/feature-registry-server";
import { reconcileRegistry } from "@/lib/platform/feature-registry";

export type PlanFeaturesResult = { ok: true } | { error: string };

function bust() {
  revalidatePath("/admin/plans");
  revalidatePath("/admin/features");
  revalidatePath("/admin/tenants");
  revalidatePath("/admin");
}

export async function savePlanFeaturesConfigAction(
  input: PlanFeatureConfig,
  // Feature keys the operator keeps flagged "New" (after dismissing any). Records
  // the current catalog as the baseline and persists these as the storefront-facing
  // "New" tags. Omit to auto-carry all detected additions.
  newKeys?: string[],
): Promise<PlanFeaturesResult> {
  await requirePlatformUser();

  // Reject an all-off package before normalize silently keeps it — a plan with
  // zero features would leave its tenants with an empty storefront. The operator
  // should hit "reset" rather than save an empty ceiling by accident.
  const config = normalizePlanFeatureConfig(input);
  const empty = Object.entries(config.plans).find(([, keys]) => keys.length === 0);
  if (empty) {
    return { error: `The ${empty[0]} package needs at least one included feature.` };
  }

  // Record the catalog baseline + the kept "New" flags so newly-added features
  // are detected next time and store owners see the tags the operator kept.
  const registry = reconcileRegistry(await getFeatureRegistry(), newKeys);

  if (isDemoMode()) {
    saveDemoPlatformSetting(PLAN_FEATURES_CONFIG_KEY, config);
    await persistFeatureRegistry(registry);
    bust();
    return { ok: true };
  }

  try {
    await prisma.platformSetting.upsert({
      where: { key: PLAN_FEATURES_CONFIG_KEY },
      update: { value: config as unknown as Prisma.InputJsonValue },
      create: { key: PLAN_FEATURES_CONFIG_KEY, value: config as unknown as Prisma.InputJsonValue },
    });
    // Reconcile the DB plan→feature ceiling to the saved config so getEntitlements
    // (which reads plan.features live) resolves the new package contents.
    await syncPlanCatalog(prisma, resolvePlanFeatureSets(config));
    await persistFeatureRegistry(registry);

    // Changing a plan ceiling affects every tenant on that plan. Bust each
    // tenant's entitlement cache (tag set in lib/features/entitlements.ts) so the
    // storefront re-resolves nav + route guards on the next request.
    const tenants = await prisma.tenant.findMany({ select: { id: true } });
    for (const t of tenants) revalidateTag(`tenant:${t.id}:entitlements`);
  } catch {
    return { error: "Could not save — has the platform_settings table been pushed? (npm run db:push)" };
  }

  bust();
  return { ok: true };
}
