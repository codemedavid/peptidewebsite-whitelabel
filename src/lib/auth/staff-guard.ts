import "server-only";
import { prisma } from "@/lib/db/prisma";
import { isDemoMode } from "@/lib/demo/fixtures";
import { getTenantIdOrNull } from "@/lib/tenant/headers";
import { readStorefrontAdminSession } from "./storefront-admin";
import {
  sanitizePermissions,
  isModuleAllowed,
  type StaffActor,
} from "@/storefront/admin/staff-permissions";

/**
 * Server enforcement boundary for the store-admin Staff Accounts feature. Turns
 * the signed session (owner | staff:<id>) into a concrete actor and gates module
 * access. Staff state is re-loaded from the DB on EVERY request so suspending a
 * staffer or editing their permissions takes effect immediately — the cookie
 * only carries identity, never a permission snapshot to go stale.
 */

export type AdminActorContext = { tenantId: string; actor: StaffActor };

/**
 * Resolve the current store-admin session into an actor for the current tenant,
 * or null when there is no valid session for this tenant — or the session points
 * at a staff member who no longer exists or has been suspended.
 */
export async function getStorefrontAdminActor(): Promise<AdminActorContext | null> {
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return null;

  const session = await readStorefrontAdminSession();
  if (!session || session.tenantId !== tenantId) return null;

  if (session.subject.kind === "owner") {
    return { tenantId, actor: { kind: "owner" } };
  }

  // Staff accounts are not available in demo mode (mirrors the access-code gate).
  if (isDemoMode()) return null;

  const staff = await prisma.storefrontStaff.findFirst({
    where: { id: session.subject.id, tenantId },
    select: { id: true, status: true, permissions: true },
  });
  if (!staff || staff.status !== "active") return null;

  return {
    tenantId,
    actor: { kind: "staff", id: staff.id, permissions: sanitizePermissions(staff.permissions) },
  };
}

/**
 * Require a store-admin session allowed to use `moduleKey`. Owner passes
 * everything; staff must hold the exact permission. Returns the {tenantId, actor}
 * context on success, or null to reject. EVERY gated store-admin action must call
 * this (not just requireStorefrontAdmin) — client menu-hiding is not security.
 */
export async function requireStaffPermission(moduleKey: string): Promise<AdminActorContext | null> {
  const ctx = await getStorefrontAdminActor();
  if (!ctx) return null;
  if (!isModuleAllowed(ctx.actor, moduleKey)) return null;
  return ctx;
}

/**
 * Require an OWNER session for the current tenant (staff never qualify, even with
 * every module granted). Used by the Staff Accounts management actions so a staff
 * member can never create staff or escalate their own grants. Returns the
 * tenantId on success, or null.
 */
export async function requireStoreOwner(): Promise<string | null> {
  const ctx = await getStorefrontAdminActor();
  if (!ctx || ctx.actor.kind !== "owner") return null;
  return ctx.tenantId;
}
