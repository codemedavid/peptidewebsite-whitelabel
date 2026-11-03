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
import { withTenant, type TenantTx } from "@/lib/db/tenant-client";
import { hashPassword, verifyPassword } from "@/lib/auth/password-hash";
import { claimGuestCustomer, GUEST_PASSWORD_HASH } from "@/lib/storefront/guest-customer";
import {
  saveCustomerSession,
  clearCustomerSession,
  getSignedInCustomer,
} from "@/lib/auth/customer-session";
import { requireStaffPermission } from "@/lib/auth/staff-guard";
import { isModuleAllowed } from "@/storefront/admin/staff-permissions";
import {
  parseCustomerLookup,
  summarizeCustomerOrders,
  type CustomerOrderStats,
} from "@/lib/storefront/customer-profile";
import type { Order } from "@/storefront/types";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import {
  parseCustomerSignUp,
  parseCustomerSignIn,
  parseCustomerProfile,
  parseCustomerPasswordChange,
  parseAdminCustomerEdit,
  generateTempPassword,
} from "@/lib/storefront/customer-account";
import { purgeCustomer } from "@/lib/mobile/account-delete";
import { ACTIVE_ORDERS_WHERE } from "@/lib/orders/trash";
import { dbOrderToStorefront, type DbOrderRow } from "@/lib/orders/db-mapping";
import { toTrackedOrder, type TrackedOrder } from "@/lib/orders/tracked-order";
import { computeOrderTotals } from "@/storefront/admin/order-detail";
import { sanitizeSavedDetails } from "@/lib/storefront/saved-details";
import type { CheckoutCustomer } from "@/storefront/checkout";
import { revalidateOrders } from "@/lib/orders/order-cache";

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
      // The email joined a group buy without an account: this sign-up claims that row.
      const claimed = await claimGuestCustomer(tenantId, email, { name, phone, passwordHash: hashPassword(password) }).catch(() => null);
      if (!claimed) return { error: "An account with this email already exists. Sign in instead." };
      await saveCustomerSession(tenantId, claimed.id, claimed.sessionVersion);
      return { ok: true, account: { name, email, phone, memberSince: new Date().toISOString() } };
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

/**
 * The signed-in shopper's checkout details on ANY device: their account's name,
 * email and phone, plus the shipping address from their latest order. The
 * per-browser saved-details cookie only helps on the browser that placed the
 * order; this is what lets a member top up a group-buy order from a new phone
 * without retyping. The client fills EMPTY fields only. Null when signed out.
 */
export async function getMyCheckoutDetailsAction(): Promise<CheckoutCustomer | null> {
  const tenantId = await accountsTenant();
  if (!tenantId) return null;
  const me = await getSignedInCustomer(tenantId);
  if (!me) return null;
  try {
    const [account, last] = await withTenant(tenantId, async (db) => [
      await db.storefrontCustomer.findFirst({ where: { id: me.id }, select: { name: true, email: true, phone: true } }),
      await db.storefrontOrder.findFirst({
        where: { ...ACTIVE_ORDERS_WHERE, customerAccountId: me.id, status: { not: "cancelled" } },
        orderBy: { placedAt: "desc" },
      }),
    ] as const);
    const o = last ? dbOrderToStorefront(last as DbOrderRow) : null;
    return sanitizeSavedDetails({
      name: account?.name || o?.customer.name || "",
      email: account?.email || o?.customer.email || "",
      phone: account?.phone || o?.customer.phone || "",
      address: o?.shipping.address ?? "",
      barangay: o?.shipping.barangay ?? "",
      city: o?.shipping.city ?? "",
      province: o?.shipping.province ?? "",
      postal: o?.shipping.postal ?? "",
    });
  } catch (e) {
    console.error("[customer-accounts] checkout details failed", e);
    return null;
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
  /** Non-cancelled linked orders' totals; null when the actor lacks the Orders grant. */
  spent: number | null;
  /** Newest non-cancelled linked order; null when none (or no Orders grant). */
  lastOrderAt: string | null;
  /** Joined a group buy by email only — no password; Create account with that email claims it. */
  emailOnly: boolean;
  /** Guest orders under this email not yet linked to the account (0 without the Orders grant). */
  unlinkedOrders: number;
};

/** Linked orders read per list load — far above any store's account book today. */
const SPEND_ORDER_LIMIT = 10_000;

async function adminActor() {
  const ctx = await requireStaffPermission("customers");
  if (!ctx || isDemoMode()) return null;
  return (await hasFeature(ctx.tenantId, FEATURES.STORE_CUSTOMER_ACCOUNTS)) ? ctx : null;
}

async function adminTenant(): Promise<string | null> {
  return (await adminActor())?.tenantId ?? null;
}

/** One linked, non-cancelled order — what the Customers analytics are built from. */
export type CustomerLedgerEntry = { accountId: string; at: string; total: number };

/** Every account-linked non-cancelled order as a ledger entry, newest first. */
async function accountLedger(db: TenantTx): Promise<CustomerLedgerEntry[]> {
  const rows = await db.storefrontOrder.findMany({
    where: { ...ACTIVE_ORDERS_WHERE, customerAccountId: { not: null }, status: { not: "cancelled" } },
    orderBy: { placedAt: "desc" },
    take: SPEND_ORDER_LIMIT,
  });
  return rows.flatMap((r) =>
    r.customerAccountId
      ? [
          {
            accountId: r.customerAccountId,
            at: r.placedAt.toISOString(),
            total: computeOrderTotals(dbOrderToStorefront(r as DbOrderRow)).total,
          },
        ]
      : [],
  );
}

/** Active guest (unlinked) orders per lower-cased checkout email. */
async function unlinkedOrdersByEmail(db: TenantTx, tenantId: string): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<Array<{ email: string; n: number }>>`
    SELECT lower(trim(customer->>'email')) AS email, count(*)::int AS n
    FROM storefront_orders
    WHERE "tenantId" = ${tenantId}
      AND "deletedAt" IS NULL
      AND "customerAccountId" IS NULL
      AND coalesce(trim(customer->>'email'), '') <> ''
    GROUP BY 1`;
  return new Map(rows.map((r) => [r.email, Number(r.n)]));
}

function spendByAccount(ledger: CustomerLedgerEntry[]): Map<string, { spent: number; lastAt: string }> {
  const out = new Map<string, { spent: number; lastAt: string }>();
  for (const e of ledger) {
    const prev = out.get(e.accountId);
    out.set(e.accountId, {
      spent: (prev?.spent ?? 0) + e.total,
      lastAt: prev && prev.lastAt > e.at ? prev.lastAt : e.at,
    });
  }
  return out;
}

export async function listStoreCustomersAction(): Promise<
  { ok: true; customers: StoreCustomerRow[]; ledger: CustomerLedgerEntry[] | null } | Fail
> {
  const ctx = await adminActor();
  if (!ctx) return { error: "Not signed in to the store admin." };
  const { tenantId } = ctx;
  // Spend is order money — the Orders grant, same as each order's total.
  const canSeeSpend = isModuleAllowed(ctx.actor, "orders");
  try {
    const [rows, ledger, unlinked] = await withTenant(tenantId, async (db) => [
      await db.storefrontCustomer.findMany({
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
          // Read only to tell an email-only guest from an account — never returned.
          passwordHash: true,
          _count: { select: { orders: { where: { deletedAt: null } } } },
        },
      }),
      canSeeSpend ? await accountLedger(db) : null,
      canSeeSpend ? await unlinkedOrdersByEmail(db, tenantId) : null,
    ] as const);
    const spend = ledger ? spendByAccount(ledger) : null;
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
        spent: spend ? (spend.get(r.id)?.spent ?? 0) : null,
        lastOrderAt: spend?.get(r.id)?.lastAt ?? null,
        emailOnly: r.passwordHash === GUEST_PASSWORD_HASH,
        unlinkedOrders: unlinked?.get(r.email.trim().toLowerCase()) ?? 0,
      })),
      ledger,
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

/** A shopper who forgot their password messages the store; the owner issues a
 *  temp one here and passes it on. Bumping sessionVersion signs the account out
 *  of every device (website cookie and app token alike). The temp password is
 *  returned once and never stored in plain text. */
export async function resetStoreCustomerPasswordAction(
  id: unknown,
): Promise<{ ok: true; tempPassword: string } | Fail> {
  const tenantId = await adminTenant();
  if (!tenantId) return { error: "Not signed in to the store admin." };
  if (typeof id !== "string" || !id) return { error: "Invalid request." };
  const limit = rateLimit(`customer-reset:${tenantId}`, 20, 15 * MINUTE);
  if (!limit.ok) return { error: "Too many resets. Try again later." };

  const tempPassword = generateTempPassword();
  try {
    const res = await withTenant(tenantId, (db) =>
      db.storefrontCustomer.updateMany({
        // Never an email-only guest: giving it a password would mint an account the shopper never created.
        where: { id, tenantId, status: "active", passwordHash: { not: GUEST_PASSWORD_HASH } },
        data: { passwordHash: hashPassword(tempPassword), sessionVersion: { increment: 1 } },
      }),
    );
    if (res.count !== 1) {
      return { error: "Customer not found, disabled, or an email-only entry (no password to reset)." };
    }
    return { ok: true, tempPassword };
  } catch (e) {
    console.error("[customer-accounts] password reset failed", e);
    return { error: "Couldn't reset the password. Please try again." };
  }
}

/** The owner corrects a customer's name, email or phone. The account keeps its
 *  password and sessions; a new email must not already be on this store. */
export async function updateStoreCustomerAction(
  id: unknown,
  input: unknown,
): Promise<{ ok: true; customer: Pick<StoreCustomerRow, "id" | "name" | "email" | "phone"> } | Fail> {
  const tenantId = await adminTenant();
  if (!tenantId) return { error: "Not signed in to the store admin." };
  if (typeof id !== "string" || !id) return { error: "Invalid request." };
  const parsed = parseAdminCustomerEdit(input);
  if (!parsed.ok) return { error: parsed.error };

  try {
    const res = await withTenant(tenantId, (db) =>
      db.storefrontCustomer.updateMany({ where: { id, tenantId }, data: parsed.value }),
    );
    if (res.count !== 1) return { error: "Customer not found." };
    return { ok: true, customer: { id, ...parsed.value } };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "Another customer on this store already uses that email." };
    }
    console.error("[customer-accounts] customer edit failed", e);
    return { error: "Couldn't save the customer. Please try again." };
  }
}

/** Permanently delete a customer account — the same purge as the app's own
 *  "Delete account": personal data, community membership and every session go;
 *  their orders stay in the store's books, unlinked from the account. */
export async function deleteStoreCustomerAction(id: unknown): Promise<{ ok: true } | Fail> {
  const tenantId = await adminTenant();
  if (!tenantId) return { error: "Not signed in to the store admin." };
  if (typeof id !== "string" || !id) return { error: "Invalid request." };

  try {
    const row = await withTenant(tenantId, (db) =>
      db.storefrontCustomer.findFirst({ where: { id, tenantId }, select: { id: true } }),
    );
    if (!row) return { error: "Customer not found." };
    await purgeCustomer(tenantId, row.id);
    return { ok: true };
  } catch (e) {
    console.error("[customer-accounts] customer delete failed", e);
    return { error: "Couldn't delete the customer. Please try again." };
  }
}

// ── Store admin: one customer's order history ────────────────────────────────
//
// Gated on the Orders permission — the grant that already shows every order and
// its buyer — not on the customer-accounts feature: a community-only store has
// accounts too, and a guest buyer (no account) has a history worth seeing.

const PROFILE_ORDER_LIMIT = 200;
const LINK_ORDER_LIMIT = 1000;

export type StoreCustomerProfileOrder = Order & { total: number };

export type StoreCustomerProfile = {
  /** null = a guest buyer, matched by the email they check out with. */
  account: {
    id: string;
    status: "active" | "disabled";
    joinedAt: string;
    lastLoginAt: string | null;
    /** Joined a group buy by email only — there is no password to sign in with. */
    emailOnly: boolean;
  } | null;
  name: string;
  email: string;
  phone: string;
  orders: StoreCustomerProfileOrder[];
  stats: CustomerOrderStats;
  /** Account only: earlier guest orders under the same email, not linked yet. */
  unlinkedCount: number;
  /** More orders exist than were returned (PROFILE_ORDER_LIMIT). */
  truncated: boolean;
};

async function ordersTenant(): Promise<string | null> {
  if (isDemoMode()) return null;
  const ctx = await requireStaffPermission("orders");
  return ctx?.tenantId ?? null;
}

/** Ids of active orders checked out under `email` (any case); optionally only unlinked ones. */
async function orderIdsByEmail(
  db: TenantTx,
  tenantId: string,
  email: string,
  opts: { unlinkedOnly: boolean; limit: number },
): Promise<string[]> {
  const rows = opts.unlinkedOnly
    ? await db.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM storefront_orders
        WHERE "tenantId" = ${tenantId}
          AND "deletedAt" IS NULL
          AND "customerAccountId" IS NULL
          AND lower(trim(customer->>'email')) = ${email}
        ORDER BY "placedAt" DESC
        LIMIT ${opts.limit}`
    : await db.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM storefront_orders
        WHERE "tenantId" = ${tenantId}
          AND "deletedAt" IS NULL
          AND lower(trim(customer->>'email')) = ${email}
        ORDER BY "placedAt" DESC
        LIMIT ${opts.limit}`;
  return rows.map((r) => r.id);
}

function toProfileOrder(row: unknown): StoreCustomerProfileOrder {
  const o = dbOrderToStorefront(row as DbOrderRow);
  return { ...o, total: computeOrderTotals(o).total };
}

export async function getStoreCustomerProfileAction(
  lookup: unknown,
): Promise<{ ok: true; profile: StoreCustomerProfile } | Fail> {
  const tenantId = await ordersTenant();
  if (!tenantId) return { error: "You don't have access to orders." };
  const parsed = parseCustomerLookup(lookup);
  if (!parsed) return { error: "Invalid request." };

  try {
    const profile = await withTenant(tenantId, async (db): Promise<StoreCustomerProfile | null> => {
      const account = await db.storefrontCustomer.findFirst({
        where:
          parsed.kind === "account"
            ? { id: parsed.id }
            : { email: { equals: parsed.email, mode: "insensitive" } },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          status: true,
          passwordHash: true,
          createdAt: true,
          lastLoginAt: true,
        },
      });
      if (!account && parsed.kind === "account") return null;

      const email = (account?.email ?? (parsed.kind === "email" ? parsed.email : "")).trim().toLowerCase();
      const where: Prisma.StorefrontOrderWhereInput = account
        ? { ...ACTIVE_ORDERS_WHERE, customerAccountId: account.id }
        : { ...ACTIVE_ORDERS_WHERE, id: { in: await orderIdsByEmail(db, tenantId, email, { unlinkedOnly: false, limit: PROFILE_ORDER_LIMIT + 1 }) } };
      const rows = await db.storefrontOrder.findMany({
        where,
        orderBy: { placedAt: "desc" },
        take: PROFILE_ORDER_LIMIT + 1,
      });
      const truncated = rows.length > PROFILE_ORDER_LIMIT;
      const orders = rows.slice(0, PROFILE_ORDER_LIMIT).map(toProfileOrder);
      if (!account && orders.length === 0) return null;

      const unlinkedCount =
        account && email
          ? (await orderIdsByEmail(db, tenantId, email, { unlinkedOnly: true, limit: LINK_ORDER_LIMIT })).length
          : 0;
      const latest = orders[0]?.customer;
      return {
        account: account
          ? {
              id: account.id,
              status: account.status === "disabled" ? "disabled" : "active",
              joinedAt: account.createdAt.toISOString(),
              lastLoginAt: account.lastLoginAt?.toISOString() ?? null,
              emailOnly: account.passwordHash === GUEST_PASSWORD_HASH,
            }
          : null,
        name: (account?.name || latest?.name || "").trim() || "Customer",
        email: account?.email ?? (latest?.email || email).trim(),
        phone: (account?.phone || latest?.phone || "").trim(),
        orders,
        stats: summarizeCustomerOrders(orders, (o) => (o as StoreCustomerProfileOrder).total),
        unlinkedCount,
        truncated,
      };
    });
    return profile ? { ok: true, profile } : { error: "Customer not found." };
  } catch (e) {
    console.error("[customer-accounts] customer profile failed", e);
    return { error: "Couldn't load this customer. Please try again." };
  }
}

/**
 * Link the account's earlier guest orders — same email, placed before they
 * signed up or while signed out — to the account. Emails at checkout aren't
 * verified, so this is never automatic: the admin confirms it per customer.
 * Linked orders show in the shopper's My Account and get order-update messages.
 */
export async function linkStoreCustomerOrdersAction(
  accountId: unknown,
): Promise<{ ok: true; linked: number } | Fail> {
  const tenantId = await ordersTenant();
  if (!tenantId) return { error: "You don't have access to orders." };
  const parsed = parseCustomerLookup({ kind: "account", id: accountId });
  if (!parsed || parsed.kind !== "account") return { error: "Invalid request." };

  try {
    const linked = await withTenant(tenantId, async (db): Promise<number | null> => {
      const account = await db.storefrontCustomer.findFirst({ where: { id: parsed.id }, select: { id: true, email: true } });
      if (!account) return null;
      const email = account.email.trim().toLowerCase();
      if (!email) return 0;
      const ids = await orderIdsByEmail(db, tenantId, email, { unlinkedOnly: true, limit: LINK_ORDER_LIMIT });
      if (ids.length === 0) return 0;
      // Still unlinked at write time: a concurrent link can't move an order twice.
      const res = await db.storefrontOrder.updateMany({
        where: { id: { in: ids }, customerAccountId: null },
        data: { customerAccountId: account.id },
      });
      return res.count;
    });
    // The admin order lists are cached under the orders tag — bust it after the
    // commit so the newly linked orders show their account straight away.
    if (linked) revalidateOrders(tenantId);
    return linked === null ? { error: "Customer not found." } : { ok: true, linked };
  } catch (e) {
    console.error("[customer-accounts] link orders failed", e);
    return { error: "Couldn't link the orders. Please try again." };
  }
}
