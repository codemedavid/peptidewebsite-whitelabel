// Opaque access token for the public "pay first, details later" sign-up.
//
// The wizard keeps the RAW token in its localStorage draft; the database keeps
// only its sha256 (OnboardingSubmission.accessTokenHash), so a leaked DB row
// can't be replayed to edit a submission. 32 random bytes → base64url.
//
// Server-side only (node:crypto) — the client never mints or hashes tokens.

import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

/** A fresh, unguessable token to hand back to the wizard. */
export function newAccessToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** The only form of the token that is ever stored or queried. */
export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Cheap shape check before touching the DB (base64url, sane length). */
export function isPlausibleAccessToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(token);
}
