import { headers } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { resolveTenantByHost } from "./resolve";
import { storefrontBouncePath } from "./gate";
import { isDemoMode, demoSlugFromHost } from "@/lib/demo/fixtures";
import { currentAppActorScope } from "@/lib/auth/app-actor-scope";
import { currentAppShopperScope } from "@/lib/auth/app-shopper-scope";

/**
 * Server-side tenant resolution. Middleware tags the request with x-tenant-host;
 * here (Node runtime) we map host → tenant via the cached Prisma lookup.
 * `cache()` dedupes within a single request render.
 */
const resolveCurrent = cache(async () => {
  const host = (await headers()).get("x-tenant-host");
  if (isDemoMode()) {
    // White-label demo: pick the tenant from the subdomain (apex.localhost → apex).
    const slug = demoSlugFromHost(host);
    return { id: slug, slug, status: "active" };
  }
  if (!host) return null;
  return resolveTenantByHost(host);
});

/**
 * Tenant id for the current request. Bounces unresolved hosts to
 * /unknown-tenant and deactivated (suspended) tenants to /site-unavailable —
 * the split lives in lib/tenant/gate.ts.
 */
export async function getTenantId(): Promise<string> {
  // Pepweb app bridge: the tenant was resolved from an authenticated app session
  // (lib/auth/app-actor-scope.ts), which already applied the store gate. The
  // app shop does the same for shoppers (lib/auth/app-shopper-scope.ts).
  const scope = currentAppActorScope() ?? currentAppShopperScope();
  if (scope) return scope.tenantId;
  const tenant = await resolveCurrent();
  const bounce = storefrontBouncePath(tenant);
  if (bounce) redirect(bounce);
  // A null tenant always yields a bounce (gate.ts), so past the redirect the
  // tenant is present — the gate module stays the single owner of that rule.
  return tenant!.id;
}

export async function getTenantIdOrNull(): Promise<string | null> {
  const scope = currentAppActorScope() ?? currentAppShopperScope();
  if (scope) return scope.tenantId;
  const tenant = await resolveCurrent();
  return tenant && !storefrontBouncePath(tenant) ? tenant.id : null;
}

export async function getTenantSlug(): Promise<string | null> {
  const scope = currentAppActorScope() ?? currentAppShopperScope();
  if (scope) return scope.slug;
  const tenant = await resolveCurrent();
  return tenant?.slug ?? null;
}
