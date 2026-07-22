import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { tenantCacheTags } from "./cache-tags";

/**
 * Bust all tenant-scoped caches for a single tenant in one call.
 * Use after mutating branding / settings / domains / entitlements so the next
 * storefront request reads fresh data without paying for a full layout
 * re-render (which `revalidatePath("/", "layout")` would force across every
 * tenant). Pass the tenant id; pass slug too when known so the platform-host
 * resolver entry is busted as well, and pass the tenant's custom-domain
 * hostnames when the change affects public visibility (e.g. a suspend) so
 * custom-domain storefronts flip at the same moment as the subdomain.
 */
export function revalidateTenant(
  tenantId: string,
  slug?: string | null,
  customHosts: readonly string[] = [],
) {
  for (const tag of tenantCacheTags(tenantId, slug, customHosts)) revalidateTag(tag);
}

/**
 * Visibility flips (suspend, publish/unpublish, status changes) must bust every
 * host the tenant is reachable on — platform subdomain AND custom domains.
 * This wrapper fetches the slug + domain hostnames itself so no caller can
 * forget them. (Deletion is the one flip that can't use it: the rows are gone
 * afterwards, so deleteTenantAction captures the hostnames first and calls
 * revalidateTenant directly.)
 */
export async function revalidateTenantVisibility(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { slug: true, domains: { select: { hostname: true } } },
  });
  revalidateTenant(tenantId, tenant?.slug, tenant?.domains.map((d) => d.hostname) ?? []);
}
