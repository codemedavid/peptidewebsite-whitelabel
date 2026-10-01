import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Pure codec for the Pepweb app → website admin handoff. The app asks
 * /api/mobile/v1/admin/handoff for a token, opens the store's `/#admin` in a
 * WebView and passes the token in by injected script (never the URL). The
 * storefront trades it for the ordinary `sf_admin_session` cookie through
 * redeemAppHandoffAction — a Server Action, so the document-load session reset
 * (lib/auth/admin-session-reset.ts) never sees it.
 *
 * The token only NAMES a mobile session; it grants nothing on its own. The
 * redeemer re-loads that session and re-runs the app's own checks (live, not
 * revoked, credential stamp current, store available) before issuing a cookie,
 * so a password change or sign-out kills an unredeemed token too.
 *
 *   token = base64url(JSON{ s, t, e }) + "." + base64url(HMAC-SHA256)
 *   s = MobileSession id, t = tenant id, e = expiry (unix seconds)
 */

export const HANDOFF_TTL_SECONDS = 60;

/** Domain-separates these signatures from every other use of the secret. */
const CONTEXT = "pepweb-app-handoff:v1\n";

export type HandoffClaims = { sessionId: string; tenantId: string; expiresAt: number };

function sign(secret: string, payload: string): string {
  return createHmac("sha256", Buffer.from(secret, "utf8")).update(CONTEXT + payload).digest("base64url");
}

export function encodeHandoffToken(
  secret: string,
  sessionId: string,
  tenantId: string,
  nowMs: number,
  ttlSeconds: number = HANDOFF_TTL_SECONDS,
): { token: string; expiresAt: number } {
  const expiresAt = Math.floor(nowMs / 1000) + ttlSeconds;
  const payload = Buffer.from(JSON.stringify({ s: sessionId, t: tenantId, e: expiresAt }), "utf8").toString(
    "base64url",
  );
  return { token: `${payload}.${sign(secret, payload)}`, expiresAt: expiresAt * 1000 };
}

export function decodeHandoffToken(secret: string, token: unknown, nowMs: number): HandoffClaims | null {
  if (typeof token !== "string" || token.length > 1024) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), "utf8");
  const expected = Buffer.from(sign(secret, payload), "utf8");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const { s, t, e } = raw as Record<string, unknown>;
  if (typeof s !== "string" || !s || typeof t !== "string" || !t || typeof e !== "number") return null;
  if (e * 1000 <= nowMs) return null;
  return { sessionId: s, tenantId: t, expiresAt: e * 1000 };
}
