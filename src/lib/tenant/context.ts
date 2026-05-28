import { cache } from "react";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getEntitlements } from "@/lib/features/entitlements";
import type { FeatureKey } from "@/lib/features/catalog";
import { isDemoMode, getDemoContext } from "@/lib/demo/fixtures";

// Cross-request cache: per-tenant identity + branding + settings. Tagged so
// branding/settings mutations can revalidateTag(`tenant:<id>`) and the next
// request reads fresh data without paying for a full DB round-trip first.
const loadTenant = (tenantId: string) =>
  unstable_cache(
    () =>
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
          orderNumberFormat: true,
        },
      }),
    ["tenant-row", tenantId],
    { tags: [`tenant:${tenantId}`], revalidate: 300 },
  )();

/**
 * Everything a tenant-scoped page needs in one cached call:
 * identity, branding, settings, and resolved entitlements.
 * Outer `cache()` dedupes within a single render; inner `unstable_cache`
 * dedupes across requests (5 min TTL, tag-invalidated by mutations).
 */
export const getTenantContext = cache(async (tenantId: string) => {
  if (isDemoMode()) return getDemoContext(tenantId);

  const [tenant, entitlements] = await Promise.all([
    loadTenant(tenantId),
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
