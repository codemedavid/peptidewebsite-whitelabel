import { revalidateTag } from "next/cache";

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000").replace(
  /:\d+$/,
  "",
);

/**
 * Bust all tenant-scoped caches for a single tenant in one call.
 * Use after mutating branding / settings / domains / entitlements so the next
 * storefront request reads fresh data without paying for a full layout
 * re-render (which `revalidatePath("/", "layout")` would force across every
 * tenant). Pass the tenant id; pass slug too when known so the platform-host
 * resolver entry is busted as well.
 */
export function revalidateTenant(tenantId: string, slug?: string | null) {
  revalidateTag(`tenant:${tenantId}`);
  if (slug) revalidateTag(`tenant-host:${slug}.${ROOT}`);
}
