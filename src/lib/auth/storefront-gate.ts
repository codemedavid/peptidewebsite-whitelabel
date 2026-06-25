import "server-only";
import { cookies } from "next/headers";
import { encodeGateToken, verifyGateToken, type GatePayload } from "./gate-token";
import {
  GATE_COOKIE_NAME,
  GATE_TTL_SECONDS,
  GATE_MAX_SESSION_SECONDS,
} from "./gate-constants";

/**
 * Stateless signed-cookie session for the per-tenant VISITOR access-code gate
 * (the "enter a code to view this store" wall). Ported from the proven
 * single-tenant design, with a tenant dimension added everywhere:
 *
 *   - The payload carries `tenantId` AND `codeVersion`. A cookie minted for store
 *     A can never authenticate store B (the layout checks tenantId === tenant.id),
 *     and rotating the code bumps `accessCodeVersion`, which instantly invalidates
 *     every live cookie (the layout checks codeVersion === tenant.accessCodeVersion).
 *   - Token = base64url(JSON payload) + "." + base64url(HMAC-SHA256). Verified with
 *     a timing-safe comparison; rejected on bad signature or once `exp` has passed.
 *   - Rolling 15-minute timeout: every successful re-validation re-stamps `exp`.
 *
 * This mirrors the HMAC scheme in lib/auth/storefront-admin.ts but is a SEPARATE
 * cookie (`tenant.sid`) so the visitor gate and the store-admin login never
 * conflate. Hashing of the code itself is scrypt (see actions/storefront-gate.ts
 * + lib/auth/tenant-admin.ts) and only ever runs in Node, never on the Edge.
 */

export type { GatePayload };

/** Mint a FRESH gate session for `tenantId` at `codeVersion` (sets iat = now). */
export async function saveGateSession(tenantId: string, codeVersion: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const jar = await cookies();
  jar.set({
    name: GATE_COOKIE_NAME,
    value: encodeGateToken({ tenantId, codeVersion, iat: now, exp: now + GATE_TTL_SECONDS }),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GATE_TTL_SECONDS,
  });
}

/** Read + verify (signature/expiry) the gate cookie. Returns the payload or null. */
export async function getGateSession(): Promise<GatePayload | null> {
  const jar = await cookies();
  const token = jar.get(GATE_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyGateToken(token);
}

export async function clearGateSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(GATE_COOKIE_NAME);
}

/**
 * Authoritative, READ-ONLY gate check for the current request's tenant. Returns
 * whether the visitor holds a valid cookie for THIS tenant at the CURRENT code
 * version. This is the single place that enforces tenantId match AND codeVersion
 * match, and it's safe to call from a Server Component (the storefront layout)
 * because it never writes a cookie — Next throws if you set cookies during render.
 * The cookie is (re)minted in the verify Server Action instead (saveGateSession).
 */
export async function isGateUnlocked(tenant: {
  id: string;
  accessCodeVersion: number;
}): Promise<boolean> {
  const session = await getGateSession();
  if (!session) return false;
  if (session.tenantId !== tenant.id) return false; // cross-tenant cookie → reject
  if (session.codeVersion !== tenant.accessCodeVersion) return false; // rotated → reject
  // Absolute lifetime cap (independent of the rolling idle timeout).
  if (Math.floor(Date.now() / 1000) >= session.iat + GATE_MAX_SESSION_SECONDS) return false;
  return true;
}
