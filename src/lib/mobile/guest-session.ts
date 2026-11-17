import "server-only";

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { withTenant } from "@/lib/db/tenant-client";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { getTenantContext } from "@/lib/tenant/context";
import { normalizeAccountGate } from "@/lib/storefront/account-gate";
import { rateLimit } from "@/lib/security/rate-limit";
import { normalizeHost } from "@/lib/tenant/cache-tags";
import { customerAppOpen } from "@/lib/mobile/customer-app";
import type { ApiErrorCode, LoginResponse } from "./contract";
import { storeAvailability } from "./auth";
import { openSession } from "./login";
import { isPrivateStore } from "./shop";
import { decodeSubject, findSessionForLogout, revokeSession } from "./sessions";
import { normalizeStoreIdentifier } from "./store-identifier";
import { findStoreByHost, MOBILE_ROOT } from "./store-lookup";
import {
  APP_GUEST_NAME,
  APP_GUEST_PASSWORD_HASH,
  appGuestEmail,
  guestShoppingAllowed,
  isAppGuestHash,
} from "./app-guest";

/**
 * POST /auth/guest — "Continue as guest" after the store code (app-guest.ts).
 * Creates the guest's customer row and signs it in like any customer, so the
 * orders it places carry customerAccountId and the order bot can reach it.
 */

const ONE_HOUR = 60 * 60 * 1000;
const MAX_GUESTS_PER_HOUR = 10;

type Failure = { ok: false; code: ApiErrorCode; message: string };
type Success = { ok: true; data: LoginResponse };

const NOT_FOUND: Failure = {
  ok: false,
  code: "not_found",
  message: "We couldn't find that store. Ask the seller for their app link.",
};

/** May this store's shoppers continue without an account right now? */
export async function guestShoppingOpen(tenantId: string): Promise<boolean> {
  const [shopOpen, isPrivate, tenant, accountsOn] = await Promise.all([
    customerAppOpen(tenantId),
    isPrivateStore(tenantId),
    getTenantContext(tenantId),
    hasFeature(tenantId, FEATURES.STORE_CUSTOMER_ACCOUNTS),
  ]);
  const config = (tenant.branding?.config ?? {}) as { accountGate?: unknown };
  const membersOnly = accountsOn && normalizeAccountGate(config.accountGate).enabled;
  return guestShoppingAllowed({ shopOpen, isPrivate, membersOnly });
}

export async function mobileStartGuest(
  body: Record<string, unknown>,
  ip: string,
  deviceLabel: string | null,
): Promise<Success | Failure> {
  const host = normalizeStoreIdentifier(body.store, MOBILE_ROOT);
  if (!host) return { ok: false, code: "invalid_input", message: "Enter the store you shop at." };

  const limit = rateLimit(`mobile:guest:${ip}`, MAX_GUESTS_PER_HOUR, ONE_HOUR);
  if (!limit.ok) {
    return {
      ok: false,
      code: "rate_limited",
      message: `Too many tries from this device. Try again in ${Math.ceil(limit.retryAfter / 60)} min.`,
    };
  }

  const store = await findStoreByHost(normalizeHost(host));
  if (!store || store.status === "pending_setup") return NOT_FOUND;
  if (await storeAvailability(store)) return NOT_FOUND;
  if (!(await customerAppOpen(store.id))) return NOT_FOUND;
  if (!(await guestShoppingOpen(store.id))) {
    return { ok: false, code: "forbidden", message: "This store asks shoppers to create an account first." };
  }

  const row = await withTenant(store.id, (db) =>
    db.storefrontCustomer.create({
      data: {
        tenantId: store.id,
        email: appGuestEmail(randomBytes(12).toString("hex")),
        name: APP_GUEST_NAME,
        passwordHash: APP_GUEST_PASSWORD_HASH,
        lastLoginAt: new Date(),
      },
      select: { id: true },
    }),
  );
  const session = await openSession(store, { kind: "customer", id: row.id }, ip, deviceLabel);
  if (!session.ok) return session;
  return { ok: true, data: session.data as LoginResponse };
}

export type GuestHandle = { tenantId: string; customerId: string; sessionId: string };

/**
 * The app guest behind `guestToken` — the guest session's access token, sent
 * by sign-in / sign-up from a guest phone. Expiry is ignored on purpose (like
 * logout, holding the token proves it's this phone), but a revoked session,
 * another store's session or a row that isn't a guest never resolves.
 */
export async function findAppGuest(guestToken: unknown, tenantId: string): Promise<GuestHandle | null> {
  if (typeof guestToken !== "string" || !guestToken || guestToken.length > 512) return null;
  const sessionId = await findSessionForLogout(guestToken, null);
  if (!sessionId) return null;
  const session = await prisma.mobileSession.findFirst({
    where: { id: sessionId, tenantId, revokedAt: null },
    select: { id: true, subject: true },
  });
  const subject = session ? decodeSubject(session.subject) : null;
  if (!session || subject?.kind !== "customer") return null;
  const row = await prisma.storefrontCustomer.findFirst({
    where: { id: subject.id, tenantId },
    select: { id: true, passwordHash: true },
  });
  if (!row || !isAppGuestHash(row.passwordHash)) return null;
  return { tenantId, customerId: row.id, sessionId: session.id };
}

/**
 * Signing in to an existing account from a guest phone: the guest's orders
 * move onto that account, then the guest row and its session go. Same store
 * only (findAppGuest checked it).
 */
export async function absorbAppGuest(guest: GuestHandle, targetCustomerId: string): Promise<void> {
  if (guest.customerId === targetCustomerId) return;
  await withTenant(guest.tenantId, async (db) => {
    await db.storefrontOrder.updateMany({
      where: { customerAccountId: guest.customerId },
      data: { customerAccountId: targetCustomerId },
    });
    // Conditional on still being a guest: never deletes a real account.
    await db.storefrontCustomer.deleteMany({
      where: { id: guest.customerId, passwordHash: APP_GUEST_PASSWORD_HASH },
    });
  });
  await revokeSession(guest.sessionId);
}

/**
 * After a successful sign-in from a guest phone: if it opened a customer
 * account on the guest's store, carry the guest's orders over. Never fails
 * the sign-in — the worst case is the orders stay on the guest row.
 */
export async function carryGuestOrders(guestToken: unknown, newAccessToken: string): Promise<void> {
  if (!guestToken) return;
  try {
    const sessionId = await findSessionForLogout(newAccessToken, null);
    const session = sessionId
      ? await prisma.mobileSession.findFirst({ where: { id: sessionId }, select: { tenantId: true, subject: true } })
      : null;
    const subject = session ? decodeSubject(session.subject) : null;
    if (!session || subject?.kind !== "customer") return;
    const guest = await findAppGuest(guestToken, session.tenantId);
    if (guest) await absorbAppGuest(guest, subject.id);
  } catch (e) {
    console.error("[mobile] carryGuestOrders failed", e);
  }
}
