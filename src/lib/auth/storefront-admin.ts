import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getTenantIdOrNull } from "@/lib/tenant/headers";

/**
 * Server session for the tenant's self-service storefront admin (the password
 * gate at `<slug>.<root>/#admin`). Distinct from the platform-managed
 * `tenant_admin_session` (lib/auth/tenant-admin.ts): that one is verified against
 * `Tenant.adminPasswordHash` from the /dashboard login, whereas this one is
 * verified against the `branding.config.adminPassword` the store owner sets in
 * the storefront editor. We keep a separate cookie so the two credentials never
 * conflate. The cookie carries the tenantId, HMAC-signed so we can trust it on
 * subsequent write requests (see actions/storefront-admin.ts).
 */

const COOKIE_NAME = "sf_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days — storefront admin sessions

function sessionSecret(): Buffer {
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
  return Buffer.from(raw, "utf8");
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function buildToken(tenantId: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${tenantId}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

function parseToken(token: string): { tenantId: string } | null {
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return null;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  const expectedSig = sign(payload);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;
  const [tenantId, expiresAtStr] = payload.split(".");
  const expiresAt = Number(expiresAtStr);
  if (!tenantId || !Number.isFinite(expiresAt)) return null;
  if (expiresAt * 1000 < Date.now()) return null;
  return { tenantId };
}

export async function setStorefrontAdminCookie(tenantId: string): Promise<void> {
  const jar = await cookies();
  jar.set({
    name: COOKIE_NAME,
    value: buildToken(tenantId),
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

/** Read the cookie and return the tenantId it was issued for, or null. */
export async function readStorefrontAdminCookie(): Promise<{ tenantId: string } | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return parseToken(token);
}

/**
 * Require a valid storefront-admin session for the CURRENT request's tenant and
 * return that tenantId (or null). The tenant is resolved server-side from the
 * request host — never trusted from the client — and the cookie must have been
 * issued for that same tenant, so a session for store A can't mutate store B.
 * Shared by every storefront-admin server action (auth, payments, products).
 */
export async function requireStorefrontAdmin(): Promise<string | null> {
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return null;
  const cookie = await readStorefrontAdminCookie();
  if (!cookie || cookie.tenantId !== tenantId) return null;
  return tenantId;
}
