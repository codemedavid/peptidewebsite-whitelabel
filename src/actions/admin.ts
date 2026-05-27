"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { requirePlatformUser } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/demo/fixtures";
import {
  addDomainToProject,
  removeDomainFromProject,
  getDomainStatus,
  type DomainStatus,
} from "@/lib/vercel/domains";

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

   A custom domain like `shop.acme.com` must be (1) attached to the Vercel
   project so Vercel routes it here + issues TLS, and (2) marked `verified` in
   our DB so resolveTenantByHost() will accept it. We provision via the Vercel
   API and only flip `verified` once Vercel confirms DNS is configured.
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

/** Attach a new custom domain to a tenant and register it with Vercel. */
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

  const attach = await addDomainToProject(host);
  if (!attach.ok) return { error: attach.error };

  await prisma.domain.create({ data: { tenantId, hostname: host, verified: false } });
  revalidatePath(`/admin/tenants/${slug}/settings`);

  // Surface the (likely not-yet-configured) status so the UI can show DNS records.
  const status = await getDomainStatus(host);
  return {
    ok: true,
    status: status.ok ? status.data : { verified: false, misconfigured: true, verification: [] },
  };
}

/** Re-check a domain's DNS with Vercel and flip `verified` when it's good. */
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

  const status = await getDomainStatus(host);
  if (!status.ok) return { error: status.error };

  if (status.data.verified !== domain.verified) {
    await prisma.domain.update({
      where: { id: domain.id },
      data: { verified: status.data.verified },
    });
    // Bust the cached host→tenant lookup so resolve.ts sees the new state at once.
    revalidateTag(`tenant-host:${host}`);
    revalidatePath(`/admin/tenants/${slug}/settings`);
  }
  return { ok: true, status: status.data };
}

/** Remove a custom domain from a tenant and detach it from Vercel. */
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

  const detach = await removeDomainFromProject(host);
  if (!detach.ok) return { error: detach.error };

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
