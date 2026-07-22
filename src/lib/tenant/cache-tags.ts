/**
 * Pure core for tenant cache invalidation. Every unstable_cache tag that must
 * be busted so a tenant-visibility or settings change is observable on the
 * very next storefront request (the host resolver in lib/tenant/resolve.ts
 * otherwise serves its cached entry for up to 5 minutes):
 *
 *   - `tenant:<id>`            — tenant-scoped data (branding, entitlements…)
 *   - `tenant-host:<slug>.<root>` — the platform-subdomain resolver entry
 *   - `tenant-host:<hostname>` — one per custom domain pointed at the tenant
 *
 * Kept free of next/cache so it can be unit-tested (scripts/test-tenant-suspend.ts).
 */
/**
 * Canonical host normalization — shared by the resolver's cache key
 * (lib/tenant/resolve.ts) and the bust tags below so the two can never drift.
 */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, "");
}

export function tenantCacheTags(
  tenantId: string,
  slug?: string | null,
  customHosts: readonly string[] = [],
  root: string = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000",
): string[] {
  const rootHost = normalizeHost(root);
  const tags = new Set<string>([`tenant:${tenantId}`]);
  if (slug) tags.add(`tenant-host:${slug.trim().toLowerCase()}.${rootHost}`);
  for (const raw of customHosts) {
    const host = normalizeHost(raw);
    if (host) tags.add(`tenant-host:${host}`);
  }
  return [...tags];
}
