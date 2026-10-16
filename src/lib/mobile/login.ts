import "server-only";

import { prisma } from "@/lib/db/prisma";
import { recordAuthAudit } from "@/lib/auth/audit";
import { resolveStoreAdminLogin } from "@/lib/auth/store-admin-login";
import { normalizeLoginEmail } from "@/lib/auth/login-email";
import { hashPassword, verifyPassword } from "@/lib/auth/password-hash";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { rateLimit } from "@/lib/security/rate-limit";
import { getTenantContext } from "@/lib/tenant/context";
import { normalizeHost } from "@/lib/tenant/cache-tags";
import type { ApiErrorCode, LoginChoiceResponse, LoginResponse, StoreChoice } from "./contract";
import { resolveSubject, storeAvailability, type Principal } from "./auth";
import { buildMe } from "./branding";
import { issueSession, type MobileSubject } from "./sessions";
import { normalizeStoreIdentifier } from "./store-identifier";
import { findStoreByHost, MOBILE_ROOT, type StoreRow } from "./store-lookup";

/**
 * POST /auth/login — the website's store-admin login, reached from the app.
 *
 * Same credentials, same decision core (resolveStoreAdminLogin), same rules as
 * signInStoreAdminAction: one generic failure message (never revealing which
 * store has no credential or which half was wrong), a distinct message only for
 * a suspended staff account, staff require STORE_STAFF_ACCOUNTS, rate limits,
 * and an AuthAudit row either way.
 *
 * The admin signs in with just email + password. Emails aren't unique across
 * stores, so the server checks the password against every store where that
 * email is an owner or staff login:
 *   - one store accepts it → signed in;
 *   - several accept it (same email AND password on several stores) → the
 *     app gets the list of those stores and re-sends with `store` set.
 * The list only ever comes back after a correct password. `store` is still
 * accepted directly (older app builds send it).
 *
 * Customers (docs/mobile-admin/COMMUNITY.md) use the same screen: for each
 * store, the owner/staff credentials are tried first, then that store's
 * storefront customer account — only when the store holds MOBILE_COMMUNITY and
 * the account is active. Admin wins a tie on the same store.
 */

const FIFTEEN_MIN = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const MAX_ACCOUNT_ATTEMPTS = 20;
/** A valid scrypt hash of a random throwaway value — only ever used to spend time. */
const TIMING_DUMMY_HASH = hashPassword(`timing-${Math.random()}`);
const INVALID_LOGIN = "Incorrect email or password.";
const STORE_NOT_FOUND = "We couldn't find a store at that address. Check it and try again.";

const MAX_CANDIDATE_STORES = 10;

type Failure = { ok: false; code: ApiErrorCode; message: string };
type Success = { ok: true; data: LoginResponse | LoginChoiceResponse };
type Store = StoreRow;

const ROOT = MOBILE_ROOT;
const findStore = findStoreByHost;

async function readCredentials(tenantId: string) {
  const [tenant, staff] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { storeAdminEmail: true, storeAdminPasswordHash: true },
    }),
    prisma.storefrontStaff
      .findMany({ where: { tenantId }, select: { id: true, email: true, passwordHash: true, status: true } })
      .catch(() => []),
  ]);
  const owner =
    tenant?.storeAdminEmail && tenant.storeAdminPasswordHash
      ? { email: tenant.storeAdminEmail, passwordHash: tenant.storeAdminPasswordHash }
      : null;
  return { owner, staff };
}

type Audience = "admin" | "customer";

function audit(tenantId: string, ok: boolean, ip: string, audience: Audience = "admin") {
  if (audience === "customer") {
    // AUTH_AUDIT_EVENTS (lib/auth/audit.ts) has no customer events, so these
    // rows are written directly — just as fail-safe as recordAuthAudit.
    return prisma.authAudit
      .create({ data: { tenantId, event: ok ? "customer_app_login" : "customer_app_login_failed", ip } })
      .then(() => undefined, () => undefined);
  }
  return recordAuthAudit((row) => prisma.authAudit.create({ data: row }), {
    tenantId,
    event: ok ? "admin_login" : "admin_login_failed",
    ip,
  });
}

type Attempt =
  | { kind: "ok"; subject: MobileSubject }
  | { kind: "suspended"; audience: Audience }
  | { kind: "invalid"; audience: Audience };

/** Spend one scrypt on a throwaway hash — keeps every attempt the same cost. */
function spendDummyHash(password: string): void {
  verifyPassword(password, TIMING_DUMMY_HASH);
}

/**
 * The store's customer account for this email + password, when the store runs
 * the app community. Always spends exactly ONE scrypt — feature on or off,
 * account or not — so timing reveals neither which customers exist nor which
 * stores run the community.
 */
async function attemptCustomer(
  store: Store,
  email: string,
  password: string,
): Promise<{ known: boolean; id: string | null }> {
  if (!(await hasFeature(store.id, FEATURES.MOBILE_COMMUNITY))) {
    spendDummyHash(password);
    return { known: false, id: null };
  }
  const row = await prisma.storefrontCustomer
    .findFirst({
      where: { tenantId: store.id, email: { equals: normalizeLoginEmail(email), mode: "insensitive" } },
      select: { id: true, passwordHash: true, status: true },
    })
    .catch(() => null);
  if (!row) {
    spendDummyHash(password);
    return { known: false, id: null };
  }
  const good = verifyPassword(password, row.passwordHash);
  // A disabled account gets the same generic answer as a wrong password.
  return { known: true, id: good && row.status === "active" ? row.id : null };
}

/**
 * Owner/staff first, then the store's customer account. Constant cost: exactly
 * two scrypts per store, whichever branch answers (admin hit, customer hit,
 * wrong password, unknown email, suspended staff, feature off).
 */
async function attemptStore(store: Store, email: string, password: string): Promise<Attempt> {
  const admin = await attemptAdmin(store, email, password);
  if (admin.kind === "ok") {
    spendDummyHash(password); // the customer check this success skipped
    return admin;
  }
  const customer = await attemptCustomer(store, email, password);
  if (customer.id) return { kind: "ok", subject: { kind: "customer", id: customer.id } };
  const audience: Audience = admin.known || !customer.known ? "admin" : "customer";
  return admin.kind === "suspended" ? { kind: "suspended", audience } : { kind: "invalid", audience };
}

type AdminAttempt =
  | { kind: "ok"; subject: MobileSubject }
  | { kind: "suspended"; known: true }
  | { kind: "invalid"; known: boolean };

/** Check one store's owner + staff credentials; spends one scrypt either way. */
async function attemptAdmin(store: Store, email: string, password: string): Promise<AdminAttempt> {
  const { owner, staff } = await readCredentials(store.id);
  // Equalise timing: an address that matches no account still pays one scrypt,
  // so response time can't reveal which emails exist at this store.
  const e = normalizeLoginEmail(email);
  const known =
    (owner && normalizeLoginEmail(owner.email) === e) || staff.some((s) => normalizeLoginEmail(s.email) === e);
  if (!known) verifyPassword(password, TIMING_DUMMY_HASH);
  const result = resolveStoreAdminLogin(email, password, owner, staff);

  if (result.kind === "suspended") {
    spendDummyHash(password); // resolveStoreAdminLogin answers before hashing
    return { kind: "suspended", known: true };
  }
  if (result.kind === "invalid" || result.kind === "unconfigured") return { kind: "invalid", known: !!known };
  if (result.kind === "staff" && !(await hasFeature(store.id, FEATURES.STORE_STAFF_ACCOUNTS))) {
    return { kind: "invalid", known: true };
  }
  return { kind: "ok", subject: result.kind === "owner" ? { kind: "owner" } : { kind: "staff", id: result.id } };
}

/** Issue the app session for a subject that has just proven who they are. */
export async function openSession(
  store: Store,
  subject: MobileSubject,
  ip: string,
  deviceLabel: string | null,
): Promise<Success | Failure> {
  // Independent reads/writes run side by side: each database trip costs ~1s
  // from far regions, and a sign-in strung out serially outran the app's timeout.
  const [resolved, tenant] = await Promise.all([resolveSubject(store.id, subject), getTenantContext(store.id)]);
  if (!resolved) return { ok: false, code: "unauthenticated", message: INVALID_LOGIN };

  const [{ sessionId, tokens }] = await Promise.all([
    issueSession({
      tenantId: store.id,
      subject,
      credentialStamp: resolved.stamp,
      deviceLabel,
    }),
    audit(store.id, true, ip, resolved.kind),
  ]);

  const base = {
    session: { id: sessionId, tenantId: store.id, subject, credentialStamp: resolved.stamp },
    tenantId: store.id,
    slug: store.slug,
    tenant,
  };
  let principal: Principal;
  if (resolved.kind === "admin") {
    principal = { kind: "admin", ctx: { ...base, actor: resolved.actor, actorInfo: resolved.info } };
  } else {
    // buildMe → buildCommunityMe joins the community (or applies) on first sign-in.
    principal = { kind: "customer", ctx: { ...base, customer: resolved.customer, actorInfo: resolved.info } };
  }
  return { ok: true, data: { ...tokens, me: await buildMe(principal) } };
}

const SUSPENDED_STAFF: Failure = {
  ok: false,
  code: "forbidden",
  message: "This staff account is suspended. Contact the store owner.",
};
const INVALID: Failure = { ok: false, code: "unauthenticated", message: INVALID_LOGIN };

/** The admin named the store (a picked store, or an older app build). */
async function signInToStore(
  host: string,
  email: string,
  password: string,
  ip: string,
  deviceLabel: string | null,
): Promise<Success | Failure> {
  const store = await findStore(normalizeHost(host));
  if (!store || store.status === "pending_setup") {
    return { ok: false, code: "not_found", message: STORE_NOT_FOUND };
  }
  const unavailable = await storeAvailability(store);
  if (unavailable) return { ok: false, ...unavailable };

  const attempt = await attemptStore(store, email, password);
  if (attempt.kind !== "ok") {
    await audit(store.id, false, ip, attempt.audience);
    return attempt.kind === "suspended" ? SUSPENDED_STAFF : INVALID;
  }
  return openSession(store, attempt.subject, ip, deviceLabel);
}

/** Every live store where this email is the owner's, a staff or a customer login. */
async function storesForEmail(email: string): Promise<Store[]> {
  const e = normalizeLoginEmail(email);
  const select = { id: true, slug: true, status: true } as const;
  const [owners, staff, customers] = await Promise.all([
    prisma.tenant.findMany({
      where: { storeAdminEmail: { equals: e, mode: "insensitive" } },
      select,
      take: MAX_CANDIDATE_STORES,
    }),
    prisma.storefrontStaff
      .findMany({
        where: { email: { equals: e, mode: "insensitive" } },
        select: { tenant: { select } },
        take: MAX_CANDIDATE_STORES,
      })
      .catch(() => [] as Array<{ tenant: Store }>),
    prisma.storefrontCustomer
      .findMany({
        where: { email: { equals: e, mode: "insensitive" } },
        select: { tenant: { select } },
        take: MAX_CANDIDATE_STORES,
      })
      .catch(() => [] as Array<{ tenant: Store }>),
  ]);
  const byId = new Map<string, Store>();
  for (const t of [...owners, ...staff.map((s) => s.tenant), ...customers.map((c) => c.tenant)]) {
    if (t.status !== "pending_setup") byId.set(t.id, t);
  }
  return [...byId.values()].slice(0, MAX_CANDIDATE_STORES);
}

async function storeChoices(stores: Store[]): Promise<StoreChoice[]> {
  const rows = await prisma.tenant.findMany({
    where: { id: { in: stores.map((s) => s.id) } },
    select: { slug: true, name: true, branding: { select: { logoUrl: true, config: true } } },
  });
  return rows
    .map((r) => {
      const config = (r.branding?.config ?? {}) as Record<string, unknown>;
      const name = typeof config.name === "string" && config.name.trim() ? config.name.trim() : r.name;
      const logo = typeof config.logoUrl === "string" && config.logoUrl.trim() ? config.logoUrl.trim() : null;
      return { slug: r.slug, name, logoUrl: logo ?? r.branding?.logoUrl ?? null, address: `${r.slug}.${ROOT}` };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Email + password only: find the store(s) this login opens. */
async function signInByEmail(
  email: string,
  password: string,
  ip: string,
  deviceLabel: string | null,
): Promise<Success | Failure> {
  const stores = await storesForEmail(email);
  if (stores.length === 0) {
    // Same cost as one store's attempt (admin + customer check).
    spendDummyHash(password);
    spendDummyHash(password);
    return INVALID;
  }

  const accepted: Array<{ store: Store; subject: MobileSubject }> = [];
  const failures: Array<{ store: Store; audience: Audience }> = [];
  let suspended = false;
  // All candidate stores are checked at once (not one after another); each
  // attempt still spends its fixed two scrypts, so timing stays uniform.
  const attempts = await Promise.all(stores.map((store) => attemptStore(store, email, password)));
  for (const [i, attempt] of attempts.entries()) {
    const store = stores[i];
    if (attempt.kind === "ok") accepted.push({ store, subject: attempt.subject });
    else {
      failures.push({ store, audience: attempt.audience });
      if (attempt.kind === "suspended") suspended = true;
    }
  }

  if (accepted.length === 0) {
    await Promise.all(failures.map((f) => audit(f.store.id, false, ip, f.audience)));
    return suspended ? SUSPENDED_STAFF : INVALID;
  }

  // Only stores that can be managed right now are offered or opened.
  const open: typeof accepted = [];
  let firstBlock: Failure | null = null;
  const blocks = await Promise.all(accepted.map((a) => storeAvailability(a.store)));
  for (const [i, a] of accepted.entries()) {
    const blocked = blocks[i];
    if (!blocked) open.push(a);
    else firstBlock ??= { ok: false, ...blocked };
  }
  if (open.length === 0) return firstBlock ?? INVALID;
  if (open.length === 1) return openSession(open[0].store, open[0].subject, ip, deviceLabel);
  return { ok: true, data: { chooseStore: await storeChoices(open.map((a) => a.store)) } };
}

export async function mobileLogin(
  body: Record<string, unknown>,
  ip: string,
  deviceLabel: string | null,
): Promise<Success | Failure> {
  const email = typeof body.email === "string" ? body.email.slice(0, 320) : "";
  const password = typeof body.password === "string" ? body.password.slice(0, 200) : "";
  const hasStore = typeof body.store === "string" && body.store.trim() !== "";
  const host = hasStore ? normalizeStoreIdentifier(body.store, ROOT) : null;
  if (hasStore && !host) return { ok: false, code: "invalid_input", message: "That store address doesn't look right." };
  if (!email.trim() || !password.trim()) {
    return { ok: false, code: "invalid_input", message: "Enter your email and password." };
  }

  // Two buckets: per client (spray from one IP) and per account (one account
  // targeted from many IPs).
  const scopeKey = host ?? "any";
  const perClient = rateLimit(`mobile:signin:${scopeKey}:${ip}`, MAX_ATTEMPTS, FIFTEEN_MIN);
  const perAccount = rateLimit(
    `mobile:signin:${scopeKey}:${normalizeLoginEmail(email)}`,
    MAX_ACCOUNT_ATTEMPTS,
    ONE_HOUR,
  );
  if (!perClient.ok || !perAccount.ok) {
    return { ok: false, code: "rate_limited", message: "Too many attempts. Try again in a few minutes." };
  }

  return host
    ? signInToStore(host, email, password, ip, deviceLabel)
    : signInByEmail(email, password, ip, deviceLabel);
}
