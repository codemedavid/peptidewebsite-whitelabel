import "server-only";
import { cookies } from "next/headers";
import { encodeResellerToken, verifyResellerToken, type ResellerPayload } from "./reseller-token";
import {
  RESELLER_COOKIE_NAME,
  RESELLER_TTL_SECONDS,
  RESELLER_MAX_SESSION_SECONDS,
} from "./reseller-constants";

/**
 * Stateless signed-cookie session for the RESELLER portal, mirroring the visitor
 * access gate (lib/auth/storefront-gate.ts) with the same tenant dimension:
 *
 *   - the payload carries `tenantId`, so a cookie minted for store A can never
 *     unlock store B's wholesale pricing (isResellerUnlocked compares it);
 *   - it carries `codeVersion`, so changing or clearing the reseller password
 *     invalidates every live session at once with no server-side session store;
 *   - the token is domain-scoped, so a cookie from the visitor gate — or any
 *     other HMAC surface sharing the secret — cannot be replayed here
 *     (see reseller-token.ts);
 *   - httpOnly, so the browser cannot read it and no client script can forge or
 *     exfiltrate an unlock.
 *
 * Read-only helpers never write a cookie, so they are safe to call from a Server
 * Component (the storefront render) — Next throws if you set cookies during
 * render. The cookie is minted in the verify Server Action instead.
 */

export type { ResellerPayload };

/** Mint a fresh reseller session for `tenantId` at `codeVersion`. */
export async function saveResellerSession(tenantId: string, codeVersion: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const jar = await cookies();
  jar.set({
    name: RESELLER_COOKIE_NAME,
    value: encodeResellerToken({
      tenantId,
      codeVersion,
      iat: now,
      exp: now + RESELLER_TTL_SECONDS,
    }),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: RESELLER_TTL_SECONDS,
  });
}

/** Read + verify (signature/expiry/scope) the reseller cookie, or null. */
export async function getResellerSession(): Promise<ResellerPayload | null> {
  const jar = await cookies();
  const token = jar.get(RESELLER_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyResellerToken(token);
}

export async function clearResellerSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(RESELLER_COOKIE_NAME);
}

/**
 * Authoritative, READ-ONLY check: does this request hold a valid reseller
 * session for THIS tenant at the CURRENT password version? The single place
 * that enforces the tenant match and the version match, so the storefront
 * render and the order re-price cannot drift apart on who is unlocked.
 */
export async function isResellerUnlocked(tenantId: string, codeVersion: number): Promise<boolean> {
  // Fails closed, and never throws. Verifying the token needs a signing secret,
  // and resolveSecret throws when none is configured — which used to propagate
  // out of the storefront home render and the public price refresh, because both
  // await this outside any try/catch. A missing secret should cost the reseller
  // portal, not the whole store. "Not unlocked" is the only safe answer to this
  // question, so it is answered here rather than left to each caller to
  // remember; the one caller that already guarded is now simply redundant.
  try {
    const session = await getResellerSession();
    if (!session) return false;
    if (session.tenantId !== tenantId) return false; // cross-tenant cookie → reject
    if (session.codeVersion !== codeVersion) return false; // password changed → reject
    if (Math.floor(Date.now() / 1000) >= session.iat + RESELLER_MAX_SESSION_SECONDS) return false;
    return true;
  } catch {
    return false;
  }
}
