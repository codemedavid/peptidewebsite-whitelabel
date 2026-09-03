// The one-time code that links a Telegram chat to a tenant.
//
// The owner generates a code in the store admin and sends "/start <code>" to
// their bot. That handshake — not a form field — is what creates a recipient
// row, because a chat id typed into a text box proves nothing about who owns the
// chat. The code is short-lived, single-use, and stored HASHED: the pairing
// table is a credential table, and a leaked DB row must not be redeemable.

import { createHash, randomInt } from "node:crypto";

/** Code length. Long enough not to be guessable inside the TTL, short enough to
 *  retype on a phone. */
export const PAIRING_CODE_LENGTH = 8;

/** How long a code stays redeemable. A pairing code is a key, not a password —
 *  it should expire before the owner has finished closing the tab. */
export const PAIRING_TTL_MS = 10 * 60_000;

/** Unambiguous alphabet: no 0/O and no 1/I, because these get read aloud and
 *  retyped from a screen into a phone. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A fresh pairing code, drawn from a CSPRNG (randomInt, not Math.random —
 *  this is a credential). */
export function generatePairingCode(): string {
  let out = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

/**
 * Coerce whatever the user typed (or Telegram delivered) into the canonical
 * code shape: uppercase, alphanumeric only. Phone keyboards add spaces and
 * autocorrect adds punctuation, so junk is DROPPED rather than rejected — the
 * lookup then either finds a row or doesn't.
 */
export function normalizePairingCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, PAIRING_CODE_LENGTH);
}

/**
 * The stored form of a code. SHA-256 is right here (rather than scrypt, which
 * this codebase uses for passwords): the input is high-entropy and machine-
 * generated, and it is valid for ten minutes — there is no dictionary to resist.
 * Normalizes first so a lowercase retype can never lock a user out.
 */
export function hashPairingCode(code: unknown): string {
  return createHash("sha256").update(normalizePairingCode(code)).digest("hex");
}

/** A pairing row as this module needs to see it. */
export interface PairingRow {
  expiresAt: Date;
  usedAt: Date | null;
}

/**
 * Whether a looked-up pairing row may still be redeemed: it exists, it has not
 * expired, and it has not already been spent. Single-use is what stops a code
 * screenshotted into a group chat from linking a second, unwanted chat.
 */
export function pairingUsable(row: PairingRow | null | undefined, nowMs: number): boolean {
  if (!row) return false;
  if (row.usedAt) return false;
  return row.expiresAt.getTime() > nowMs;
}
