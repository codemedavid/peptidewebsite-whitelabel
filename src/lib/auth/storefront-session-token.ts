import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Pure, injectable HMAC codec for the `sf_admin_session` cookie — no
 * "server-only", no cookies, no env reads — so it can be unit-tested and shared
 * (mirroring lib/auth/password-hash.ts). The server wrapper
 * (lib/auth/storefront-admin.ts) supplies the secret + clock + cookie I/O.
 *
 * The token is `${payload}.${signature}` where the signature is the base64url
 * HMAC-SHA256 of the payload. The payload now carries a SUBJECT so the server
 * knows WHO is signed in:
 *
 *   new    : `${tenantId}.${subject}.${expiresAt}`   subject = "owner" | "staff:<id>"
 *   legacy : `${tenantId}.${expiresAt}`              (owner, pre-staff cookies)
 *
 * Both decode; the legacy 2-part form maps to an owner subject so cookies already
 * live in browsers keep working. tenantId (cuid) and staff id (cuid) contain no
 * dots, so splitting the payload on "." is unambiguous.
 */

export type SessionSubject = { kind: "owner" } | { kind: "staff"; id: string };

const SUBJECT_OWNER = "owner";
const STAFF_PREFIX = "staff:";

function sign(secret: string, payload: string): string {
  return createHmac("sha256", Buffer.from(secret, "utf8")).update(payload).digest("base64url");
}

function encodeSubject(subject: SessionSubject): string {
  return subject.kind === "owner" ? SUBJECT_OWNER : `${STAFF_PREFIX}${subject.id}`;
}

function decodeSubject(raw: string): SessionSubject | null {
  if (raw === SUBJECT_OWNER) return { kind: "owner" };
  if (raw.startsWith(STAFF_PREFIX)) {
    const id = raw.slice(STAFF_PREFIX.length);
    if (id) return { kind: "staff", id };
  }
  return null;
}

export function encodeSessionToken(
  secret: string,
  tenantId: string,
  subject: SessionSubject,
  ttlSeconds: number,
  nowMs: number,
): string {
  const expiresAt = Math.floor(nowMs / 1000) + ttlSeconds;
  const payload = `${tenantId}.${encodeSubject(subject)}.${expiresAt}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function decodeSessionToken(
  secret: string,
  token: string,
  nowMs: number = Date.now(),
): { tenantId: string; subject: SessionSubject } | null {
  if (!token) return null;
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return null;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  if (!payload || !sig) return null;

  // Verify the signature (timing-safe) before trusting any field in the payload.
  const expectedSig = sign(secret, payload);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  const parts = payload.split(".");
  let tenantId: string;
  let subjectRaw: string;
  let expiresAtStr: string;
  if (parts.length === 2) {
    // Legacy owner token — no subject segment.
    [tenantId, expiresAtStr] = parts;
    subjectRaw = SUBJECT_OWNER;
  } else if (parts.length === 3) {
    [tenantId, subjectRaw, expiresAtStr] = parts;
  } else {
    return null;
  }

  const expiresAt = Number(expiresAtStr);
  if (!tenantId || !Number.isFinite(expiresAt)) return null;
  if (expiresAt * 1000 < nowMs) return null;

  const subject = decodeSubject(subjectRaw);
  if (!subject) return null;
  return { tenantId, subject };
}
