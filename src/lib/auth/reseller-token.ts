import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Pure codec for the RESELLER portal session token — no "server-only", no
 * cookies — so it is unit-testable (scripts/test-reseller-session.ts). Token =
 * base64url(JSON payload) + "." + base64url(HMAC-SHA256(SCOPE + "." + body)).
 * The cookie wrapper (lib/auth/reseller-session.ts) layers `cookies()` on top.
 *
 * This mirrors lib/auth/gate-token.ts (the visitor access gate) on purpose —
 * same shape, same timing-safe verify, same expiry rule — but it is NOT the same
 * token, and the difference is load-bearing:
 *
 *   DOMAIN SEPARATION. The visitor gate signs `body`; this signs `SCOPE.body`.
 *   Without that prefix the two tokens would be byte-identical in structure and
 *   signed with the same secret, so a visitor who had legitimately unlocked a
 *   store's access gate could copy their `tenant.sid` cookie value into
 *   `sf.reseller` and read wholesale pricing they never entered a password for.
 *   The prefix makes a signature minted for one gate verify only against that
 *   gate, and `scope` in the payload is checked as a second, explicit belt.
 *
 * Security properties (covered by scripts/test-reseller-session.ts):
 *   - payload carries tenantId + codeVersion, so a cookie minted for store A
 *     cannot authenticate store B, and rotating/clearing the reseller password
 *     bumps the version and invalidates every live session at once;
 *   - the signature is verified with a timing-safe comparison;
 *   - expired tokens are rejected;
 *   - a token from any other gate is rejected (domain separation, above).
 */

/** Signature domain. Any change here invalidates every live reseller session. */
const SCOPE = "reseller.v1";

export type ResellerPayload = {
  scope: typeof SCOPE;
  tenantId: string;
  /** Bumped whenever the reseller password is changed or cleared. */
  codeVersion: number;
  iat: number; // unix seconds — first unlock; anchors the absolute session cap
  exp: number; // unix seconds — expiry
};

function resolveSecret(secret?: string): Buffer {
  const raw =
    secret ??
    process.env.TENANT_ADMIN_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXTAUTH_SECRET;
  if (!raw) {
    throw new Error(
      "TENANT_ADMIN_SECRET is not set. Add it to .env (any long random string) to enable the reseller portal.",
    );
  }
  return Buffer.from(raw, "utf8");
}

/** Sign the SCOPE-prefixed body — the domain separation described above. */
function sign(body: string, secret?: string): string {
  return createHmac("sha256", resolveSecret(secret)).update(`${SCOPE}.${body}`).digest("base64url");
}

export function encodeResellerToken(
  payload: Omit<ResellerPayload, "scope">,
  secret?: string,
): string {
  const body = Buffer.from(JSON.stringify({ ...payload, scope: SCOPE }), "utf8").toString(
    "base64url",
  );
  return `${body}.${sign(body, secret)}`;
}

/** Verify signature + expiry and return the payload, or null. Does NOT check tenant. */
export function verifyResellerToken(token: string, secret?: string): ResellerPayload | null {
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return null;
  const body = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);

  const expectedSig = sign(body, secret);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload: ResellerPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    payload?.scope !== SCOPE ||
    typeof payload?.tenantId !== "string" ||
    typeof payload?.codeVersion !== "number" ||
    typeof payload?.iat !== "number" ||
    typeof payload?.exp !== "number"
  ) {
    return null;
  }
  if (payload.exp * 1000 < Date.now()) return null;
  return payload;
}
