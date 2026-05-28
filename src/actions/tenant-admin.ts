"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getTenantIdOrNull } from "@/lib/tenant/headers";
import { requirePlatformUser } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/demo/fixtures";
import {
  clearTenantAdminCookie,
  hashAdminPassword,
  setTenantAdminCookie,
  verifyAdminPassword,
} from "@/lib/auth/tenant-admin";

export type TenantAdminSignInState = { error?: string };

const signInSchema = z.object({
  password: z.string().min(1, "Enter the admin password."),
});

/** Demo-mode password: tenants don't have a real DB, so accept a single shared one. */
function demoAdminPassword(): string {
  return process.env.TENANT_ADMIN_DEMO_PASSWORD ?? "demo";
}

/**
 * Password-only tenant admin sign-in. Resolves the tenant from the host header
 * (e.g. acme.example.com → tenant "acme"), verifies the typed password against
 * the per-tenant hash, then sets a signed cookie and lands on /dashboard.
 */
export async function signInTenantAdminAction(
  _prev: TenantAdminSignInState,
  formData: FormData,
): Promise<TenantAdminSignInState> {
  const parsed = signInSchema.safeParse({
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return { error: "This site isn't connected to a tenant." };

  if (isDemoMode()) {
    if (parsed.data.password !== demoAdminPassword()) {
      return { error: "Wrong password." };
    }
    await setTenantAdminCookie(tenantId);
    redirect("/dashboard");
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { adminPasswordHash: true },
  });
  if (!tenant?.adminPasswordHash) {
    return { error: "Admin password isn't set yet. Contact the platform administrator." };
  }
  if (!verifyAdminPassword(parsed.data.password, tenant.adminPasswordHash)) {
    return { error: "Wrong password." };
  }

  await setTenantAdminCookie(tenantId);
  redirect("/dashboard");
}

/** Clear the cookie and bounce back to /admin. */
export async function signOutTenantAdminAction(): Promise<void> {
  await clearTenantAdminCookie();
  redirect("/admin");
}

/* ───────────────── Super Admin: set/clear a tenant's password ───────────────── */

export type SetTenantAdminPasswordResult = { ok: true } | { error: string };

const setPasswordSchema = z.object({
  slug: z.string().min(1),
  password: z
    .string()
    .min(6, "Use at least 6 characters.")
    .max(200, "That password is too long."),
});

/**
 * Platform-admin action: set (or replace) a tenant's admin password from the
 * Super Admin UI. Gated to platform users.
 */
export async function setTenantAdminPasswordAction(
  slug: string,
  password: string,
): Promise<SetTenantAdminPasswordResult> {
  await requirePlatformUser();

  if (isDemoMode()) {
    return {
      error: `Demo mode uses a fixed password ("${demoAdminPassword()}"). Connect a database to set per-tenant passwords.`,
    };
  }

  const parsed = setPasswordSchema.safeParse({ slug, password });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: parsed.data.slug },
    select: { id: true },
  });
  if (!tenant) return { error: "Tenant not found." };

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { adminPasswordHash: hashAdminPassword(parsed.data.password) },
  });

  revalidatePath(`/admin/tenants/${parsed.data.slug}`);
  return { ok: true };
}
