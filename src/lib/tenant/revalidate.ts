import { revalidateTag } from "next/cache";
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
