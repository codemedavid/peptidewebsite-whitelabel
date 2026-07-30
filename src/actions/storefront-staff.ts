"use server";

import { Prisma } from "@prisma/client";
import { getTenantIdOrNull, getTenantSlug } from "@/lib/tenant/headers";
import { isDemoMode, getDemoBranding } from "@/lib/demo/fixtures";
import { prisma } from "@/lib/db/prisma";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { hashPassword } from "@/lib/auth/password-hash";
import { setStorefrontAdminCookie } from "@/lib/auth/storefront-admin";
import { getStorefrontAdminActor, requireStoreOwner } from "@/lib/auth/staff-guard";
import {
  resolveStoreAdminLogin,
  normalizeLoginEmail,
  type OwnerCredential,
} from "@/lib/auth/store-admin-login";
import { recordAuthAudit } from "@/lib/auth/audit";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { sanitizePermissions } from "@/storefront/admin/staff-permissions";
import { parseStaffCreate, parseStaffUpdate } from "@/lib/storefront/staff-input";

/**
 * Server actions for the store-admin Staff Accounts feature. Two audiences:
 *   - Public-ish: signInStoreAdminAction (unified owner/staff login) and
 *     getStorefrontAdminSessionAction (the client reads its own actor to filter
 *     the admin menu).
 *   - Owner only: list/create/update/status/delete — hard-gated by
 *     requireStoreOwner() so a staff member can never manage staff or self-escalate.
 *
 * Staff are not available in demo mode (there is no demo staff table); owner login
 * still works there against the demo branding config.
 */

export type ActionResult = { ok: true } | { error: string };

const FIFTEEN_MIN = 15 * 60 * 1000;
const DEMO_UNAVAILABLE = "Staff accounts aren't available in demo mode.";
const OWNER_ONLY = "Only the store owner can manage staff.";
const FEATURE_OFF = "Staff Accounts isn't enabled for this store.";
/** The single generic sign-in failure. Deliberately does not distinguish a bad
 *  email from a bad password, nor a store whose credential was never set. */
const INVALID_LOGIN = "Incorrect email or password.";

/** Fire-and-forget auth audit row; never breaks the login flow it records. */
async function audit(
  tenantId: string,
  event: "admin_login" | "admin_login_failed",
  ip: string | null,
) {
  await recordAuthAudit((row) => prisma.authAudit.create({ data: row }), { tenantId, event, ip });
}

/**
 * Is the Staff Accounts feature entitled for this tenant? Owner-only management,
 * staff sign-in and staff session resolution all re-check this so revoking the
 * feature (or a Starter tenant never granted it) makes staff inert — the same
 * downgrade-safety pattern the storefront page uses to derive brand.showAdminStaff.
 */
async function staffFeatureOn(tenantId: string): Promise<boolean> {
  return hasFeature(tenantId, FEATURES.STORE_STAFF_ACCOUNTS);
}

/**
 * The OWNER's store-admin credential: their sign-in email + scrypt password
 * hash, set by the super admin in the tenant settings console.
 *
 * Read from the Tenant row, NOT branding.config — that blob is spread wholesale
 * into the client `brand` object, so a credential kept there would ship to every
 * storefront visitor. Returns null when either half is unset, which makes
 * resolveStoreAdminLogin fail closed: there is no default password any more.
 */
async function readOwnerCredential(tenantId: string): Promise<OwnerCredential | null> {
  if (isDemoMode()) {
    // Demo mode has no database; the fixture config carries the demo credential.
    const config = (getDemoBranding(tenantId).config ?? {}) as Record<string, unknown>;
    const email = typeof config.adminEmail === "string" ? config.adminEmail : "";
    const passwordHash =
      typeof config.adminPasswordHash === "string" ? config.adminPasswordHash : "";
    return email && passwordHash ? { email, passwordHash } : null;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { storeAdminEmail: true, storeAdminPasswordHash: true },
  });
  if (!tenant?.storeAdminEmail || !tenant.storeAdminPasswordHash) return null;
  return { email: tenant.storeAdminEmail, passwordHash: tenant.storeAdminPasswordHash };
}

/**
 * The tenant's staff login rows. A missing or unmigrated staff table must never
 * break the OWNER's ability to sign in, so a query failure degrades to "no
 * staff" rather than throwing the whole login.
 */
async function readStaffCredentials(tenantId: string) {
  if (isDemoMode()) return [];
  try {
    return await prisma.storefrontStaff.findMany({
      where: { tenantId },
      select: { id: true, email: true, passwordHash: true, status: true },
    });
  } catch {
    return [];
  }
}

// ── Unified login ────────────────────────────────────────────────────────────

/**
 * Verify a username + password against the owner credential and the tenant's staff
 * rows, and on success mint the signed `sf_admin_session` cookie with the matching
 * subject (owner | staff:<id>). Rate-limited per IP. The tenant is resolved from
 * the request host — no slug from the (untrusted) client.
 */
export async function signInStoreAdminAction(
  email: string,
  password: string,
): Promise<{ ok: true; kind: "owner" | "staff" } | { error: string }> {
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return { error: "Could not resolve this store." };

  const ip = await clientIp();
  const limited = rateLimit(`sf-admin:signin:${tenantId}:${ip}`, 10, FIFTEEN_MIN);
  if (!limited.ok) return { error: "Too many attempts. Try again in a few minutes." };

  const [owner, staff] = await Promise.all([
    readOwnerCredential(tenantId),
    readStaffCredentials(tenantId),
  ]);

  const result = resolveStoreAdminLogin(email, password, owner, staff);

  // Staff sign-in requires the Staff Accounts feature; owner login never does.
  const staffBlocked = result.kind === "staff" && !(await staffFeatureOn(tenantId));

  if (result.kind === "suspended") {
    await audit(tenantId, "admin_login_failed", ip);
    return { error: "This staff account is suspended. Contact the store owner." };
  }

  // `invalid`, `unconfigured` and a de-entitled staff match all collapse to ONE
  // message. Never tell the browser which store has no credential set, or which
  // half of the pair was wrong.
  if (result.kind === "invalid" || result.kind === "unconfigured" || staffBlocked) {
    await audit(tenantId, "admin_login_failed", ip);
    return { error: INVALID_LOGIN };
  }

  const subject =
    result.kind === "owner"
      ? ({ kind: "owner" } as const)
      : ({ kind: "staff", id: result.id } as const);
  await setStorefrontAdminCookie(tenantId, subject);
  await audit(tenantId, "admin_login", ip);
  return { ok: true, kind: result.kind };
}

export type AdminSessionInfo =
  | { kind: "owner"; displayName: string }
  | { kind: "staff"; id: string; displayName: string; permissions: string[] }
  | { kind: "none" };

/**
 * The current store-admin actor, for the client to filter its menu/views. Re-loads
 * staff state via the guard, so a suspended/removed staff member resolves to "none".
 */
export async function getStorefrontAdminSessionAction(): Promise<AdminSessionInfo> {
  const ctx = await getStorefrontAdminActor();
  if (!ctx) return { kind: "none" };

  if (ctx.actor.kind === "owner") {
    const owner = await readOwnerCredential(ctx.tenantId);
    return { kind: "owner", displayName: owner?.email ?? "Store owner" };
  }

  // Staff actor but the feature was revoked (or never granted) → treat as signed
  // out, so the admin menu/views collapse to "none" the moment entitlement drops.
  if (!(await staffFeatureOn(ctx.tenantId))) return { kind: "none" };

  const staff = isDemoMode()
    ? null
    : await prisma.storefrontStaff.findFirst({
        where: { id: ctx.actor.id, tenantId: ctx.tenantId },
        select: { fullName: true },
      });
  return {
    kind: "staff",
    id: ctx.actor.id,
    displayName: staff?.fullName ?? "Staff",
    permissions: ctx.actor.permissions,
  };
}

// ── Owner-only staff management ──────────────────────────────────────────────

export type StaffListItem = {
  id: string;
  fullName: string;
  email: string;
  username: string;
  status: string;
  permissions: string[];
  createdAt: string;
};

export async function listStaffAction(): Promise<{ ok: true; items: StaffListItem[] } | { error: string }> {
  const tenantId = await requireStoreOwner();
  if (!tenantId) return { error: OWNER_ONLY };
  if (!(await staffFeatureOn(tenantId))) return { error: FEATURE_OFF };
  if (isDemoMode()) return { ok: true, items: [] };

  const rows = await prisma.storefrontStaff.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      fullName: true,
      email: true,
      username: true,
      status: true,
      permissions: true,
      createdAt: true,
    },
  });

  return {
    ok: true,
    items: rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      username: r.username,
      status: r.status,
      permissions: sanitizePermissions(r.permissions),
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function createStaffAction(input: unknown): Promise<ActionResult> {
  const tenantId = await requireStoreOwner();
  if (!tenantId) return { error: OWNER_ONLY };
  if (!(await staffFeatureOn(tenantId))) return { error: FEATURE_OFF };
  if (isDemoMode()) return { error: DEMO_UNAVAILABLE };

  const parsed = parseStaffCreate(input);
  if (!parsed.ok) return { error: parsed.error };

  const owner = await readOwnerCredential(tenantId);
  if (owner && normalizeLoginEmail(parsed.value.email) === normalizeLoginEmail(owner.email)) {
    return { error: "That email belongs to the store owner. Use a different one." };
  }

  const existing = await prisma.storefrontStaff.findFirst({
    where: { tenantId, username: parsed.value.username },
    select: { id: true },
  });
  if (existing) return { error: "That username is already taken." };

  try {
    await prisma.storefrontStaff.create({
      data: {
        tenantId,
        fullName: parsed.value.fullName,
        email: parsed.value.email,
        username: parsed.value.username,
        passwordHash: hashPassword(parsed.value.password),
        status: parsed.value.status,
        permissions: parsed.value.permissions as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: "That username is already taken." };
    }
    throw err;
  }

  revalidateTenant(tenantId, await getTenantSlug());
  return { ok: true };
}

export async function updateStaffAction(id: string, input: unknown): Promise<ActionResult> {
  const tenantId = await requireStoreOwner();
  if (!tenantId) return { error: OWNER_ONLY };
  if (!(await staffFeatureOn(tenantId))) return { error: FEATURE_OFF };
  if (isDemoMode()) return { error: DEMO_UNAVAILABLE };

  const staffId = String(id ?? "").trim();
  if (!staffId) return { error: "Missing staff id." };

  const parsed = parseStaffUpdate(input);
  if (!parsed.ok) return { error: parsed.error };

  const owner = await readOwnerCredential(tenantId);
  if (owner && normalizeLoginEmail(parsed.value.email) === normalizeLoginEmail(owner.email)) {
    return { error: "That email belongs to the store owner. Use a different one." };
  }

  // The row must belong to this tenant (defence beyond the global PK).
  const current = await prisma.storefrontStaff.findFirst({
    where: { id: staffId, tenantId },
    select: { id: true },
  });
  if (!current) return { error: "Staff member not found." };

  const clash = await prisma.storefrontStaff.findFirst({
    where: { tenantId, username: parsed.value.username, NOT: { id: staffId } },
    select: { id: true },
  });
  if (clash) return { error: "That username is already taken." };

  const data: Prisma.StorefrontStaffUpdateInput = {
    fullName: parsed.value.fullName,
    email: parsed.value.email,
    username: parsed.value.username,
    status: parsed.value.status,
    permissions: parsed.value.permissions as Prisma.InputJsonValue,
  };
  if (parsed.value.password) data.passwordHash = hashPassword(parsed.value.password);

  await prisma.storefrontStaff.update({ where: { id: staffId }, data });

  revalidateTenant(tenantId, await getTenantSlug());
  return { ok: true };
}

export async function setStaffStatusAction(id: string, status: string): Promise<ActionResult> {
  const tenantId = await requireStoreOwner();
  if (!tenantId) return { error: OWNER_ONLY };
  if (!(await staffFeatureOn(tenantId))) return { error: FEATURE_OFF };
  if (isDemoMode()) return { error: DEMO_UNAVAILABLE };

  const staffId = String(id ?? "").trim();
  if (!staffId) return { error: "Missing staff id." };
  if (status !== "active" && status !== "suspended") return { error: "Invalid status." };

  const res = await prisma.storefrontStaff.updateMany({
    where: { id: staffId, tenantId },
    data: { status },
  });
  if (res.count === 0) return { error: "Staff member not found." };

  revalidateTenant(tenantId, await getTenantSlug());
  return { ok: true };
}

export async function deleteStaffAction(id: string): Promise<ActionResult> {
  const tenantId = await requireStoreOwner();
  if (!tenantId) return { error: OWNER_ONLY };
  if (!(await staffFeatureOn(tenantId))) return { error: FEATURE_OFF };
  if (isDemoMode()) return { error: DEMO_UNAVAILABLE };

  const staffId = String(id ?? "").trim();
  if (!staffId) return { error: "Missing staff id." };

  const res = await prisma.storefrontStaff.deleteMany({ where: { id: staffId, tenantId } });
  if (res.count === 0) return { error: "Staff member not found." };

  revalidateTenant(tenantId, await getTenantSlug());
  return { ok: true };
}
