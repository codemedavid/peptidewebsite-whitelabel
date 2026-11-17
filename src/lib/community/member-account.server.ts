import "server-only";

import { prisma } from "@/lib/db/prisma";
import { withTenant } from "@/lib/db/tenant-client";
import { hashPassword, verifyPassword } from "@/lib/auth/password-hash";
import { rateLimit } from "@/lib/security/rate-limit";
import {
  CUSTOMER_PASSWORD_MAX,
  CUSTOMER_PASSWORD_MIN,
  generateTempPassword,
  parseCustomerPasswordChange,
} from "@/lib/storefront/customer-account";
import { GUEST_PASSWORD_HASH } from "@/lib/storefront/guest-customer";
import { isModuleAllowed } from "@/storefront/admin/staff-permissions";
import type { CustomerContext } from "@/lib/mobile/auth";
import { customerStampFor } from "@/lib/mobile/auth";
import { isAppGuestHash } from "@/lib/mobile/app-guest";
import { isSupabaseMarker } from "@/lib/mobile/exchange";
import type { MemberDetail, MemberPasswordResponse } from "@/lib/mobile/contract";
import type { CommunityActor } from "./actor.server";
import { customerKey } from "./keys";
import { isMemberStatus } from "./membership";
import { loadParticipants } from "./participants.server";

/**
 * A community member's ACCOUNT, as the store team sees it in the app: the
 * detail screen behind a Members row, and the password reset for a member who
 * forgot theirs (there is no self-serve email reset — the member messages the
 * store, the team sets a new password here and sends it to them).
 *
 * Password resets are a store-account power: the owner, or staff holding the
 * "customers" grant (the same grant as the website's Customers → Reset
 * password). Community admins never reach this (routes use `team: true`).
 */

const FIFTEEN_MIN = 15 * 60 * 1000;
const RESETS_PER_WINDOW = 20;
const OWN_CHANGES_PER_WINDOW = 5;

/** A password the team can replace: a real one, not a guest or partner-app login. */
function hasResettablePassword(hash: string): boolean {
  return hash !== GUEST_PASSWORD_HASH && !isAppGuestHash(hash) && !isSupabaseMarker(hash);
}

/** Owner, or staff with the Customers grant. */
export function canManageAccounts(actor: CommunityActor): boolean {
  if (!actor.isTeam || actor.principal.kind !== "admin") return false;
  return isModuleAllowed(actor.principal.ctx.actor, "customers");
}

export async function getMemberDetail(actor: CommunityActor, customerId: string): Promise<MemberDetail | null> {
  if (!customerId) return null;
  return withTenant(actor.tenantId, async (db) => {
    const row = await db.communityMember.findFirst({
      where: { customerId },
      include: {
        customer: { select: { email: true, phone: true, createdAt: true, lastLoginAt: true, passwordHash: true, status: true } },
      },
    });
    if (!row) return null;
    const key = customerKey(customerId);
    const [cards, offenses] = await Promise.all([
      loadParticipants(db, actor.tenant, [key]),
      db.communityFlag.count({ where: { senderKey: key, status: { not: "dismissed" } } }),
    ]);
    const card = cards.get(key);
    return {
      customerId,
      displayName: row.displayName,
      // Community admins see the person, not their contact details (contactFor in members.server).
      email: actor.isTeam ? row.customer.email : "",
      phone: actor.isTeam ? row.customer.phone : "",
      status: isMemberStatus(row.status) ? row.status : "pending",
      reason: row.reason,
      submittedAt: row.submittedAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      verifiedReseller: row.verifiedReseller,
      isAdmin: row.isAdmin,
      offenses: actor.isTeam ? offenses : 0,
      muted: row.mutedAt !== null,
      banned: row.bannedAt !== null,
      avatarUrl: card?.imageUrl ?? null,
      bio: card?.bio ?? "",
      joinedAt: row.customer.createdAt.toISOString(),
      lastLoginAt: row.customer.lastLoginAt?.toISOString() ?? null,
      canResetPassword:
        canManageAccounts(actor) && row.customer.status === "active" && hasResettablePassword(row.customer.passwordHash),
    };
  });
}

export type ResetOutcome =
  | { kind: "ok"; data: MemberPasswordResponse }
  | { kind: "invalid"; message: string }
  | { kind: "forbidden"; message: string }
  | { kind: "not_found" };

/** The team's chosen password, or null to generate one. */
function parseChosenPassword(body: unknown): { ok: true; value: string | null } | { ok: false; message: string } {
  const raw = body && typeof body === "object" ? (body as { password?: unknown }).password : undefined;
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, message: "Enter a password." };
  if (raw.trim() !== raw) return { ok: false, message: "Passwords can't start or end with a space." };
  if (raw.length < CUSTOMER_PASSWORD_MIN) return { ok: false, message: `Use at least ${CUSTOMER_PASSWORD_MIN} characters.` };
  if (raw.length > CUSTOMER_PASSWORD_MAX) return { ok: false, message: "That password is too long." };
  return { ok: true, value: raw };
}

/**
 * Give a member a new password. Bumping sessionVersion signs them out of every
 * phone and browser. The password is returned once, for the team to send them.
 */
export async function resetMemberPassword(actor: CommunityActor, customerId: string, body: unknown): Promise<ResetOutcome> {
  if (!canManageAccounts(actor)) {
    return { kind: "forbidden", message: "Only the store owner, or staff with Customers access, can reset passwords." };
  }
  const chosen = parseChosenPassword(body);
  if (!chosen.ok) return { kind: "invalid", message: chosen.message };
  if (!rateLimit(`community:pw-reset:${actor.tenantId}`, RESETS_PER_WINDOW, FIFTEEN_MIN).ok) {
    return { kind: "invalid", message: "Too many resets. Try again in a few minutes." };
  }

  const password = chosen.value ?? generateTempPassword();
  return withTenant(actor.tenantId, async (db) => {
    const member = await db.communityMember.findFirst({
      where: { customerId },
      select: { customer: { select: { status: true, passwordHash: true } } },
    });
    if (!member) return { kind: "not_found" } as const;
    if (member.customer.status !== "active") {
      return { kind: "invalid", message: "This account is disabled. Re-enable it in Customers first." } as const;
    }
    if (!hasResettablePassword(member.customer.passwordHash)) {
      return { kind: "invalid", message: "This member signs in without a password here, so there's nothing to reset." } as const;
    }
    await db.storefrontCustomer.update({
      where: { id: customerId },
      data: { passwordHash: hashPassword(password), sessionVersion: { increment: 1 } },
    });
    return { kind: "ok", data: { customerId, password, generated: chosen.value === null } } as const;
  });
}

export type OwnPasswordResult = { ok: true } | { ok: false; message: string };

/**
 * A customer changes their OWN password in the app (the website's
 * changeCustomerPasswordAction, field-for-field). Other devices are signed out;
 * THIS phone is re-stamped so it stays signed in.
 */
export async function changeOwnCustomerPassword(
  ctx: CustomerContext,
  currentPassword: unknown,
  newPassword: unknown,
): Promise<OwnPasswordResult> {
  if (!rateLimit(`mobile:customer-pw:${ctx.session.id}`, OWN_CHANGES_PER_WINDOW, FIFTEEN_MIN).ok) {
    return { ok: false, message: "Too many attempts. Try again in a few minutes." };
  }
  const parsed = parseCustomerPasswordChange({ current: currentPassword, next: newPassword });
  if (!parsed.ok) return { ok: false, message: parsed.error };

  const row = await prisma.storefrontCustomer.findFirst({
    where: { id: ctx.customer.id, tenantId: ctx.tenantId },
    select: { email: true, passwordHash: true },
  });
  if (!row || !hasResettablePassword(row.passwordHash)) {
    return { ok: false, message: "This account has no password to change." };
  }
  if (!verifyPassword(parsed.value.current, row.passwordHash)) {
    return { ok: false, message: "Your current password is incorrect." };
  }
  if (parsed.value.current === parsed.value.next) {
    return { ok: false, message: "Choose a password different from your current one." };
  }
  const passwordHash = hashPassword(parsed.value.next);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.storefrontCustomer.update({
      where: { id: ctx.customer.id },
      data: { passwordHash, sessionVersion: { increment: 1 } },
      select: { sessionVersion: true },
    });
    await tx.mobileSession.update({
      where: { id: ctx.session.id },
      data: { credentialStamp: customerStampFor(row.email, passwordHash, updated.sessionVersion) },
    });
  });
  return { ok: true };
}
