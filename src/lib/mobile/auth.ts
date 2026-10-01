import "server-only";

import { prisma } from "@/lib/db/prisma";
import { isDemoMode } from "@/lib/demo/fixtures";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { getTenantContext, type TenantContext } from "@/lib/tenant/context";
import { storefrontBouncePath } from "@/lib/tenant/gate";
import { getTrialState } from "@/lib/trial/trial-info";
import { isTrialPaused } from "@/lib/trial/trial-state";
import { normalizeLoginEmail } from "@/lib/auth/login-email";
import type { SessionSubject } from "@/lib/auth/storefront-session-token";
import { sanitizePermissions, type StaffActor } from "@/storefront/admin/staff-permissions";
import type { ApiErrorCode, CustomerActor, MobileActor } from "./contract";
import { readAccessSession, revokeSession, type LiveSession, type MobileSubject } from "./sessions";
import { credentialStamp, parseBearer } from "./tokens";

/**
 * The mobile API's equivalent of getStorefrontAdminActor(): turn a bearer token
 * into { tenant, actor } — re-derived from the DATABASE on every request, never
 * from anything the app sends. Mirrors the web rules exactly:
 *   - suspended / pending_setup stores are closed (lib/tenant/gate.ts);
 *   - an expired trial locks the admin (enforced here server-side; on the web
 *     that lock is only client-side);
 *   - staff must still exist, be active, and the store must still hold
 *     STORE_STAFF_ACCOUNTS — same as the web login;
 *   - the credential stamp must match the CURRENT password hash, so a password
 *     change signs this phone out.
 * A session that fails an identity check is revoked on the spot (it can never
 * become valid again), which also drops its push registration.
 */

export type AuthFailure = { code: ApiErrorCode; message: string };

export type MobileContext = {
  session: LiveSession;
  tenantId: string;
  slug: string;
  actor: StaffActor;
  actorInfo: MobileActor;
  tenant: TenantContext;
};

/** A storefront customer signed in to the app (docs/mobile-admin/COMMUNITY.md). */
export type CustomerInfo = { id: string; email: string; name: string; phone: string };

export type CustomerContext = {
  session: LiveSession;
  tenantId: string;
  slug: string;
  customer: CustomerInfo;
  actorInfo: CustomerActor;
  tenant: TenantContext;
};

/** Every signed-in phone is one of these. */
export type Principal = { kind: "admin"; ctx: MobileContext } | { kind: "customer"; ctx: CustomerContext };

export const TEAM_ONLY: AuthFailure = { code: "forbidden", message: "This is for the store team." };

export const SIGNED_OUT: AuthFailure = {
  code: "session_revoked",
  message: "You've been signed out. Please sign in again.",
};

/** The identity a login or session belongs to, plus its current credential stamp. */
export type ResolvedActor = { actor: StaffActor; info: MobileActor; stamp: string };

export function stampFor(email: string, passwordHash: string): string {
  return credentialStamp(`${normalizeLoginEmail(email)}\n${passwordHash}`);
}

export async function resolveActor(
  tenantId: string,
  subject: SessionSubject,
): Promise<ResolvedActor | null> {
  if (subject.kind === "owner") {
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { storeAdminEmail: true, storeAdminPasswordHash: true },
    });
    if (!t?.storeAdminEmail || !t.storeAdminPasswordHash) return null;
    return {
      actor: { kind: "owner" },
      info: { kind: "owner", displayName: "Store owner", email: t.storeAdminEmail },
      stamp: stampFor(t.storeAdminEmail, t.storeAdminPasswordHash),
    };
  }

  const staff = await prisma.storefrontStaff.findFirst({
    where: { id: subject.id, tenantId },
    select: { id: true, fullName: true, email: true, status: true, passwordHash: true, permissions: true },
  });
  if (!staff || staff.status !== "active") return null;
  if (!(await hasFeature(tenantId, FEATURES.STORE_STAFF_ACCOUNTS))) return null;
  return {
    actor: { kind: "staff", id: staff.id, permissions: sanitizePermissions(staff.permissions) },
    info: { kind: "staff", displayName: staff.fullName || staff.email, email: staff.email },
    stamp: stampFor(staff.email, staff.passwordHash),
  };
}

export type ResolvedCustomer = { customer: CustomerInfo; info: CustomerActor; stamp: string };

export type ResolvedPrincipal =
  | ({ kind: "admin" } & ResolvedActor)
  | ({ kind: "customer" } & ResolvedCustomer);

/**
 * A customer's credential stamp also covers the account's sessionVersion, which
 * the website bumps on password change or disable — either signs the phone out.
 */
export function customerStampFor(email: string, passwordHash: string, sessionVersion: number): string {
  return credentialStamp(`${normalizeLoginEmail(email)}\n${passwordHash}\n${sessionVersion}`);
}

/**
 * A live customer account: exists in this store, is active, and the store still
 * holds MOBILE_COMMUNITY (the customer app is part of that feature).
 */
export async function resolveCustomer(tenantId: string, customerId: string): Promise<ResolvedCustomer | null> {
  const [row, entitled] = await Promise.all([
    prisma.storefrontCustomer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true, email: true, name: true, phone: true, passwordHash: true, status: true, sessionVersion: true },
    }),
    hasFeature(tenantId, FEATURES.MOBILE_COMMUNITY),
  ]);
  if (!row || row.status !== "active" || !entitled) return null;
  return {
    customer: { id: row.id, email: row.email, name: row.name, phone: row.phone },
    info: { kind: "customer", displayName: row.name || row.email, email: row.email },
    stamp: customerStampFor(row.email, row.passwordHash, row.sessionVersion),
  };
}

export async function resolveSubject(tenantId: string, subject: MobileSubject): Promise<ResolvedPrincipal | null> {
  if (subject.kind === "customer") {
    const c = await resolveCustomer(tenantId, subject.id);
    return c ? { kind: "customer", ...c } : null;
  }
  const a = await resolveActor(tenantId, subject);
  return a ? { kind: "admin", ...a } : null;
}

/** Store-level availability, shared by login and every authenticated call. */
export async function storeAvailability(
  tenant: { id: string; status: string } | null,
): Promise<AuthFailure | null> {
  if (!tenant || storefrontBouncePath(tenant)) {
    return {
      code: "store_unavailable",
      message: "This store isn't available right now. Contact Pepweb support.",
    };
  }
  if (isTrialPaused(await getTrialState(tenant.id))) {
    return {
      code: "store_unavailable",
      message: "Your free trial has ended. Choose a plan on the website to keep managing your store.",
    };
  }
  return null;
}

type AuthResult<T> = { ok: true; ctx: T } | { ok: false; failure: AuthFailure };

/**
 * Resolve ANY signed-in phone — store team or customer — re-checking the store,
 * the account and its credential stamp against the database on every call.
 */
export async function authenticateSession(
  req: Request,
): Promise<{ ok: true; principal: Principal } | { ok: false; failure: AuthFailure }> {
  if (isDemoMode()) {
    return { ok: false, failure: { code: "store_unavailable", message: "Not available in demo mode." } };
  }
  const token = parseBearer(req.headers.get("authorization"));
  if (!token) return { ok: false, failure: { code: "unauthenticated", message: "Sign in required." } };

  const access = await readAccessSession(token);
  if (!access.ok) {
    return access.reason === "revoked"
      ? { ok: false, failure: SIGNED_OUT }
      : { ok: false, failure: { code: "unauthenticated", message: "Session expired." } };
  }
  const { session } = access;

  // Status is read FRESH (not from the 5-minute tenant cache) so an operator
  // suspension takes effect on the very next call; the cached context is used
  // only for branding and entitlements.
  // The account is resolved in the SAME round trip as the store checks (every
  // sequential query costs a full trip to the database). The outcome order is
  // unchanged: a closed store answers store_unavailable before the credential
  // stamp is ever compared, so it never revokes the session.
  const [live, tenant, resolved] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: session.tenantId }, select: { id: true, status: true } }),
    getTenantContext(session.tenantId).catch(() => null),
    resolveSubject(session.tenantId, session.subject),
    // Warms the trial read storeAvailability makes next, so it is a cache hit
    // instead of one more sequential trip. Fail-open, like getTrialState itself.
    getTrialState(session.tenantId).catch(() => null),
  ]);
  const unavailable = await storeAvailability(tenant ? live : null);
  if (unavailable) return { ok: false, failure: unavailable };

  if (!resolved || resolved.stamp !== session.credentialStamp) {
    await revokeSession(session.id);
    return { ok: false, failure: SIGNED_OUT };
  }

  const base = { session, tenantId: session.tenantId, slug: tenant!.tenant.slug, tenant: tenant! };
  return resolved.kind === "admin"
    ? { ok: true, principal: { kind: "admin", ctx: { ...base, actor: resolved.actor, actorInfo: resolved.info } } }
    : {
        ok: true,
        principal: { kind: "customer", ctx: { ...base, customer: resolved.customer, actorInfo: resolved.info } },
      };
}

/** The store team only — every pre-existing admin route goes through this. */
export async function authenticateMobile(req: Request): Promise<AuthResult<MobileContext>> {
  const auth = await authenticateSession(req);
  if (!auth.ok) return auth;
  if (auth.principal.kind !== "admin") return { ok: false, failure: TEAM_ONLY };
  return { ok: true, ctx: auth.principal.ctx };
}

/** Customers only (shop, my orders, checkout, re-applying to the community). */
export async function authenticateCustomer(req: Request): Promise<AuthResult<CustomerContext>> {
  const auth = await authenticateSession(req);
  if (!auth.ok) return auth;
  if (auth.principal.kind !== "customer") {
    return { ok: false, failure: { code: "forbidden", message: "This is for customer accounts." } };
  }
  return { ok: true, ctx: auth.principal.ctx };
}
