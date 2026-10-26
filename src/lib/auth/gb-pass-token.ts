import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Pure codec for the group-buy EMAIL PASS — the cookie a shopper gets by typing
 * their email on a paid group buy's join page instead of signing in. No
 * "server-only", no cookies, so it is unit-testable (scripts/test-gb-email-pass.ts).
 * The cookie wrapper is lib/auth/gb-pass.ts.
 *
 * Same shape as customer-token.ts and signs `SCOPE.body` for the same reason:
 * every storefront HMAC surface shares one secret, so the scope prefix is what
 * stops this pass from being pasted into `sf.customer` and read as a signed-in
 * account (or the other way round). A pass names a customer row for GROUP-BUY
 * ACCESS ONLY — never their account, orders or profile.
 */

const SCOPE = "gbpass.v1";

export const GB_PASS_COOKIE_NAME = "sf.gbpass";
/** Long enough to outlive a round; the row is re-read on every request. */
export const GB_PASS_TTL_SECONDS = 60 * 24 * 60 * 60;

export type GroupBuyPassPayload = {
  scope: typeof SCOPE;
  tenantId: string;
  customerId: string;
  iat: number; // unix seconds
  exp: number; // unix seconds
};

function resolveSecret(secret?: string): Buffer {
  const raw = secret ?? process.env.TENANT_ADMIN_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXTAUTH_SECRET;
  if (!raw) throw new Error("TENANT_ADMIN_SECRET is not set. Add it to .env (any long random string).");
  return Buffer.from(raw, "utf8");
}

function sign(body: string, secret?: string): string {
  return createHmac("sha256", resolveSecret(secret)).update(`${SCOPE}.${body}`).digest("base64url");
}

export function encodeGroupBuyPass(payload: Omit<GroupBuyPassPayload, "scope">, secret?: string): string {
  const body = Buffer.from(JSON.stringify({ ...payload, scope: SCOPE }), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** Verify signature + scope + expiry, or null. Does NOT check tenant or the DB row. */
export function verifyGroupBuyPass(token: string, secret?: string): GroupBuyPassPayload | null {
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return null;
  const body = token.slice(0, lastDot);
  const sigBuf = Buffer.from(token.slice(lastDot + 1));
  const expectedBuf = Buffer.from(sign(body, secret));
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload: GroupBuyPassPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    payload?.scope !== SCOPE ||
    typeof payload.tenantId !== "string" ||
    typeof payload.customerId !== "string" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }
  if (payload.exp * 1000 < Date.now()) return null;
  return payload;
}
