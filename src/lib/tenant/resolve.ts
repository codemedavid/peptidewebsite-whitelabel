import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/prisma";

const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

// Subdomain labels that are NOT tenant slugs. `www` is the marketing site (set up
// a www→apex redirect in Vercel); `admin` is the Super Admin host handled by
// middleware. Without this guard `www.<root>` would resolve to a phantom tenant
// with slug "www" and dead-end at /unknown-tenant.
const RESERVED_SUBDOMAINS = new Set(["www", "admin"]);

export type ResolvedTenant = { id: string; slug: string; status: string };

function stripPort(host: string) {
  return host.replace(/:\d+$/, "");
}

/**
 * Resolve a hostname → tenant.
 * - `slug.<ROOT>` and `slug.localhost` → platform subdomain
 * - anything else → verified custom domain
 *
 * NOTE: this hits the DB on a cache miss. In production, mirror the
 * host→tenant map into Vercel Edge Config / Upstash KV (populate on
 * domain verify) so middleware resolution is sub-ms. See docs §2.2.
 */
async function lookup(host: string): Promise<ResolvedTenant | null> {
  const h = stripPort(host);
  const rootHost = stripPort(ROOT);

  const isPlatformSubdomain =
    h.endsWith(`.${rootHost}`) || h.endsWith(".localhost");

  if (isPlatformSubdomain) {
    const slug = h.split(".")[0];
    // `www`/`admin` aren't tenants — don't dead-end them at /unknown-tenant.
    if (RESERVED_SUBDOMAINS.has(slug)) return null;
    const t = await prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true, status: true },
    });
    if (t) return t;
    // An explicit subdomain was requested but matches no tenant. Do NOT fall
    // back to the dev default below — that would silently show the default
    // tenant for every typo'd or not-yet-created slug, making subdomains look
    // like they're ignored. Surface it as unknown instead.
    return null;
  } else {
    const domain = await prisma.domain.findUnique({
      where: { hostname: h },
      select: { verified: true, tenant: { select: { id: true, slug: true, status: true } } },
    });
    if (domain?.verified) return domain.tenant;
  }

  // DEV convenience: a BARE apex host with no subdomain label (plain `localhost`,
  // the root domain itself, or an IP) falls back to a default tenant so you can
  // work without a subdomain or an /etc/hosts entry. NEVER in production.
  if (process.env.NODE_ENV !== "production") {
    const slug = process.env.DEV_TENANT_SLUG ?? "acme";
    return prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true, status: true },
    });
  }
  return null;
}

export function resolveTenantByHost(host: string) {
  return unstable_cache(() => lookup(host), ["tenant-by-host", host], {
    revalidate: 300, // 5 min
    tags: [`tenant-host:${stripPort(host)}`],
  })();
}
