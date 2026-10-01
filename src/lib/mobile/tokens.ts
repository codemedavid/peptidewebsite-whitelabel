import { createHash, randomBytes } from "node:crypto";

/**
 * Token primitives for Pepweb Admin mobile sessions. Pure: no DB, no env.
 *
 * Mobile sessions use OPAQUE random tokens (not signed JWTs) so every request
 * can be revoked immediately — the server looks the session row up by the
 * token's hash on each call. Only SHA-256 hashes are ever stored, so a leaked
 * database row cannot be replayed as a token.
 */

/** Short-lived bearer for API calls. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** Long-lived, single-use (rotated on every refresh). */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

const MAX_TOKEN_LENGTH = 256;

/** 32 random bytes → 43-char base64url. */
export function mintOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * A fingerprint of the credential a session was minted under. The session row
 * keeps it; every request recomputes it from the CURRENT password hash, so an
 * operator reset (or the admin changing their own password) signs out every
 * phone that logged in with the old one. Never reveals the hash itself.
 */
export function credentialStamp(passwordHash: string): string {
  return createHash("sha256")
    .update(`pepweb-mobile:${passwordHash}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}

/** Extract the token from an `Authorization: Bearer <token>` header. */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^bearer (\S+)$/i.exec(header.trim());
  return m && m[1].length <= MAX_TOKEN_LENGTH ? m[1] : null;
}
