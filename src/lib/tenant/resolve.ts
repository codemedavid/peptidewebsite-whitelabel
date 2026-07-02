import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/prisma";

const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

// Subdomain labels that are NOT tenant slugs. `www` is the apex marketing site
// (www→apex 301 in middleware); `admin` and `app` are the Super Admin hosts
// (handled by middleware). Without this guard `app.<root>` would resolve to a
// phantom tenant with slug "app" and dead-end at /unknown-tenant — and a sign-up
// could never claim these labels (the provisioner blocklists them too).
const RESERVED_SUBDOMAINS = new Set(["www", "admin", "app"]);

export type ResolvedTenant = { id: string; slug: string; status: string };

/**
 * Absolute public origin for a tenant's storefront on the platform subdomain —
 * where transactional-email CTAs point (e.g. https://<slug>.<root>/#track).
 * Undefined when the slug is unknown. Tenants on a custom domain still reach
 * the same storefront via their subdomain, so this is always a safe link.
 */
export function storefrontOrigin(slug: string | null | undefined): string | undefined {
  const s = (slug ?? "").trim().toLowerCase();
  return s ? `https://${s}.${normalizeHost(ROOT)}` : undefined;
}

function normalizeHost(host: string) {
  return host.replace(/:\d+$/, "").toLowerCase();
}

// Inner uncached lookup. Cached below by host with a per-host tag so actions
// can revalidateTag(`tenant-host:<host>`) on domain/branding changes.
async function lookupTenantByHost(host: string): Promise<ResolvedTenant | null> {
  const h = normalizeHost(host);
  const rootHost = normalizeHost(ROOT);

  const isPlatformSubdomain =
    h.endsWith(`.${rootHost}`) || h.endsWith(".localhost");

  if (isPlatformSubdomain) {
    const slug = h.split(".")[0];
    if (RESERVED_SUBDOMAINS.has(slug)) return null;
    const t = await prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true, status: true },
    });
    if (t) return t;
    return null;
  }

  const domain = await prisma.domain.findUnique({
    where: { hostname: h },
    select: { tenant: { select: { id: true, slug: true, status: true } } },
  });
  if (domain) return domain.tenant;

  if (process.env.NODE_ENV !== "production") {
    const slug = process.env.DEV_TENANT_SLUG ?? "acme";
    return prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true, status: true },
    });
  }
  return null;
}

/**
 * Resolve a hostname → tenant.
 * - `slug.<ROOT>` and `slug.localhost` → platform subdomain
 * - anything else → custom domain stored in the Domain table
 *
 * Cached across requests with a 5 min TTL and a per-host tag. Actions that
 * mutate domain/tenant state (see actions/admin.ts, actions/onboarding.ts)
 * already call `revalidateTag(`tenant-host:<host>`)` to bust the entry.
 */
export async function resolveTenantByHost(host: string): Promise<ResolvedTenant | null> {
  const h = normalizeHost(host);
  return unstable_cache(
    () => lookupTenantByHost(h),
    ["tenant-host", h],
    { tags: [`tenant-host:${h}`], revalidate: 300 },
  )();
}
