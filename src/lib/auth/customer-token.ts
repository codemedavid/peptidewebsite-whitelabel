import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Pure codec for the storefront CUSTOMER session token — no "server-only", no
 * cookies — so it is unit-testable (scripts/test-customer-accounts.ts). The
 * cookie wrapper is lib/auth/customer-session.ts.
 *
 * Same shape as reseller-token.ts and for the same reason signs `SCOPE.body`
 * rather than `body`: every storefront HMAC surface shares one secret, so the
 * scope prefix is what stops a visitor-gate or reseller cookie from being pasted
 * into `sf.customer` and read as a signed-in shopper.
 *
 * The token only names WHO; it is never the whole answer. The session resolver
 * re-reads the customer row on every request (see resolveCustomerSession), so a
 * disabled account or a password change takes effect immediately.
 */

const SCOPE = "customer.v1";

export type CustomerPayload = {
  scope: typeof SCOPE;
  tenantId: string;
  customerId: string;
  /** Must equal StorefrontCustomer.sessionVersion, which bumps to revoke. */
  sessionVersion: number;
  iat: number; // unix seconds
  exp: number; // unix seconds
};

function resolveSecret(secret?: string): Buffer {
  const raw =
    secret ??
    process.env.TENANT_ADMIN_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXTAUTH_SECRET;
  if (!raw) {
    throw new Error(
      "TENANT_ADMIN_SECRET is not set. Add it to .env (any long random string) to enable customer accounts.",
    );
  }
  return Buffer.from(raw, "utf8");
}

function sign(body: string, secret?: string): string {
  return createHmac("sha256", resolveSecret(secret)).update(`${SCOPE}.${body}`).digest("base64url");
}

export function encodeCustomerToken(payload: Omit<CustomerPayload, "scope">, secret?: string): string {
  const body = Buffer.from(JSON.stringify({ ...payload, scope: SCOPE }), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** Verify signature + scope + expiry, or null. Does NOT check tenant or the DB row. */
export function verifyCustomerToken(token: string, secret?: string): CustomerPayload | null {
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return null;
  const body = token.slice(0, lastDot);
  const sigBuf = Buffer.from(token.slice(lastDot + 1));
  const expectedBuf = Buffer.from(sign(body, secret));
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload: CustomerPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    payload?.scope !== SCOPE ||
    typeof payload.tenantId !== "string" ||
    typeof payload.customerId !== "string" ||
    typeof payload.sessionVersion !== "number" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }
  if (payload.exp * 1000 < Date.now()) return null;
  return payload;
}
