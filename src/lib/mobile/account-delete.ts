import "server-only";

import { prisma } from "@/lib/db/prisma";
import { withTenant } from "@/lib/db/tenant-client";
import { revalidateOrders } from "@/lib/orders/order-cache";
import { hashPassword, verifyPassword } from "@/lib/auth/password-hash";
import { customerKey } from "@/lib/community/keys";
import { isSupabaseMarker, supabaseTokenOwnsAccount } from "./exchange";
import { rateLimit } from "@/lib/security/rate-limit";
import type { ApiErrorCode, DeleteAccountResponse } from "./contract";
import type { MobileContext, Principal } from "./auth";
import { profileSubject } from "./account-profile";
import { encodeSubject, type MobileSubject } from "./sessions";

/**
 * "Delete account" from inside the app (Apple guideline 5.1.1(v)).
 *
 * The password is re-entered and checked with the same scrypt verifier login
 * uses — always exactly ONE scrypt per attempt, whatever the account state, so
 * timing says nothing more than login's does. Attempts are rate-limited per
 * account (not per session, so minting new sessions doesn't reset the count).
 *
 *   Customer       → personal data removed NOW, in one tenant-scoped
 *                    transaction (a fixed ~10 statements, no per-row loops):
 *                    the account row (name, email, phone, password hash), its
 *                    profile, community membership, read markers and upload
 *                    records; their community messages are blanked and marked
 *                    deleted so threads keep their shape ("Former member").
 *                    Orders STAY (the store's books) but are unlinked from the
 *                    account. Every app session is revoked, every push device
 *                    dropped; the website session dies with the row.
 *   Owner / staff  → the store is never destroyed from a phone. A pending
 *                    AccountDeletionRequest is recorded for the platform
 *                    operator and every phone on that login is signed out.
 */

const ATTEMPTS = 5;
const FIFTEEN_MIN = 15 * 60 * 1000;
const MAX_PASSWORD = 200; // login's own cap
/** A valid scrypt hash of a throwaway value — only ever used to spend time. */
const TIMING_DUMMY_HASH = hashPassword(`timing-${Math.random()}`);

export const DELETED_MESSAGE = "Your account and personal data have been deleted. Your past orders stay with the store for its records.";
export const REQUESTED_MESSAGE = "We received your request; your account and data will be deleted within 30 days.";
const WRONG_PASSWORD = "That password isn't right.";

export type DeleteOutcome =
  | { ok: true; data: DeleteAccountResponse }
  | { ok: false; code: ApiErrorCode; message: string };

function subjectOf(principal: Principal): MobileSubject {
  if (principal.kind === "customer") return { kind: "customer", id: principal.ctx.customer.id };
  const actor = principal.ctx.actor;
  return actor.kind === "staff" ? { kind: "staff", id: actor.id } : { kind: "owner" };
}

/** The account's CURRENT password hash (null = none set), read fresh. */
async function currentHash(principal: Principal): Promise<string | null> {
  const { tenantId } = principal.ctx;
  if (principal.kind === "customer") {
    const row = await prisma.storefrontCustomer.findFirst({
      where: { id: principal.ctx.customer.id, tenantId },
      select: { passwordHash: true },
    });
    return row?.passwordHash ?? null;
  }
  const actor = principal.ctx.actor;
  if (actor.kind === "staff") {
    const row = await prisma.storefrontStaff.findFirst({ where: { id: actor.id, tenantId }, select: { passwordHash: true } });
    return row?.passwordHash ?? null;
  }
  const row = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { storeAdminPasswordHash: true } });
  return row?.storeAdminPasswordHash ?? null;
}

/** Exactly one scrypt, hash or no hash. */
function passwordMatches(password: string, hash: string | null): boolean {
  if (!hash) {
    verifyPassword(password, TIMING_DUMMY_HASH);
    return false;
  }
  return verifyPassword(password, hash);
}

/**
 * Confirms it is really the account holder: the password, or — for a customer
 * made by /auth/exchange, which has none — a fresh token from the partner app's
 * Supabase login, bound to that exact user.
 */
async function confirmIdentity(principal: Principal, rawPassword: unknown, rawSupabaseToken: unknown): Promise<DeleteOutcome | null> {
  const hash = await currentHash(principal);
  if (principal.kind === "customer" && isSupabaseMarker(hash)) {
    const token = typeof rawSupabaseToken === "string" ? rawSupabaseToken.trim() : "";
    if (!token) return { ok: false, code: "invalid_input", message: "Sign in to the app again, then retry." };
    if (!(await supabaseTokenOwnsAccount(principal.ctx.tenantId, hash, token))) {
      return { ok: false, code: "wrong_password", message: "We couldn't confirm it's you. Sign in to the app again, then retry." };
    }
    return null;
  }
  const password = typeof rawPassword === "string" ? rawPassword.slice(0, MAX_PASSWORD) : "";
  if (!password.trim()) return { ok: false, code: "invalid_input", message: "Enter your password to continue." };
  if (!passwordMatches(password, hash)) return { ok: false, code: "wrong_password", message: WRONG_PASSWORD };
  return null;
}

export async function deleteAccount(
  principal: Principal,
  rawPassword: unknown,
  rawSupabaseToken?: unknown,
): Promise<DeleteOutcome> {
  const subject = encodeSubject(subjectOf(principal));
  const { tenantId } = principal.ctx;
  if (!rateLimit(`mobile:delete:${tenantId}:${subject}`, ATTEMPTS, FIFTEEN_MIN).ok) {
    return { ok: false, code: "rate_limited", message: "Too many attempts. Try again in a few minutes." };
  }
  const refused = await confirmIdentity(principal, rawPassword, rawSupabaseToken);
  if (refused) return refused;

  if (principal.kind === "customer") {
    await purgeCustomer(principal.ctx.tenantId, principal.ctx.customer.id);
    return { ok: true, data: { outcome: "deleted", message: DELETED_MESSAGE } };
  }
  await recordTeamRequest(principal.ctx, subject);
  return { ok: true, data: { outcome: "requested", message: REQUESTED_MESSAGE } };
}

/** Text/attachment columns of a community message, all cleared on deletion. */
const BLANK_MESSAGE = {
  body: null,
  productId: null,
  variationId: null,
  protocolId: null,
  imageUrl: null,
  imageWidth: null,
  imageHeight: null,
  fileUrl: null,
  fileName: null,
  fileSize: null,
  fileMime: null,
  dropId: null,
} as const;

/**
 * Remove one customer's personal data. Every statement is a single set-based
 * write keyed on the customer — the count is fixed (10 incl. set_config), well
 * inside withTenant's round-trip budget, whatever the account's history.
 * Also run by the store admin's Customers → Delete (actions/customer-accounts.ts).
 */
export async function purgeCustomer(tenantId: string, id: string): Promise<void> {
  const participant = customerKey(id);
  const sessionSubject = encodeSubject({ kind: "customer", id });
  const now = new Date();

  await withTenant(tenantId, async (db) => {
    // Orders stay for the store's books — only the link to the account goes.
    await db.storefrontOrder.updateMany({ where: { customerAccountId: id }, data: { customerAccountId: null } });
    // Blank, don't drop: replies and counters keep their shape; the sender
    // renders as "Former member" once the member row is gone.
    await db.communityMessage.updateMany({ where: { senderKey: participant }, data: { ...BLANK_MESSAGE, deletedAt: now } });
    await db.communityRead.deleteMany({ where: { participantKey: participant } });
    await db.communityUpload.deleteMany({ where: { uploaderKey: participant } });
    await db.accountProfile.deleteMany({ where: { subject: profileSubject({ kind: "customer", id }) } });
    await db.communityMember.deleteMany({ where: { customerId: id } });
    // Every phone: push registrations first, then the sessions themselves.
    await db.mobilePushDevice.deleteMany({ where: { tenantId, session: { subject: sessionSubject } } });
    await db.mobileSession.updateMany({
      where: { tenantId, subject: sessionSubject, revokedAt: null },
      data: { revokedAt: now },
    });
    // Name, email, phone and password hash go with the row (the email is free
    // to sign up again). The website session stops resolving with it.
    await db.storefrontCustomer.deleteMany({ where: { id } });
  });
  revalidateOrders(tenantId);
}

/**
 * Owner / staff: record the request (once — a repeat tap reuses the pending
 * one) and sign out every phone on this login, in one transaction.
 */
async function recordTeamRequest(ctx: MobileContext, subject: string): Promise<void> {
  const { tenantId } = ctx;
  const now = new Date();
  const pending = await prisma.accountDeletionRequest.findFirst({
    where: { tenantId, subject, status: "pending" },
    select: { id: true },
  });
  await prisma.$transaction([
    ...(pending
      ? []
      : [
          prisma.accountDeletionRequest.create({
            data: {
              tenantId,
              subject,
              role: ctx.actor.kind,
              email: ctx.actorInfo.email,
            },
          }),
        ]),
    prisma.mobilePushDevice.deleteMany({ where: { tenantId, session: { subject } } }),
    prisma.mobileSession.updateMany({ where: { tenantId, subject, revokedAt: null }, data: { revokedAt: now } }),
  ]);
}
