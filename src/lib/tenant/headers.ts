import { headers } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { resolveTenantByHost } from "./resolve";
import { isDemoMode, demoSlugFromHost } from "@/lib/demo/fixtures";

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

/** Tenant id for the current request. Redirects to /unknown-tenant if unresolved. */
export async function getTenantId(): Promise<string> {
  const tenant = await resolveCurrent();
  if (!tenant || tenant.status === "suspended") redirect("/unknown-tenant");
  return tenant.id;
}

export async function getTenantIdOrNull(): Promise<string | null> {
  const tenant = await resolveCurrent();
  return tenant && tenant.status !== "suspended" ? tenant.id : null;
}

export async function getTenantSlug(): Promise<string | null> {
  const tenant = await resolveCurrent();
  return tenant?.slug ?? null;
}
