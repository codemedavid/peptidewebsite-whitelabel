import "server-only";

import { prisma } from "@/lib/db/prisma";
import { normalizeHost } from "@/lib/tenant/cache-tags";

export const MOBILE_ROOT = normalizeHost(process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000");

export type StoreRow = { id: string; slug: string; status: string };

/**
 * Exact host → tenant, with NO development fallback (resolveTenantByHost maps
 * any unknown host to DEV_TENANT_SLUG outside production, which would let a
 * typo sign into — or link the app to — the wrong store).
 */
export async function findStoreByHost(host: string): Promise<StoreRow | null> {
  const select = { id: true, slug: true, status: true } as const;
  if (host.endsWith(`.${MOBILE_ROOT}`)) {
    return prisma.tenant.findUnique({ where: { slug: host.slice(0, -(MOBILE_ROOT.length + 1)) }, select });
  }
  const domain = await prisma.domain.findUnique({ where: { hostname: host }, select: { tenant: { select } } });
  return domain?.tenant ?? null;
}
