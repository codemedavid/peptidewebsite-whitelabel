import type { SessionCheck, SessionRow } from "./session-rules";

/**
 * Pure liveness rule for the mobile session a handoff token names
 * (redeemAppHandoffAction). There is no bearer token to hash-check here — the
 * handoff token itself is the HMAC-signed proof, minted within the last 60s by
 * a request that passed checkAccess — so what remains is the session's own
 * lifetime: not revoked, and its refresh window still open (the phone could
 * still renew its access token, i.e. it is still signed in).
 */
export function checkHandoffSession(
  row: Pick<SessionRow, "revokedAt" | "refreshExpiresAt">,
  now: Date,
): SessionCheck {
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (row.refreshExpiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}
