import { cache } from "react";
import { prisma } from "@/lib/db/prisma";
import { getEntitlements } from "@/lib/features/entitlements";
import type { FeatureKey } from "@/lib/features/catalog";
import { isDemoMode, getDemoContext } from "@/lib/demo/fixtures";

/**
 * Everything a tenant-scoped page needs in one cached call:
 * identity, branding, settings, and resolved entitlements.
 * `cache()` dedupes across a single render pass.
 */
export const getTenantContext = cache(async (tenantId: string) => {
  if (isDemoMode()) return getDemoContext(tenantId);

  const [tenant, entitlements] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        plan: { select: { key: true, name: true } },
        branding: true,
        settings: true,
      },
    }),
    getEntitlements(tenantId),
  ]);

  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

  return {
    tenant,
    branding: tenant.branding,
    settings: tenant.settings,
    features: entitlements,
    has: (key: FeatureKey) => entitlements.has(key),
  };
});

export type TenantContext = Awaited<ReturnType<typeof getTenantContext>>;
