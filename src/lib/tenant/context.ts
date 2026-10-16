import { cache } from "react";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getEntitlements } from "@/lib/features/entitlements";
import type { FeatureKey } from "@/lib/features/catalog";
import { isDemoMode, getDemoContext } from "@/lib/demo/fixtures";
import { stripInlineMedia } from "@/lib/storefront/inline-media";

// Cross-request cache: per-tenant identity + branding + settings. Tagged so
// branding/settings mutations can revalidateTag(`tenant:<id>`) and the next
// request reads fresh data without paying for a full DB round-trip first.
//
// One hour, not five minutes: the branding row is 20–84kB of JSON and was a
// top source of Supabase egress. Every writer of these columns (branding,
// settings, name/slug/status/plan, orderNumberFormat) busts `tenant:<id>`, so
// the TTL only bounds out-of-band edits (direct-Prisma scripts, SQL console).
const TENANT_ROW_REVALIDATE_SECONDS = 3600;

const loadTenant = (tenantId: string) =>
  unstable_cache(
    async () => {
      const row = await prisma.tenant.findUnique({
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
      });
      if (!row?.branding) return row;
      // Disarm inline media HERE — the one choke point every storefront surface
      // loads branding through, so no tenant can ship raw image bytes to a
      // browser regardless of which of the ~20 branding writers put them there.
      // Inside the cached loader on purpose: the walk is paid once per TTL
      // rather than per render, and the Next data-cache entry itself stays small
      // instead of holding the very bytes we are refusing to serve.
      const config = stripInlineMedia(row.branding.config);
      const logoUrl = stripInlineMedia(row.branding.logoUrl);
      if (config.stripped.length === 0 && logoUrl.stripped.length === 0) return row;
      return {
        ...row,
        branding: { ...row.branding, config: config.value, logoUrl: logoUrl.value },
      };
    },
    ["tenant-row", tenantId],
    { tags: [`tenant:${tenantId}`], revalidate: TENANT_ROW_REVALIDATE_SECONDS },
  )();

/**
 * Everything a tenant-scoped page needs in one cached call:
 * identity, branding, settings, and resolved entitlements.
 * Outer `cache()` dedupes within a single render; inner `unstable_cache`
 * dedupes across requests (1h TTL, tag-invalidated by mutations).
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
