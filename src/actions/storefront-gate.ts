"use server";

import { Prisma } from "@prisma/client";
import { getTenantIdOrNull, getTenantSlug } from "@/lib/tenant/headers";
import { isDemoMode } from "@/lib/demo/fixtures";
import { prisma } from "@/lib/db/prisma";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { hashPassword, verifyPassword } from "@/lib/auth/password-hash";
import { requireStorefrontAdmin } from "@/lib/auth/storefront-admin";
import { saveGateSession, clearGateSession } from "@/lib/auth/storefront-gate";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";

/**
 * Server actions for the per-tenant VISITOR access-code gate. Companion to the
 * stateless cookie in lib/auth/storefront-gate.ts. Two audiences:
 *   - Public: verifyAccessCodeAction (a visitor types the code to get in).
 *   - Store admin only: rotate/enable/read settings (guarded by the storefront
 *     admin session, same as every other storefront-admin mutation).
 *
 * The access code itself is scrypt-hashed on the Tenant row (accessCodeHash) and
 * NEVER shipped to the client. Rotating it bumps Tenant.accessCodeVersion, which
 * the layout's cookie check uses to log every active visitor out instantly.
 */

export type ActionResult = { ok: true } | { error: string };

const FIFTEEN_MIN = 15 * 60 * 1000;

type GateConfig = { enabled: boolean; heading: string };

/** The gate display settings (enabled + heading) from branding.config. */
function readGateConfig(config: Record<string, unknown>): GateConfig {
  const raw = (config.accessGate ?? {}) as Record<string, unknown>;
  return {
    enabled: raw.enabled === true,
    heading:
      typeof raw.heading === "string" && raw.heading.trim()
        ? raw.heading.trim()
        : "Enter access code",
  };
}

/**
 * Verify a visitor's access code for the current tenant and, on success, mint the
 * signed `tenant.sid` cookie. Public (no admin session). Rate-limited per IP.
 */
export async function verifyAccessCodeAction(code: string): Promise<ActionResult> {
  try {
    const tenantId = await getTenantIdOrNull();
    if (!tenantId) return { error: "Could not resolve this store." };
    if (isDemoMode()) return { error: "Access gate isn't available in demo mode." };

    // ~10 attempts / 15 min / IP — blunts brute-forcing the code.
    const ip = await clientIp();
    const limited = rateLimit(`gate:verify:${tenantId}:${ip}`, 10, FIFTEEN_MIN);
    if (!limited.ok) return { error: "Too many attempts. Try again in a few minutes." };

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { accessCodeHash: true, accessCodeVersion: true },
    });
    if (!tenant?.accessCodeHash) return { error: "invalid_code" };

    if (!verifyPassword((code ?? "").trim(), tenant.accessCodeHash)) {
      return { error: "invalid_code" };
    }

    await saveGateSession(tenantId, tenant.accessCodeVersion);
    return { ok: true };
  } catch (err) {
    console.error("verifyAccessCodeAction", (err as Error)?.message);
    return { error: "server_error" };
  }
}

/** Drop the visitor's gate cookie (sign out of the gate). Public. */
export async function logoutGateAction(): Promise<ActionResult> {
  try {
    await clearGateSession();
    return { ok: true };
  } catch (err) {
    console.error("logoutGateAction", (err as Error)?.message);
    return { error: "server_error" };
  }
}

export type GateSettings = { enabled: boolean; heading: string; hasCode: boolean };

/** Read the gate settings for the store admin panel (admin-guarded). */
export async function getGateSettingsAction(): Promise<GateSettings | { error: string }> {
  try {
    const tenantId = await requireStorefrontAdmin();
    if (!tenantId) return { error: "Not signed in to the store admin." };
    if (isDemoMode()) return { enabled: false, heading: "Enter access code", hasCode: false };

    const [branding, tenant] = await Promise.all([
      prisma.branding.findUnique({ where: { tenantId }, select: { config: true } }),
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { accessCodeHash: true } }),
    ]);
    const cfg = readGateConfig((branding?.config ?? {}) as Record<string, unknown>);
    return { enabled: cfg.enabled, heading: cfg.heading, hasCode: !!tenant?.accessCodeHash };
  } catch (err) {
    console.error("getGateSettingsAction", (err as Error)?.message);
    return { error: "server_error" };
  }
}

/** Toggle the gate on/off and set its heading (admin-guarded). */
export async function setGateSettingsAction(input: unknown): Promise<ActionResult> {
  try {
    const tenantId = await requireStorefrontAdmin();
    if (!tenantId) return { error: "Not signed in to the store admin." };
    if (isDemoMode()) return { error: "Access gate isn't available in demo mode." };

    const o = (input ?? {}) as Record<string, unknown>;
    const enabled = o.enabled === true;
    const heading = String(o.heading ?? "").slice(0, 120).trim() || "Enter access code";

    // Can't enable a gate with no code set, or visitors would be locked out
    // permanently with no way in.
    if (enabled) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { accessCodeHash: true },
      });
      if (!tenant?.accessCodeHash) {
        return { error: "Set an access code before turning the gate on." };
      }
    }

    const slug = await getTenantSlug();
    const branding = await prisma.branding.findUnique({
      where: { tenantId },
      select: { config: true },
    });
    const current = (branding?.config ?? {}) as Record<string, unknown>;
    const config = { ...current, accessGate: { enabled, heading } };

    await prisma.branding.upsert({
      where: { tenantId },
      update: { config: config as Prisma.InputJsonValue },
      create: { tenantId, config: config as Prisma.InputJsonValue },
    });
    revalidateTenant(tenantId, slug);
    return { ok: true };
  } catch (err) {
    console.error("setGateSettingsAction", (err as Error)?.message);
    return { error: "server_error" };
  }
}

/**
 * Rotate the visitor access code (admin-guarded). Hashes the new code and bumps
 * accessCodeVersion in one update — the bump invalidates every live visitor
 * cookie, so all current visitors fall back to the gate immediately. Saving a code
 * also turns the gate ON (preserving the heading): setting a code is how you make
 * the store private, so it shouldn't take a second step. Turn it off again with
 * setGateSettingsAction without losing the code.
 */
export async function rotateAccessCodeAction(
  newCode: string,
): Promise<{ ok: true; codeVersion: number } | { error: string }> {
  try {
    const tenantId = await requireStorefrontAdmin();
    if (!tenantId) return { error: "Not signed in to the store admin." };
    if (isDemoMode()) return { error: "Access gate isn't available in demo mode." };

    const code = (newCode ?? "").trim();
    if (code.length < 6) return { error: "Access code must be at least 6 characters." };

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        accessCodeHash: hashPassword(code),
        accessCodeVersion: { increment: 1 },
      },
      select: { accessCodeVersion: true },
    });

    // Auto-enable the gate (keep the existing heading). Setting a code = "make my
    // store private", so the gate goes live without a separate toggle.
    const branding = await prisma.branding.findUnique({
      where: { tenantId },
      select: { config: true },
    });
    const current = (branding?.config ?? {}) as Record<string, unknown>;
    const prevGate = (current.accessGate ?? {}) as { heading?: string };
    const heading =
      typeof prevGate.heading === "string" && prevGate.heading.trim()
        ? prevGate.heading.trim()
        : "Enter access code";
    const config = { ...current, accessGate: { enabled: true, heading } };
    await prisma.branding.upsert({
      where: { tenantId },
      update: { config: config as Prisma.InputJsonValue },
      create: { tenantId, config: config as Prisma.InputJsonValue },
    });

    const slug = await getTenantSlug();
    revalidateTenant(tenantId, slug);
    return { ok: true, codeVersion: updated.accessCodeVersion };
  } catch (err) {
    console.error("rotateAccessCodeAction", (err as Error)?.message);
    return { error: "server_error" };
  }
}
