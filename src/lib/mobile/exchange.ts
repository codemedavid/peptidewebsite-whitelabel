import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { withTenant } from "@/lib/db/tenant-client";
import { normalizeLoginEmail } from "@/lib/auth/login-email";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { rateLimit } from "@/lib/security/rate-limit";
import { normalizeHost } from "@/lib/tenant/cache-tags";
import { ACCOUNT_BANNED_MESSAGE, type ApiErrorCode, type LoginResponse } from "./contract";
import { storeAvailability } from "./auth";
import { openSession } from "./login";
import { isEmailTaken } from "./register";
import { normalizeStoreIdentifier } from "./store-identifier";
import { findStoreByHost, MOBILE_ROOT } from "./store-lookup";

/**
 * POST /auth/exchange — a partner app (Mamamica Glow) trades its own Supabase
 * session for this store's normal token pair, so one login covers both.
 *
 * The store opts in with branding.config.supabaseExchange = { url, anonKey }:
 * the Supabase project whose users it trusts. The token is checked by asking
 * that project (GET /auth/v1/user), so no signing secret is stored here, and
 * only https://<ref>.supabase.co is ever called.
 *
 * The customer row is bound to the Supabase user: its passwordHash is the
 * marker external:supabase:<ref>:<userId> — never a valid scrypt hash, so it
 * can't password-sign-in, and a later exchange only reuses a row carrying the
 * same marker. An email already held by a password customer, the owner or
 * staff is refused (409), never taken over, even if the partner project
 * auto-confirms emails.
 */

const ONE_HOUR = 60 * 60 * 1000;
const MAX_EXCHANGES_PER_HOUR = 30;
const SUPABASE_TIMEOUT_MS = 8_000;
const SUPABASE_URL = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/;
const MAX_TOKEN_LENGTH = 8_192;
const EMAIL_TAKEN = "This email already has an account on this store. Sign in with your password instead.";

type Failure = { ok: false; code: ApiErrorCode; message: string };
type Success = { ok: true; data: LoginResponse };

const failure = (code: ApiErrorCode, message: string): Failure => ({ ok: false, code, message });

interface ExchangeConfig {
  url: string;
  anonKey: string;
  projectRef: string;
}

interface SupabaseUser {
  id: string;
  email: string | null;
  emailConfirmed: boolean;
  isAnonymous: boolean;
  displayName: string | null;
}

/** The store's trusted Supabase project, or null when unset / not a supabase.co project. */
export function readExchangeConfig(config: unknown): ExchangeConfig | null {
  const raw = (config as { supabaseExchange?: unknown } | null)?.supabaseExchange as
    | { url?: unknown; anonKey?: unknown }
    | undefined;
  if (!raw || typeof raw.url !== "string" || typeof raw.anonKey !== "string" || !raw.anonKey) return null;
  const url = raw.url.trim().replace(/\/+$/, "");
  const match = SUPABASE_URL.exec(url);
  return match ? { url, anonKey: raw.anonKey, projectRef: match[1] } : null;
}

export const supabaseMarker = (projectRef: string, userId: string) => `external:supabase:${projectRef}:${userId}`;
const MARKER = /^external:supabase:([a-z0-9]{20}):(.+)$/;

/** Was this customer made by /auth/exchange (no password, bound to a Supabase user)? */
export const isSupabaseMarker = (passwordHash: string | null): passwordHash is string =>
  !!passwordHash && MARKER.test(passwordHash);

/**
 * Re-authentication for exchange-made customers (they have no password): does
 * this fresh Supabase token belong to the exact Supabase user the account is
 * bound to, in the project the store still trusts?
 */
export async function supabaseTokenOwnsAccount(tenantId: string, passwordHash: string, token: string): Promise<boolean> {
  const match = MARKER.exec(passwordHash);
  if (!match || !token || token.length > MAX_TOKEN_LENGTH) return false;
  const branding = await prisma.branding.findUnique({ where: { tenantId }, select: { config: true } });
  const cfg = readExchangeConfig(branding?.config);
  if (!cfg || cfg.projectRef !== match[1]) return false;
  const user = await fetchSupabaseUser(cfg, token);
  return !!user && !user.isAnonymous && user.id === match[2];
}

/** Asks the project who owns this access token; null for any rejection or failure. */
async function fetchSupabaseUser(cfg: ExchangeConfig, accessToken: string): Promise<SupabaseUser | null> {
  // Tests point this at a local fake; production always calls the validated project URL.
  const base = process.env.NODE_ENV !== "production" && process.env.MOBILE_SUPABASE_URL_OVERRIDE
    ? process.env.MOBILE_SUPABASE_URL_OVERRIDE
    : cfg.url;
  try {
    const res = await fetch(`${base}/auth/v1/user`, {
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const u = (await res.json()) as Record<string, unknown>;
    if (typeof u.id !== "string" || !u.id) return null;
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    const name = [meta.display_name, meta.full_name, meta.name].find((v) => typeof v === "string" && v.trim());
    return {
      id: u.id,
      email: typeof u.email === "string" && u.email.trim() ? normalizeLoginEmail(u.email) : null,
      emailConfirmed: typeof u.email_confirmed_at === "string" && u.email_confirmed_at.length > 0,
      isAnonymous: u.is_anonymous === true,
      displayName: typeof name === "string" ? name.trim().slice(0, 80) : null,
    };
  } catch {
    return null;
  }
}

/** The customer bound to this Supabase user: reused, created, or refused when the email is someone else's. */
async function bindCustomer(
  tenantId: string,
  user: SupabaseUser & { email: string },
  marker: string,
): Promise<{ ok: true; id: string } | Failure> {
  const existing = await prisma.storefrontCustomer.findFirst({
    where: { tenantId, email: { equals: user.email, mode: "insensitive" } },
    select: { id: true, passwordHash: true },
  });
  if (existing) return existing.passwordHash === marker ? { ok: true, id: existing.id } : failure("conflict", EMAIL_TAKEN);
  if (await isEmailTaken(tenantId, user.email)) return failure("conflict", EMAIL_TAKEN);

  try {
    const row = await withTenant(tenantId, (db) =>
      db.storefrontCustomer.create({
        data: {
          tenantId,
          email: user.email,
          name: user.displayName || user.email.split("@")[0],
          passwordHash: marker,
          lastLoginAt: new Date(),
        },
        select: { id: true },
      }),
    );
    return { ok: true, id: row.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return failure("conflict", EMAIL_TAKEN);
    throw e;
  }
}

/**
 * A banned member (community safety bot) or a disabled account never gets a
 * session. The ban wording is a contract constant so the app can recognise it
 * and sign the member out of Mamamica as well.
 */
async function accountRefusal(tenantId: string, customerId: string): Promise<Failure | null> {
  const row = await prisma.storefrontCustomer.findFirst({
    where: { id: customerId, tenantId },
    select: { status: true, communityMember: { select: { bannedAt: true } } },
  });
  if (row?.communityMember?.bannedAt) return failure("forbidden", ACCOUNT_BANNED_MESSAGE);
  return row?.status === "active" ? null : failure("forbidden", "This account is disabled. Contact the store for help.");
}

export async function mobileExchange(
  body: Record<string, unknown>,
  ip: string,
  deviceLabel: string | null,
): Promise<Success | Failure> {
  const host = normalizeStoreIdentifier(body.store, MOBILE_ROOT);
  const token = typeof body.supabaseAccessToken === "string" ? body.supabaseAccessToken.trim() : "";
  if (!host || !token || token.length > MAX_TOKEN_LENGTH) {
    return failure("invalid_input", "Sign in to the app again, then retry.");
  }

  const limit = rateLimit(`mobile:exchange:${ip}`, MAX_EXCHANGES_PER_HOUR, ONE_HOUR);
  if (!limit.ok) return failure("rate_limited", `Too many sign-ins from this device. Try again in ${Math.ceil(limit.retryAfter / 60)} min.`);

  const store = await findStoreByHost(normalizeHost(host));
  if (!store || store.status === "pending_setup") return failure("not_found", "We couldn't find that store.");
  const unavailable = await storeAvailability(store);
  if (unavailable) return { ok: false, ...unavailable };
  if (!(await hasFeature(store.id, FEATURES.MOBILE_COMMUNITY))) {
    return failure("forbidden", "This store isn't open in the app yet.");
  }
  const branding = await prisma.branding.findUnique({ where: { tenantId: store.id }, select: { config: true } });
  const cfg = readExchangeConfig(branding?.config);
  if (!cfg) return failure("forbidden", "This store doesn't accept sign-in from another app.");

  const user = await fetchSupabaseUser(cfg, token);
  if (!user) return failure("unauthenticated", "Your session has expired. Sign in again.");
  if (user.isAnonymous || !user.email) return failure("forbidden", "Create an account to join the community and shop.");
  if (!user.emailConfirmed) return failure("forbidden", "Confirm your email first, then try again.");

  const bound = await bindCustomer(store.id, { ...user, email: user.email }, supabaseMarker(cfg.projectRef, user.id));
  if (!bound.ok) return bound;
  const refusal = await accountRefusal(store.id, bound.id);
  if (refusal) return refusal;

  const session = await openSession(store, { kind: "customer", id: bound.id }, ip, deviceLabel);
  if (!session.ok) return session;
  return { ok: true, data: session.data as LoginResponse };
}
