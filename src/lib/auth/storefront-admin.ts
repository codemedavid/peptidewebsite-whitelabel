import "server-only";
import { cookies } from "next/headers";
import { getTenantIdOrNull } from "@/lib/tenant/headers";
import {
  encodeSessionToken,
  decodeSessionToken,
  type SessionSubject,
} from "./storefront-session-token";

/**
 * Server session for the tenant's self-service storefront admin (the login at
 * `<slug>.<root>/#admin`). Distinct from the platform-managed
 * `tenant_admin_session` (lib/auth/tenant-admin.ts), which is verified against
 * `Tenant.adminPasswordHash` from the /dashboard login. This cookie is issued by
 * the unified store-admin login (actions/storefront-staff.ts) once a username +
 * password is verified.
 *
 * The cookie is HMAC-signed (see storefront-session-token.ts) and now carries a
 * SUBJECT — `owner` or `staff:<id>` — so the server knows WHO is signed in.
 * Owner-only cookies minted before staff existed (the legacy 2-part token) keep
 * working and decode as owner. Permission enforcement lives in
 * lib/auth/staff-guard.ts, which re-loads the staff row per request so suspends
 * and permission edits take effect immediately.
 */

const COOKIE_NAME = "sf_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days — storefront admin sessions

export type { SessionSubject };

function sessionSecret(): string {
  // Same secret resolution as tenant-admin so a single env var configures both.
  const raw =
    process.env.TENANT_ADMIN_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXTAUTH_SECRET;
  if (!raw) {
    throw new Error(
      "TENANT_ADMIN_SECRET is not set. Add it to .env (any long random string) to enable storefront admin login.",
    );
  }
  return raw;
}

/**
 * Issue the signed `sf_admin_session` cookie for `tenantId` and `subject`. The
 * subject defaults to owner so existing call sites that only pass a tenantId keep
 * minting owner sessions unchanged.
 */
export async function setStorefrontAdminCookie(
  tenantId: string,
  subject: SessionSubject = { kind: "owner" },
): Promise<void> {
  const jar = await cookies();
  jar.set({
    name: COOKIE_NAME,
    value: encodeSessionToken(sessionSecret(), tenantId, subject, SESSION_TTL_SECONDS, Date.now()),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearStorefrontAdminCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

/** Read + verify the cookie and return its tenantId + subject, or null. */
export async function readStorefrontAdminSession(): Promise<{
  tenantId: string;
  subject: SessionSubject;
} | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return decodeSessionToken(sessionSecret(), token, Date.now());
}

/**
 * Require a valid storefront-admin session for the CURRENT request's tenant and
 * return that tenantId (or null). The tenant is resolved server-side from the
 * request host — never trusted from the client — and the cookie must have been
 * issued for that same tenant, so a session for store A can't mutate store B.
 *
 * This only proves "a valid admin session exists" (owner OR staff). It does NOT
 * check per-module permissions — gated actions must additionally call
 * requireStaffPermission() (lib/auth/staff-guard.ts).
 */
export async function requireStorefrontAdmin(): Promise<string | null> {
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return null;
  const session = await readStorefrontAdminSession();
  if (!session || session.tenantId !== tenantId) return null;
  return tenantId;
}
