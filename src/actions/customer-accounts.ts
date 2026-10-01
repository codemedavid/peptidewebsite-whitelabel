"use server";

// Storefront customer accounts — the shopper-facing half (sign up, sign in,
// My Account) and the store-admin half (the Customers list).
//
// Every action is gated on FEATURES.STORE_CUSTOMER_ACCOUNTS (operator-grantable,
// default OFF) and is unavailable in demo mode. Accounts are per tenant: the
// tenant always comes from the request host, never from input, and the session
// resolver refuses a cookie minted on another store.

import { Prisma } from "@prisma/client";
import { getTenantIdOrNull } from "@/lib/tenant/headers";
import { isDemoMode } from "@/lib/demo/fixtures";
import { withTenant } from "@/lib/db/tenant-client";
import { hashPassword, verifyPassword } from "@/lib/auth/password-hash";
import {
  saveCustomerSession,
  clearCustomerSession,
  getSignedInCustomer,
} from "@/lib/auth/customer-session";
import { requireStaffPermission } from "@/lib/auth/staff-guard";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import {
  parseCustomerSignUp,
  parseCustomerSignIn,
  parseCustomerProfile,
  parseCustomerPasswordChange,
} from "@/lib/storefront/customer-account";
import { ACTIVE_ORDERS_WHERE } from "@/lib/orders/trash";
import { dbOrderToStorefront, type DbOrderRow } from "@/lib/orders/db-mapping";
import { toTrackedOrder, type TrackedOrder } from "@/lib/orders/tracked-order";
import { computeOrderTotals } from "@/storefront/admin/order-detail";

const UNAVAILABLE = "Customer accounts aren't available on this store.";
const BAD_CREDENTIALS = "That email and password don't match an account on this store.";
const MINUTE = 60_000;

/** Verified against when no account matches, so a miss costs the same scrypt
 *  time as a hit — sign-in timing never reveals which emails have accounts. */
const DUMMY_HASH = hashPassword("customer-accounts-timing-equalizer");

export type CustomerAccount = { name: string; email: string; phone: string; memberSince: string };
export type AccountOrder = TrackedOrder & { paymentStatus: string; total: number };

type Fail = { error: string };
export type CustomerAccountResult = { ok: true; account: CustomerAccount } | Fail;

/** The request's tenant, when customer accounts are live for it; else null. */
async function accountsTenant(): Promise<string | null> {
  if (isDemoMode()) return null;
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return null;
  return (await hasFeature(tenantId, FEATURES.STORE_CUSTOMER_ACCOUNTS)) ? tenantId : null;
}

function toAccount(row: { name: string; email: string; phone: string; createdAt: Date }): CustomerAccount {
  return { name: row.name, email: row.email, phone: row.phone, memberSince: row.createdAt.toISOString() };
}

// ── Shopper: session ─────────────────────────────────────────────────────────

export async function signUpCustomerAction(input: unknown): Promise<CustomerAccountResult> {
  const tenantId = await accountsTenant();
  if (!tenantId) return { error: UNAVAILABLE };

  const limit = rateLimit(`customer-signup:${tenantId}:${await clientIp()}`, 5, 60 * MINUTE);
  if (!limit.ok) return { error: `Too many sign-ups from this device. Try again in ${Math.ceil(limit.retryAfter / 60)} min.` };

  const parsed = parseCustomerSignUp(input);
  if (!parsed.ok) return { error: parsed.error };
  const { name, email, phone, password } = parsed.value;

  try {
    const row = await withTenant(tenantId, (db) =>
      db.storefrontCustomer.create({
        data: { tenantId, name, email, phone, passwordHash: hashPassword(password), lastLoginAt: new Date() },
      }),
    );
    await saveCustomerSession(tenantId, row.id, row.sessionVersion);
    return { ok: true, account: toAccount(row) };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "An account with this email already exists. Sign in instead." };
    }
    console.error("[customer-accounts] sign-up failed", e);
    return { error: "Couldn't create your account. Please try again." };
  }
}

export async function signInCustomerAction(input: unknown): Promise<CustomerAccountResult> {
  const tenantId = await accountsTenant();
  if (!tenantId) return { error: UNAVAILABLE };

  const limit = rateLimit(`customer-signin:${tenantId}:${await clientIp()}`, 10, 15 * MINUTE);
  if (!limit.ok) return { error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfter / 60)} min.` };

  const parsed = parseCustomerSignIn(input);
  if (!parsed.ok) return { error: parsed.error };
  const { email, password } = parsed.value;

  try {
    const row = await withTenant(tenantId, (db) => db.storefrontCustomer.findFirst({ where: { email } }));
    const passwordOk = verifyPassword(password, row?.passwordHash ?? DUMMY_HASH);
    if (!row || !passwordOk) return { error: BAD_CREDENTIALS };
    // Only after a correct password, so this never confirms an account to a guesser.
    if (row.status !== "active") return { error: "This account has been disabled. Please contact the store." };

    await withTenant(tenantId, (db) =>
      db.storefrontCustomer.update({ where: { id: row.id }, data: { lastLoginAt: new Date() } }),
    );
    await saveCustomerSession(tenantId, row.id, row.sessionVersion);
    return { ok: true, account: toAccount(row) };
  } catch (e) {
    console.error("[customer-accounts] sign-in failed", e);
    return { error: "Couldn't sign you in. Please try again." };
  }
}

export async function signOutCustomerAction(): Promise<{ ok: true }> {
  await clearCustomerSession();
  return { ok: true };
}

/** The signed-in shopper on this store, or null (signed out / feature off). */
export async function getCustomerAccountAction(): Promise<CustomerAccount | null> {
  const tenantId = await accountsTenant();
  if (!tenantId) return null;
  const me = await getSignedInCustomer(tenantId);
  return me ? toAccount(me) : null;
}

// ── Shopper: My Account ──────────────────────────────────────────────────────

/** The signed-in shopper's own orders, newest first. Trashed orders are hidden
 *  exactly as they are on the Track page. */
export async function listMyOrdersAction(): Promise<{ ok: true; orders: AccountOrder[] } | Fail> {
  const tenantId = await accountsTenant();
  if (!tenantId) return { error: UNAVAILABLE };
  const me = await getSignedInCustomer(tenantId);
  if (!me) return { error: "Please sign in." };

  try {
    const rows = await withTenant(tenantId, (db) =>
      db.storefrontOrder.findMany({
        where: { ...ACTIVE_ORDERS_WHERE, customerAccountId: me.id },
        orderBy: { placedAt: "desc" },
        take: 100,
      }),
    );
    const orders = rows.map((r) => {
      const o = dbOrderToStorefront(r as DbOrderRow);
      return { ...toTrackedOrder(o), paymentStatus: o.paymentStatus, total: computeOrderTotals(o).total };
    });
    return { ok: true, orders };
  } catch (e) {
    console.error("[customer-accounts] list orders failed", e);
    return { error: "Couldn't load your orders. Please try again." };
  }
}

export async function updateCustomerProfileAction(input: unknown): Promise<CustomerAccountResult> {
  const tenantId = await accountsTenant();
  if (!tenantId) return { error: UNAVAILABLE };
  const me = await getSignedInCustomer(tenantId);
  if (!me) return { error: "Please sign in." };

  const parsed = parseCustomerProfile(input);
  if (!parsed.ok) return { error: parsed.error };

  try {
    const row = await withTenant(tenantId, (db) =>
      db.storefrontCustomer.update({ where: { id: me.id }, data: parsed.value }),
    );
    return { ok: true, account: toAccount(row) };
  } catch (e) {
    console.error("[customer-accounts] profile update failed", e);
    return { error: "Couldn't save your details. Please try again." };
  }
}

/** Changing the password bumps sessionVersion, signing out every OTHER device;
 *  this one gets a fresh cookie at the new version. */
export async function changeCustomerPasswordAction(input: unknown): Promise<{ ok: true } | Fail> {
  const tenantId = await accountsTenant();
  if (!tenantId) return { error: UNAVAILABLE };
  const me = await getSignedInCustomer(tenantId);
  if (!me) return { error: "Please sign in." };

  const limit = rateLimit(`customer-password:${tenantId}:${me.id}`, 5, 15 * MINUTE);
  if (!limit.ok) return { error: "Too many attempts. Try again later." };

  const parsed = parseCustomerPasswordChange(input);
  if (!parsed.ok) return { error: parsed.error };

  try {
    const row = await withTenant(tenantId, (db) =>
      db.storefrontCustomer.findFirst({ where: { id: me.id }, select: { passwordHash: true } }),
    );
    if (!row || !verifyPassword(parsed.value.current, row.passwordHash)) {
      return { error: "Your current password is incorrect." };
    }
    const updated = await withTenant(tenantId, (db) =>
      db.storefrontCustomer.update({
        where: { id: me.id },
        data: { passwordHash: hashPassword(parsed.value.next), sessionVersion: { increment: 1 } },
        select: { sessionVersion: true },
      }),
    );
    await saveCustomerSession(tenantId, me.id, updated.sessionVersion);
    return { ok: true };
  } catch (e) {
    console.error("[customer-accounts] password change failed", e);
    return { error: "Couldn't change your password. Please try again." };
  }
}

// ── Store admin: Customers ───────────────────────────────────────────────────

export type StoreCustomerRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: "active" | "disabled";
  joinedAt: string;
  lastLoginAt: string | null;
  orderCount: number;
};

async function adminTenant(): Promise<string | null> {
  const ctx = await requireStaffPermission("customers");
  if (!ctx || isDemoMode()) return null;
  return (await hasFeature(ctx.tenantId, FEATURES.STORE_CUSTOMER_ACCOUNTS)) ? ctx.tenantId : null;
}

export async function listStoreCustomersAction(): Promise<{ ok: true; customers: StoreCustomerRow[] } | Fail> {
  const tenantId = await adminTenant();
  if (!tenantId) return { error: "Not signed in to the store admin." };
  try {
    const rows = await withTenant(tenantId, (db) =>
      db.storefrontCustomer.findMany({
        orderBy: { createdAt: "desc" },
        take: 2000,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          status: true,
          createdAt: true,
          lastLoginAt: true,
          _count: { select: { orders: { where: { deletedAt: null } } } },
        },
      }),
    );
    return {
      ok: true,
      customers: rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        status: r.status === "disabled" ? "disabled" : "active",
        joinedAt: r.createdAt.toISOString(),
        lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
        orderCount: r._count.orders,
      })),
    };
  } catch (e) {
    console.error("[customer-accounts] list customers failed", e);
    return { error: "Couldn't load customers." };
  }
}

/** Disable (signs the customer out everywhere) or re-enable an account. */
export async function setStoreCustomerStatusAction(
  id: unknown,
  status: unknown,
): Promise<{ ok: true } | Fail> {
  const tenantId = await adminTenant();
  if (!tenantId) return { error: "Not signed in to the store admin." };
  if (typeof id !== "string" || (status !== "active" && status !== "disabled")) {
    return { error: "Invalid request." };
  }
  try {
    const res = await withTenant(tenantId, (db) =>
      db.storefrontCustomer.updateMany({
        where: { id },
        data: { status, ...(status === "disabled" ? { sessionVersion: { increment: 1 } } : {}) },
      }),
    );
    return res.count === 1 ? { ok: true } : { error: "Customer not found." };
  } catch (e) {
    console.error("[customer-accounts] status change failed", e);
    return { error: "Couldn't update the customer." };
  }
}
