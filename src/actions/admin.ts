"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { requirePlatformUser } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/demo/fixtures";

export type AdminActionResult = { ok: true; status?: string } | { error: string };

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
