import "server-only";

import { prisma } from "@/lib/db/prisma";
import type { SessionSubject } from "@/lib/auth/storefront-session-token";
import type { TokenPair } from "./contract";
import { checkAccess, checkRefresh } from "./session-rules";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  hashToken,
  mintOpaqueToken,
} from "./tokens";

/**
 * Persistence for Pepweb Admin mobile sessions (MobileSession rows). The rules
 * (expiry, revocation, replay) live in session-rules.ts; this file applies them.
 *
 * These rows are looked up by token hash BEFORE the tenant is known, so they are
 * read with the base client (like storefront_staff and auth_audit) and every
 * follow-up query filters by the row's own tenantId.
 */

const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Who a session belongs to: the store owner, a staff login, or (Pepweb app
 * community, docs/mobile-admin/COMMUNITY.md) a storefront customer account.
 */
export type MobileSubject = SessionSubject | { kind: "customer"; id: string };

export type LiveSession = {
  id: string;
  tenantId: string;
  subject: MobileSubject;
  credentialStamp: string;
};

export function isAdminSubject(subject: MobileSubject): subject is SessionSubject {
  return subject.kind !== "customer";
}

export function encodeSubject(subject: MobileSubject): string {
  if (subject.kind === "owner") return "owner";
  return subject.kind === "staff" ? `staff:${subject.id}` : `customer:${subject.id}`;
}

export function decodeSubject(raw: string): MobileSubject | null {
  if (raw === "owner") return { kind: "owner" };
  if (raw.startsWith("staff:") && raw.length > 6) return { kind: "staff", id: raw.slice(6) };
  if (raw.startsWith("customer:") && raw.length > 9) return { kind: "customer", id: raw.slice(9) };
  return null;
}

function freshTokens(now: number) {
  const accessToken = mintOpaqueToken();
  const refreshToken = mintOpaqueToken();
  const pair: TokenPair = {
    accessToken,
    accessExpiresAt: now + ACCESS_TOKEN_TTL_SECONDS * 1000,
    refreshToken,
    refreshExpiresAt: now + REFRESH_TOKEN_TTL_SECONDS * 1000,
  };
  return { pair, accessHash: hashToken(accessToken), refreshHash: hashToken(refreshToken) };
}

export async function issueSession(args: {
  tenantId: string;
  subject: MobileSubject;
  credentialStamp: string;
  deviceLabel: string | null;
}): Promise<{ sessionId: string; tokens: TokenPair }> {
  const { pair, accessHash, refreshHash } = freshTokens(Date.now());
  const row = await prisma.mobileSession.create({
    data: {
      tenantId: args.tenantId,
      subject: encodeSubject(args.subject),
      credentialStamp: args.credentialStamp,
      accessTokenHash: accessHash,
      accessExpiresAt: new Date(pair.accessExpiresAt),
      refreshTokenHash: refreshHash,
      refreshExpiresAt: new Date(pair.refreshExpiresAt),
      deviceLabel: args.deviceLabel,
    },
    select: { id: true },
  });
  return { sessionId: row.id, tokens: pair };
}

export type AccessResult =
  | { ok: true; session: LiveSession }
  | { ok: false; reason: "expired" | "invalid" | "revoked" };

/** Resolve a bearer access token to its live session (no tenant checks here). */
export async function readAccessSession(accessToken: string): Promise<AccessResult> {
  const row = await prisma.mobileSession.findUnique({
    where: { accessTokenHash: hashToken(accessToken) },
  });
  if (!row) return { ok: false, reason: "invalid" };
  const now = new Date();
  const check = checkAccess(row, accessToken, now);
  if (!check.ok) return { ok: false, reason: check.reason === "replay" ? "invalid" : check.reason };
  const subject = decodeSubject(row.subject);
  if (!subject) return { ok: false, reason: "invalid" };

  if (now.getTime() - row.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS) {
    // Best-effort activity stamp; never fails OR delays the request (not
    // awaited — it would add a whole database round trip to the call).
    void prisma.mobileSession
      .update({ where: { id: row.id }, data: { lastUsedAt: now } })
      .catch(() => undefined);
  }
  return {
    ok: true,
    session: { id: row.id, tenantId: row.tenantId, subject, credentialStamp: row.credentialStamp },
  };
}

/**
 * The store a refresh token belongs to, WITHOUT rotating it — so the caller
 * can refuse (store suspended) before the single-use token is spent.
 */
export async function peekRefreshTenant(refreshToken: string): Promise<string | null> {
  const row = await prisma.mobileSession.findFirst({
    where: { refreshTokenHash: hashToken(refreshToken), revokedAt: null },
    select: { tenantId: true },
  });
  return row?.tenantId ?? null;
}

export type RotateResult =
  | { ok: true; session: LiveSession; tokens: TokenPair }
  | { ok: false; reason: "expired" | "invalid" | "revoked" | "replay" };

/**
 * Exchange a refresh token for a new pair. Single-use: the presented token
 * becomes `previousRefreshTokenHash`; presenting it again revokes the session.
 * The swap is a conditional update, so two racing refreshes cannot both win.
 */
export async function rotateSession(refreshToken: string): Promise<RotateResult> {
  const hash = hashToken(refreshToken);
  const row = await prisma.mobileSession.findFirst({
    where: { OR: [{ refreshTokenHash: hash }, { previousRefreshTokenHash: hash }] },
  });
  if (!row) return { ok: false, reason: "invalid" };

  const now = new Date();
  const check = checkRefresh(row, refreshToken, now);
  if (!check.ok) {
    if (check.reason === "replay") await revokeSession(row.id);
    return { ok: false, reason: check.reason };
  }
  const subject = decodeSubject(row.subject);
  if (!subject) return { ok: false, reason: "invalid" };

  const { pair, accessHash, refreshHash } = freshTokens(now.getTime());
  const swapped = await prisma.mobileSession.updateMany({
    where: { id: row.id, refreshTokenHash: hash, revokedAt: null },
    data: {
      accessTokenHash: accessHash,
      accessExpiresAt: new Date(pair.accessExpiresAt),
      refreshTokenHash: refreshHash,
      previousRefreshTokenHash: hash,
      refreshExpiresAt: new Date(pair.refreshExpiresAt),
      lastUsedAt: now,
    },
  });
  if (swapped.count !== 1) return { ok: false, reason: "invalid" };
  return {
    ok: true,
    tokens: pair,
    session: { id: row.id, tenantId: row.tenantId, subject, credentialStamp: row.credentialStamp },
  };
}

/**
 * The session a logout request refers to. Expiry is deliberately ignored: a
 * phone must always be able to sign itself out (and stop its notifications),
 * even with a stale access token.
 */
export async function findSessionForLogout(
  accessToken: string | null,
  refreshToken: string | null,
): Promise<string | null> {
  const or = [
    ...(accessToken ? [{ accessTokenHash: hashToken(accessToken) }] : []),
    ...(refreshToken ? [{ refreshTokenHash: hashToken(refreshToken) }] : []),
  ];
  if (or.length === 0) return null;
  const row = await prisma.mobileSession.findFirst({ where: { OR: or }, select: { id: true } });
  return row?.id ?? null;
}

/**
 * Sign a phone out: revoke the session and drop its push registration in the
 * same transaction, so a revoked session can never receive another alert.
 */
export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.$transaction([
    prisma.mobilePushDevice.deleteMany({ where: { sessionId } }),
    prisma.mobileSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}
