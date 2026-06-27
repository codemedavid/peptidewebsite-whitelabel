"use server";

import { Prisma } from "@prisma/client";
import { getTenantIdOrNull, getTenantSlug } from "@/lib/tenant/headers";
import { isDemoMode, getDemoBranding } from "@/lib/demo/fixtures";
import { prisma } from "@/lib/db/prisma";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { hashPassword } from "@/lib/auth/password-hash";
import { setStorefrontAdminCookie } from "@/lib/auth/storefront-admin";
import { getStorefrontAdminActor, requireStoreOwner } from "@/lib/auth/staff-guard";
import { resolveStoreAdminLogin } from "@/lib/auth/store-admin-login";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";
import { sanitizePermissions } from "@/storefront/admin/staff-permissions";
import { parseStaffCreate, parseStaffUpdate, isReservedUsername } from "@/lib/storefront/staff-input";

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

const DEFAULT_OWNER_USERNAME = "owner";
const DEFAULT_OWNER_PASSWORD = "admin";

/** The branding.config blob for the current tenant (demo file or DB). */
async function readConfig(tenantId: string): Promise<Record<string, unknown>> {
  if (isDemoMode()) {
    return (getDemoBranding(tenantId).config ?? {}) as Record<string, unknown>;
  }
  const branding = await prisma.branding.findUnique({
    where: { tenantId },
    select: { config: true },
  });
  return (branding?.config ?? {}) as Record<string, unknown>;
}

/** The owner's reserved username + password (config overrides, else the defaults). */
function resolveOwnerCredential(config: Record<string, unknown>): { username: string; password: string } {
  const username =
    typeof config.adminUsername === "string" && config.adminUsername.trim()
      ? config.adminUsername.trim()
      : DEFAULT_OWNER_USERNAME;
  const password =
    typeof config.adminPassword === "string" && config.adminPassword.trim()
      ? config.adminPassword.trim()
      : DEFAULT_OWNER_PASSWORD;
  return { username, password };
}

// ── Unified login ────────────────────────────────────────────────────────────

/**
 * Verify a username + password against the owner credential and the tenant's staff
 * rows, and on success mint the signed `sf_admin_session` cookie with the matching
 * subject (owner | staff:<id>). Rate-limited per IP. The tenant is resolved from
 * the request host — no slug from the (untrusted) client.
 */
export async function signInStoreAdminAction(
  username: string,
  password: string,
): Promise<{ ok: true; kind: "owner" | "staff" } | { error: string }> {
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return { error: "Could not resolve this store." };

  const ip = await clientIp();
  const limited = rateLimit(`sf-admin:signin:${tenantId}:${ip}`, 10, FIFTEEN_MIN);
  if (!limited.ok) return { error: "Too many attempts. Try again in a few minutes." };

  const config = await readConfig(tenantId);
  const owner = resolveOwnerCredential(config);

  const staff = isDemoMode()
    ? []
    : await prisma.storefrontStaff.findMany({
        where: { tenantId },
        select: { id: true, username: true, passwordHash: true, status: true },
      });

  const result = resolveStoreAdminLogin(username, password, owner, staff);
  if (result.kind === "suspended") {
    return { error: "This staff account is suspended. Contact the store owner." };
  }
  if (result.kind === "invalid") {
    return { error: "Incorrect username or password." };
  }

  const subject =
    result.kind === "owner" ? ({ kind: "owner" } as const) : ({ kind: "staff", id: result.id } as const);
  await setStorefrontAdminCookie(tenantId, subject);
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
    const config = await readConfig(ctx.tenantId);
    return { kind: "owner", displayName: resolveOwnerCredential(config).username };
  }

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
  if (isDemoMode()) return { error: DEMO_UNAVAILABLE };

  const parsed = parseStaffCreate(input);
  if (!parsed.ok) return { error: parsed.error };

  const owner = resolveOwnerCredential(await readConfig(tenantId));
  if (isReservedUsername(parsed.value.username, owner.username)) {
    return { error: "That username is reserved. Choose a different one." };
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
  if (isDemoMode()) return { error: DEMO_UNAVAILABLE };

  const staffId = String(id ?? "").trim();
  if (!staffId) return { error: "Missing staff id." };

  const parsed = parseStaffUpdate(input);
  if (!parsed.ok) return { error: parsed.error };

  const owner = resolveOwnerCredential(await readConfig(tenantId));
  if (isReservedUsername(parsed.value.username, owner.username)) {
    return { error: "That username is reserved. Choose a different one." };
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
  if (isDemoMode()) return { error: DEMO_UNAVAILABLE };

  const staffId = String(id ?? "").trim();
  if (!staffId) return { error: "Missing staff id." };

  const res = await prisma.storefrontStaff.deleteMany({ where: { id: staffId, tenantId } });
  if (res.count === 0) return { error: "Staff member not found." };

  revalidateTenant(tenantId, await getTenantSlug());
  return { ok: true };
}
