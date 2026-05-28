"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { requirePlatformUser } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/demo/fixtures";
import { checkDnsStatus, type DomainStatus } from "@/lib/domains/verify";

export type AdminActionResult = { ok: true; status?: string } | { error: string };

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000").replace(/:\d+$/, "");

/**
 * Suspend / reactivate a tenant. A suspended tenant's storefront is bounced to
 * /unknown-tenant by getTenantId(), so this is a real kill-switch.
 */
export async function suspendTenantAction(slug: string): Promise<AdminActionResult> {
  await requirePlatformUser();
  if (isDemoMode()) {
    // Built-in demo tenants are immutable fixtures; report success without persisting.
    return { ok: true, status: "active" };
  }
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true, status: true } });
  if (!tenant) return { error: "Tenant not found." };
  const next = tenant.status === "suspended" ? "active" : "suspended";
  await prisma.tenant.update({ where: { id: tenant.id }, data: { status: next } });
  revalidatePath("/admin");
  revalidatePath("/admin/tenants");
  revalidatePath(`/admin/tenants/${slug}`);
  return { ok: true, status: next };
}

/** Permanently delete a tenant and all its data (cascades via FK). */
export async function deleteTenantAction(slug: string): Promise<AdminActionResult> {
  await requirePlatformUser();
  if (isDemoMode()) return { error: "Deleting built-in demo tenants isn't supported." };
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!tenant) return { error: "Tenant not found." };
  await prisma.tenant.delete({ where: { id: tenant.id } });
  revalidatePath("/admin");
  revalidatePath("/admin/tenants");
  return { ok: true };
}

/* ============================================================
   Custom domains (per-tenant)

   A custom domain like `shop.acme.com` is tracked in our DB and marked
   `verified` once its DNS points at the platform. We verify by resolving the
   hostname's DNS records directly (no external API). The domain still needs
   to be attached to the hosting project (Vercel dashboard / wildcard) for
   TLS + routing — DNS verification confirms the customer's side is correct.
   ============================================================ */

export type DomainOpResult = { ok: true; status: DomainStatus } | { error: string };

/** Normalize user input to a bare hostname, or return an error string. */
function normalizeHostname(raw: string): { host: string } | { error: string } {
  let h = raw.trim().toLowerCase();
  h = h.replace(/^https?:\/\//, ""); // strip scheme
  h = h.replace(/\/.*$/, ""); // strip path
  h = h.replace(/:\d+$/, ""); // strip port
  h = h.replace(/\.$/, ""); // strip trailing dot
  if (!h) return { error: "Enter a domain." };
  // RFC-ish hostname check: labels of letters/digits/hyphens, a dotted TLD.
  if (!/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(h)) {
    return { error: "That doesn't look like a valid domain (e.g. shop.acme.com)." };
  }
  // Platform subdomains (slug.<root>) are handled automatically — they don't go
  // through the custom-domain table, so reject them here to avoid confusion.
  if (h === ROOT || h.endsWith(`.${ROOT}`)) {
    return { error: `${ROOT} subdomains are automatic — only add domains you own elsewhere.` };
  }
  return { host: h };
}

async function tenantIdForSlug(slug: string): Promise<string | null> {
  const t = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  return t?.id ?? null;
}

/** Attach a new custom domain to a tenant. */
export async function addTenantDomainAction(slug: string, rawHost: string): Promise<DomainOpResult> {
  await requirePlatformUser();
  if (isDemoMode()) return { error: "Custom domains aren't available for demo tenants." };

  const norm = normalizeHostname(rawHost);
  if ("error" in norm) return norm;
  const { host } = norm;

  const tenantId = await tenantIdForSlug(slug);
  if (!tenantId) return { error: "Tenant not found." };

  const existing = await prisma.domain.findUnique({
    where: { hostname: host },
    select: { tenantId: true },
  });
  if (existing) {
    return existing.tenantId === tenantId
      ? { error: "That domain is already added to this tenant." }
      : { error: "That domain is already in use by another tenant." };
  }

  // Probe DNS once on add so the UI knows whether the customer already configured it.
  const status = await checkDnsStatus(host);

  await prisma.domain.create({
    data: { tenantId, hostname: host, verified: status.verified },
  });
  if (status.verified) revalidateTag(`tenant-host:${host}`);
  revalidatePath(`/admin/tenants/${slug}/settings`);

  return { ok: true, status };
}

/** Re-check a domain's DNS and flip `verified` when it points at the platform. */
export async function verifyTenantDomainAction(slug: string, rawHost: string): Promise<DomainOpResult> {
  await requirePlatformUser();
  if (isDemoMode()) return { error: "Custom domains aren't available for demo tenants." };

  const norm = normalizeHostname(rawHost);
  if ("error" in norm) return norm;
  const { host } = norm;

  const domain = await prisma.domain.findUnique({
    where: { hostname: host },
    select: { id: true, verified: true, tenant: { select: { slug: true } } },
  });
  if (!domain || domain.tenant.slug !== slug) return { error: "Domain not found for this tenant." };

  const status = await checkDnsStatus(host);

  if (status.verified !== domain.verified) {
    await prisma.domain.update({
      where: { id: domain.id },
      data: { verified: status.verified },
    });
    // Bust the cached host→tenant lookup so resolve.ts sees the new state at once.
    revalidateTag(`tenant-host:${host}`);
    revalidatePath(`/admin/tenants/${slug}/settings`);
  }
  return { ok: true, status };
}

/** Remove a custom domain from a tenant. */
export async function removeTenantDomainAction(slug: string, rawHost: string): Promise<AdminActionResult> {
  await requirePlatformUser();
  if (isDemoMode()) return { error: "Custom domains aren't available for demo tenants." };

  const norm = normalizeHostname(rawHost);
  if ("error" in norm) return norm;
  const { host } = norm;

  const domain = await prisma.domain.findUnique({
    where: { hostname: host },
    select: { id: true, tenant: { select: { slug: true } } },
  });
  if (!domain || domain.tenant.slug !== slug) return { error: "Domain not found for this tenant." };

  await prisma.domain.delete({ where: { id: domain.id } });
  revalidateTag(`tenant-host:${host}`);
  revalidatePath(`/admin/tenants/${slug}/settings`);
  return { ok: true };
}

/** Mark one verified domain as the tenant's primary (canonical) hostname. */
export async function setPrimaryTenantDomainAction(slug: string, rawHost: string): Promise<AdminActionResult> {
  await requirePlatformUser();
  if (isDemoMode()) return { error: "Custom domains aren't available for demo tenants." };

  const norm = normalizeHostname(rawHost);
  if ("error" in norm) return norm;
  const { host } = norm;

  const tenantId = await tenantIdForSlug(slug);
  if (!tenantId) return { error: "Tenant not found." };

  const domain = await prisma.domain.findUnique({
    where: { hostname: host },
    select: { id: true, verified: true, tenantId: true },
  });
  if (!domain || domain.tenantId !== tenantId) return { error: "Domain not found for this tenant." };
  if (!domain.verified) return { error: "Verify the domain before making it primary." };

  // Exactly one primary per tenant.
  await prisma.$transaction([
    prisma.domain.updateMany({ where: { tenantId }, data: { isPrimary: false } }),
    prisma.domain.update({ where: { id: domain.id }, data: { isPrimary: true } }),
  ]);
  revalidatePath(`/admin/tenants/${slug}/settings`);
  return { ok: true };
}
