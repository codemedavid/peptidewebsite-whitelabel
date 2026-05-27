import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./supabase-server";
import { roleAtLeast, type TenantRole } from "./rbac";
import { getTenantIdOrNull } from "@/lib/tenant/headers";
import { prisma } from "@/lib/db/prisma";
import { isDemoMode } from "@/lib/demo/fixtures";

export type TenantSession = {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
};

/**
 * Resolve the current user's membership IN THE CURRENT TENANT.
 * The tenant comes from the host (x-tenant-id), so a user logged into
 * acme.app who points at bigcorp.app has no membership → null. This is
 * the authorization boundary between tenants.
 */
export async function getTenantSession(): Promise<TenantSession | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return null;

  const membership = await prisma.tenantUser.findUnique({
    where: { tenantId_userId: { tenantId, userId: user.id } },
    select: { role: true, email: true },
  });
  if (!membership) return null;

  return { userId: user.id, email: membership.email, tenantId, role: membership.role };
}

export async function requireTenantRole(min: TenantRole): Promise<TenantSession> {
  const session = await getTenantSession();
  if (!session || !roleAtLeast(session.role, min)) {
    throw new Error("FORBIDDEN");
  }
  return session;
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
