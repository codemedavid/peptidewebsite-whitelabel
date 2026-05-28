import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./supabase-server";
import { getTenantIdOrNull } from "@/lib/tenant/headers";
import { readTenantAdminCookie } from "./tenant-admin";
import { prisma } from "@/lib/db/prisma";
import { isDemoMode } from "@/lib/demo/fixtures";

export type TenantSession = {
  tenantId: string;
};

/**
 * Resolve the tenant admin session for the CURRENT tenant (from the host).
 * A cookie issued for one tenant is rejected on another host — that's the
 * cross-tenant authorization boundary.
 */
export async function getTenantSession(): Promise<TenantSession | null> {
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return null;
  const cookie = await readTenantAdminCookie();
  if (!cookie || cookie.tenantId !== tenantId) return null;
  return { tenantId };
}

/** Platform-plane (super_admin/support) — used by the (platform) admin app. */
export async function getPlatformUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return prisma.platformUser.findUnique({ where: { id: user.id } });
}

/**
 * Gate for the (platform) admin app. Demo mode is open (no DB/auth). Otherwise a
 * signed-in PlatformUser is required — logged-out visitors are bounced to /login
 * (which the middleware rewrites to /admin/login on the admin host).
 */
export async function requirePlatformUser() {
  if (isDemoMode()) return null;
  const user = await getPlatformUser();
  if (!user) redirect("/login");
  return user;
}
