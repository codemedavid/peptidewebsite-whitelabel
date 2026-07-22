/**
 * Pure core for the storefront visibility gate: given the resolved tenant for
 * the request host (or null when the host maps to nothing), decide where the
 * request bounces — or null to serve the storefront.
 *
 *   - unresolved host  → /unknown-tenant   ("Site not found")
 *   - suspended        → /site-unavailable ("Website currently not available" —
 *                        the operator kill-switch; the store exists but is off)
 *   - pending_setup    → /unknown-tenant   (self-provisioned store the operator
 *                        hasn't published yet — kept dark, not advertised)
 *   - anything else    → null              (active | trial storefronts serve)
 *
 * Kept free of next/* so it can be unit-tested (scripts/test-tenant-unavailable.ts).
 */
export function storefrontBouncePath(tenant: { status: string } | null): string | null {
  if (!tenant) return "/unknown-tenant";
  if (tenant.status === "suspended") return "/site-unavailable";
  if (tenant.status === "pending_setup") return "/unknown-tenant";
  return null;
}
