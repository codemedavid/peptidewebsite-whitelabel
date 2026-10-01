import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password-hash";
import { normalizeStoreStatus } from "@/lib/storefront/store-status";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { rateLimit } from "@/lib/security/rate-limit";
import type { MobileContext } from "./auth";
import { stampFor } from "./auth";

/**
 * Store open/closed + change password, mirroring saveStoreStatusAction and
 * changeStorefrontAdminPasswordAction field-for-field.
 */

const MIN_PASSWORD = 6;
const PASSWORD_ATTEMPTS = 5;
const FIFTEEN_MIN = 15 * 60 * 1000;

/** Flip the shop switch, keeping the owner's closed-notice copy intact. */
export async function setStoreOpen(ctx: MobileContext, open: boolean): Promise<{ open: boolean }> {
  // Read the CURRENT config (not the cached context) so a concurrent website
  // edit to another branding field is never overwritten by this write.
  const row = await prisma.branding.findUnique({ where: { tenantId: ctx.tenantId }, select: { config: true } });
  const current = (row?.config ?? {}) as Record<string, unknown>;
  const storeStatus = normalizeStoreStatus({ ...normalizeStoreStatus(current.storeStatus), open });
  const config = { ...current, storeStatus };
  await prisma.branding.upsert({
    where: { tenantId: ctx.tenantId },
    update: { config: config as Prisma.InputJsonValue },
    create: { tenantId: ctx.tenantId, config: config as Prisma.InputJsonValue },
  });
  revalidateTenant(ctx.tenantId, ctx.slug);
  return { open: storeStatus.open };
}

export type PasswordResult = { ok: true } | { ok: false; message: string };

/**
 * Change the signed-in account's own password. On success THIS session is
 * re-stamped with the new credential, so the phone making the change stays
 * signed in while every other phone signed in with the old password is signed
 * out on its next request.
 */
export async function changePassword(
  ctx: MobileContext,
  currentPassword: unknown,
  newPassword: unknown,
): Promise<PasswordResult> {
  // A stolen access token must not become an unlimited password oracle.
  if (!rateLimit(`mobile:pw:${ctx.session.id}`, PASSWORD_ATTEMPTS, FIFTEEN_MIN).ok) {
    return { ok: false, message: "Too many attempts. Try again in a few minutes." };
  }
  const current = typeof currentPassword === "string" ? currentPassword.trim() : "";
  const next = typeof newPassword === "string" ? newPassword.trim() : "";
  if (next.length < MIN_PASSWORD) {
    return { ok: false, message: `New password must be at least ${MIN_PASSWORD} characters.` };
  }

  let email: string;
  let newHash: string;
  if (ctx.actor.kind === "staff") {
    const staff = await prisma.storefrontStaff.findFirst({
      where: { id: ctx.actor.id, tenantId: ctx.tenantId },
      select: { email: true, passwordHash: true },
    });
    if (!staff) return { ok: false, message: "Account not found." };
    if (!verifyPassword(current, staff.passwordHash)) return { ok: false, message: "Current password is incorrect." };
    newHash = hashPassword(next);
    await prisma.$transaction([
      prisma.storefrontStaff.update({ where: { id: ctx.actor.id }, data: { passwordHash: newHash } }),
      restamp(ctx, staff.email, newHash),
    ]);
    return { ok: true };
  } else {
    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { storeAdminEmail: true, storeAdminPasswordHash: true },
    });
    if (!tenant?.storeAdminPasswordHash || !tenant.storeAdminEmail) {
      return { ok: false, message: "No sign-in is set for this store yet. Contact Pepweb support." };
    }
    if (!verifyPassword(current, tenant.storeAdminPasswordHash)) {
      return { ok: false, message: "Current password is incorrect." };
    }
    if (verifyPassword(next, tenant.storeAdminPasswordHash)) {
      return { ok: false, message: "New password must be different from the current one." };
    }
    newHash = hashPassword(next);
    await prisma.$transaction([
      prisma.tenant.update({ where: { id: ctx.tenantId }, data: { storeAdminPasswordHash: newHash } }),
      restamp(ctx, tenant.storeAdminEmail, newHash),
    ]);
    revalidateTenant(ctx.tenantId, ctx.slug);
  }
  return { ok: true };
}

/** Keep THIS phone signed in under the new credential (same transaction as the change). */
function restamp(ctx: MobileContext, email: string, passwordHash: string) {
  return prisma.mobileSession.update({
    where: { id: ctx.session.id },
    data: { credentialStamp: stampFor(email, passwordHash) },
  });
}
