import { prisma } from "@/lib/db/prisma";

const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

// Subdomain labels that are NOT tenant slugs. `www` is the marketing site (set up
// a www→apex redirect in Vercel); `admin` is the Super Admin host handled by
// middleware. Without this guard `www.<root>` would resolve to a phantom tenant
// with slug "www" and dead-end at /unknown-tenant.
const RESERVED_SUBDOMAINS = new Set(["www", "admin"]);

export type ResolvedTenant = { id: string; slug: string; status: string };

function normalizeHost(host: string) {
  return host.replace(/:\d+$/, "").toLowerCase();
}

/**
 * Resolve a hostname → tenant.
 * - `slug.<ROOT>` and `slug.localhost` → platform subdomain
 * - anything else → custom domain stored in the Domain table
 *
 * No request-level cache: Domain.hostname is unique-indexed and the row count
 * is small, so the DB lookup is fast and we'd rather pay it than risk a stale
 * negative result pinning a freshly-added domain to /unknown-tenant.
 */
export async function resolveTenantByHost(host: string): Promise<ResolvedTenant | null> {
  const h = normalizeHost(host);
  const rootHost = normalizeHost(ROOT);

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
    // tenant for every typo'd or not-yet-created slug.
    return null;
  }

  const domain = await prisma.domain.findUnique({
    where: { hostname: h },
    select: { tenant: { select: { id: true, slug: true, status: true } } },
  });
  if (domain) return domain.tenant;

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
