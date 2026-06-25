import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Pure codec for the visitor gate session token — no "server-only", no cookies —
 * so it's unit-testable. Token = base64url(JSON payload) + "." + base64url(HMAC-
 * SHA256(body)). The cookie wrapper (lib/auth/storefront-gate.ts) layers `cookies()`
 * + rolling-exp on top of this.
 *
 * Security properties (covered by scripts/test-access-gate.ts):
 *   - payload carries tenantId + codeVersion, so the caller can reject a cookie
 *     minted for another tenant or under an older code version;
 *   - signature is verified with a timing-safe comparison;
 *   - expired tokens are rejected.
 */

export type GatePayload = {
  tenantId: string;
  codeVersion: number;
  iat: number; // unix seconds — first unlock; anchors the absolute session cap
  exp: number; // unix seconds — rolling idle expiry
};

function resolveSecret(secret?: string): Buffer {
  const raw =
    secret ??
    process.env.TENANT_ADMIN_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXTAUTH_SECRET;
  if (!raw) {
    throw new Error(
      "TENANT_ADMIN_SECRET is not set. Add it to .env (any long random string) to enable the access-code gate.",
    );
  }
  return Buffer.from(raw, "utf8");
}

function sign(body: string, secret?: string): string {
  return createHmac("sha256", resolveSecret(secret)).update(body).digest("base64url");
}

export function encodeGateToken(payload: GatePayload, secret?: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** Verify signature + expiry and return the payload, or null. Does NOT check tenant. */
export function verifyGateToken(token: string, secret?: string): GatePayload | null {
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return null;
  const body = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);

  const expectedSig = sign(body, secret);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload: GatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
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
