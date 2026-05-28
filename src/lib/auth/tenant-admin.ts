import "server-only";
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";

/**
 * Password-only tenant admin auth. The platform owner sets a password per tenant
 * from Super Admin; tenants sign in at slug.<root>/admin by typing only that
 * password. No Supabase user, no email — the cookie carries the tenantId itself,
 * HMAC-signed so we can trust it on subsequent requests.
 */

const COOKIE_NAME = "tenant_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const SCRYPT_KEYLEN = 64;

function sessionSecret(): Buffer {
  // Reuse the same secret used to sign Supabase cookies in dev; otherwise require
  // an explicit secret. We don't generate a random per-process secret because that
  // would silently invalidate every signed cookie on restart.
  const raw =
    process.env.TENANT_ADMIN_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXTAUTH_SECRET;
  if (!raw) {
    throw new Error(
      "TENANT_ADMIN_SECRET is not set. Add it to .env (any long random string) to enable tenant admin login.",
    );
  }
  return Buffer.from(raw, "utf8");
}

/* ───────────────────── password hashing (scrypt) ───────────────────── */

export function hashAdminPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain.normalize("NFKC"), salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyAdminPassword(plain: string, stored: string): boolean {
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

/* ───────────────────── signed cookie (HMAC) ───────────────────── */

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function buildToken(tenantId: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${tenantId}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

function parseToken(token: string): { tenantId: string } | null {
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return null;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  const expectedSig = sign(payload);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;
  const [tenantId, expiresAtStr] = payload.split(".");
  const expiresAt = Number(expiresAtStr);
  if (!tenantId || !Number.isFinite(expiresAt)) return null;
  if (expiresAt * 1000 < Date.now()) return null;
  return { tenantId };
}

export async function setTenantAdminCookie(tenantId: string): Promise<void> {
  const jar = await cookies();
  jar.set({
    name: COOKIE_NAME,
    value: buildToken(tenantId),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearTenantAdminCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

/** Read the cookie and return the tenantId it was issued for, or null. */
export async function readTenantAdminCookie(): Promise<{ tenantId: string } | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return parseToken(token);
}
