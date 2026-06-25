import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Pure scrypt password/code hashing — no "server-only", no cookies — so it can be
 * unit-tested and shared. Format `scrypt$<salt-hex>$<hash-hex>`, identical to the
 * tenant-admin password hash, so the visitor access code is hashed exactly like
 * the admin password. Used by the access-code gate (actions/storefront-gate.ts).
 */

const SCRYPT_KEYLEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain.normalize("NFKC"), salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  let actual: Buffer;
  try {
    actual = scryptSync(plain.normalize("NFKC"), salt, expected.length);
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
