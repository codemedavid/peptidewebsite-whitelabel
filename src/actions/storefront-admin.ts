"use server";

import { Prisma } from "@prisma/client";
import { getTenantIdOrNull, getTenantSlug } from "@/lib/tenant/headers";
import { isDemoMode, getDemoBranding, saveDemoBranding } from "@/lib/demo/fixtures";
import { prisma } from "@/lib/db/prisma";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import {
  setStorefrontAdminCookie,
  clearStorefrontAdminCookie,
  requireStorefrontAdmin,
} from "@/lib/auth/storefront-admin";
import type { PaymentMethod } from "@/storefront/types";

export type ActionResult = { ok: true } | { error: string };

const DEFAULT_PASSWORD = "admin";

/** The branding.config blob for the current tenant (demo file or DB). */
async function readConfig(
  tenantId: string,
): Promise<Record<string, unknown>> {
  if (isDemoMode()) {
    return (getDemoBranding(tenantId).config ?? {}) as Record<string, unknown>;
  }
  const branding = await prisma.branding.findUnique({
    where: { tenantId },
    select: { config: true },
  });
  return (branding?.config ?? {}) as Record<string, unknown>;
}

/** The admin password the owner configured, or the built-in default. */
function resolvePassword(config: Record<string, unknown>): string {
  const raw = typeof config.adminPassword === "string" ? config.adminPassword.trim() : "";
  return raw || DEFAULT_PASSWORD;
}

/**
 * Verify the storefront admin password (server-side) and, on success, issue the
 * signed `sf_admin_session` cookie scoped to the current tenant. The tenant is
 * resolved from the request host — no slug is passed from the (untrusted) client.
 */
export async function signInStorefrontAdminAction(password: string): Promise<ActionResult> {
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return { error: "Could not resolve this store." };

  const config = await readConfig(tenantId);
  const expected = resolvePassword(config);

  if ((password ?? "").trim() !== expected) {
    return { error: "Incorrect password." };
  }

  await setStorefrontAdminCookie(tenantId);
  return { ok: true };
}

export async function signOutStorefrontAdminAction(): Promise<ActionResult> {
  await clearStorefrontAdminCookie();
  return { ok: true };
}

/**
 * Whether the caller holds a valid storefront-admin session for this tenant.
 * The storefront UI uses this to gate the admin on a REAL server session rather
 * than the bypassable sessionStorage flag — without it, a stale flag would let a
 * user into the admin with no cookie, and every save would be silently rejected.
 */
export async function hasStorefrontAdminSessionAction(): Promise<boolean> {
  return (await requireStorefrontAdmin()) !== null;
}

/** Coerce untrusted client input into clean PaymentMethod rows. */
function normalizeMethods(input: unknown): PaymentMethod[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 50).map((m, i) => {
    const o = (m ?? {}) as Record<string, unknown>;
    return {
      id: String(o.id ?? `pm${i + 1}`).slice(0, 64),
      name: String(o.name ?? "").slice(0, 120),
      account: String(o.account ?? "").slice(0, 200),
      number: String(o.number ?? "").slice(0, 200),
      qrImage: typeof o.qrImage === "string" ? o.qrImage : "",
      order: Number.isFinite(Number(o.order)) ? Number(o.order) : i + 1,
      active: o.active !== false,
    };
  });
}

/**
 * Persist the storefront's payment methods into the shared `branding.config`
 * blob (read-modify-write, mirroring saveContactChannelsAction so it never
 * clobbers the rest of the storefront Brand config). Because the storefront
 * reads payment methods from `branding.config` server-side on every render, this
 * makes the configured set show up on every device/customer — fixing the bug
 * where checkout fell back to the seed defaults on phones.
 */
export async function savePaymentMethodsAction(methods: unknown): Promise<ActionResult> {
  const tenantId = await requireStorefrontAdmin();
  if (!tenantId) return { error: "Not signed in to the store admin." };

  const slug = await getTenantSlug();
  const paymentMethods = normalizeMethods(methods);
  const current = await readConfig(tenantId);
  const config = { ...current, paymentMethods };

  if (isDemoMode()) {
    saveDemoBranding(tenantId, { config });
  } else {
    await prisma.branding.upsert({
      where: { tenantId },
      update: { config: config as Prisma.InputJsonValue },
      create: { tenantId, config: config as Prisma.InputJsonValue },
    });
  }

  revalidateTenant(tenantId, slug);
  return { ok: true };
}
