import { timingSafeEqual } from "node:crypto";
import { hashToken } from "./tokens";

/**
 * Pure validity rules for a mobile session row. The server wrapper
 * (lib/mobile/sessions.ts) loads the row and APPLIES these decisions; keeping
 * them here means expiry, revocation and refresh-replay are decided in one
 * tested place (npm run test:mobile-core).
 */

export type SessionRow = {
  accessTokenHash: string;
  accessExpiresAt: Date;
  refreshTokenHash: string;
  /** The refresh token this row rotated away from — presenting it again is a replay. */
  previousRefreshTokenHash: string | null;
  refreshExpiresAt: Date;
  revokedAt: Date | null;
};

export type SessionCheck =
  | { ok: true }
  | { ok: false; reason: "revoked" | "expired" | "invalid" | "replay" };

function sameHash(a: string, b: string | null): boolean {
  if (!b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export function checkAccess(row: SessionRow, accessToken: string, now: Date): SessionCheck {
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (!sameHash(hashToken(accessToken), row.accessTokenHash)) return { ok: false, reason: "invalid" };
  if (row.accessExpiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}

/**
 * A refresh token is single-use. The CURRENT one rotates; the PREVIOUS one
 * means somebody replayed a token that was already exchanged (a stolen copy, or
 * a racing client) — the caller must revoke the whole session.
 */
export function checkRefresh(row: SessionRow, refreshToken: string, now: Date): SessionCheck {
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  const h = hashToken(refreshToken);
  if (sameHash(h, row.previousRefreshTokenHash)) return { ok: false, reason: "replay" };
  if (!sameHash(h, row.refreshTokenHash)) return { ok: false, reason: "invalid" };
  if (row.refreshExpiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}
