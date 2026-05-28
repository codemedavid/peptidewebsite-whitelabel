import { cache } from "react";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { isDemoMode, getDemoEntitlements } from "@/lib/demo/fixtures";
import type { FeatureKey } from "./catalog";

export class FeatureLockedError extends Error {
  constructor(public readonly feature: FeatureKey) {
    super(`Feature not entitled: ${feature}`);
    this.name = "FeatureLockedError";
  }
}

// Cross-request cache for the plan-feature joins. Same tag as the tenant row
// so any branding/settings/plan mutation invalidates the entitlement set too.
const loadEntitlements = (tenantId: string) =>
  unstable_cache(
    () =>
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          plan: { select: { features: { select: { feature: { select: { key: true } } } } } },
          featureOverrides: {
            select: { enabled: true, expiresAt: true, feature: { select: { key: true } } },
          },
        },
      }),
    ["tenant-entitlements", tenantId],
    { tags: [`tenant:${tenantId}`, `tenant:${tenantId}:entitlements`], revalidate: 300 },
  )();

/**
 * Resolved feature set for a tenant = plan features ∪ enabled overrides − revocations.
 * Outer `cache()` dedupes within a render; inner `unstable_cache` (5 min) dedupes
 * across requests and is tag-busted by entitlement-mutating actions.
 */
export const getEntitlements = cache(
  async (tenantId: string): Promise<Set<FeatureKey>> => {
    // Demo mode: resolve from file-backed plan + override map (no DB).
    if (isDemoMode()) return getDemoEntitlements(tenantId);

    const tenant = await loadEntitlements(tenantId);
    if (!tenant) return new Set();

    const set = new Set<FeatureKey>(
      tenant.plan.features.map((pf) => pf.feature.key as FeatureKey),
    );

    const now = Date.now();
    for (const o of tenant.featureOverrides) {
      const expired = o.expiresAt ? o.expiresAt.getTime() < now : false;
      if (expired) continue;
      const key = o.feature.key as FeatureKey;
      if (o.enabled) set.add(key);
      else set.delete(key);
    }
    return set;
  },
);

export async function hasFeature(tenantId: string, key: FeatureKey) {
  return (await getEntitlements(tenantId)).has(key);
}

/** Enforce in Server Actions / route handlers. Re-check inside workers too (downgrade safety). */
export async function requireFeature(tenantId: string, key: FeatureKey) {
  if (!(await hasFeature(tenantId, key))) throw new FeatureLockedError(key);
}

/**
 * Page/layout-level route guard. Renders Next's 404 when the tenant isn't
 * entitled to `key` — so a disabled feature's route can't be reached by URL,
 * not merely hidden in nav. Call at the top of gated Server Components.
 */
export async function requireFeaturePage(tenantId: string, key: FeatureKey) {
  if (!(await hasFeature(tenantId, key))) notFound();
}
