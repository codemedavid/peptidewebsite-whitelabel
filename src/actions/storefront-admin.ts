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
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import type { Category, PaymentMethod, Protocol } from "@/storefront/types";
import { DEFAULT_CARD_DESIGN, type CardDesign, type CardTemplate } from "@/storefront/cardDesign";

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

/**
 * Coerce untrusted client input into clean Category rows, and always guarantee
 * the synthetic "all" tab is present exactly once and first (the storefront's
 * "All Products" filter). Duplicate ids are dropped, blank labels fall back to
 * the id so a row can never render empty.
 */
function normalizeCategories(input: unknown): Category[] {
  const rows = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: Category[] = [];
  for (const c of rows.slice(0, 200)) {
    const o = (c ?? {}) as Record<string, unknown>;
    const id = String(o.id ?? "").slice(0, 64).trim();
    if (!id || id === "all" || seen.has(id)) continue;
    seen.add(id);
    const label = String(o.label ?? "").slice(0, 120).trim() || id;
    out.push({ id, label });
  }
  return [{ id: "all", label: "All Products" }, ...out];
}

/**
 * Persist the storefront's product categories into the shared `branding.config`
 * blob (read-modify-write, mirroring saveProtocolsAction so it never clobbers
 * the rest of the storefront Brand config). The storefront reads categories from
 * `branding.config` server-side on every render, so the owner's categories show
 * on every device/customer and feed the product form's dropdown — fixing the bug
 * where categories lived only in the editing browser's localStorage.
 */
export async function saveCategoriesAction(categories: unknown): Promise<ActionResult> {
  const tenantId = await requireStorefrontAdmin();
  if (!tenantId) return { error: "Not signed in to the store admin." };

  const slug = await getTenantSlug();
  const normalized = normalizeCategories(categories);
  const current = await readConfig(tenantId);
  const config = { ...current, categories: normalized };

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

// ── Reseller / merchant portal ────────────────────────────────────────────────

// Whether the reseller portal is available is a PLATFORM entitlement
// (FEATURES.STORE_RESELLER_PORTAL), toggled per tenant by the operator in
// admin → Features. The store owner only controls the access code (+ per-product
// wholesale prices). The storefront shows #merchant when entitled AND a code is
// set (see (storefront)/page.tsx); the code is validated server-side here.
export type ResellerSettings = {
  /** Operator entitlement — the store owner can't change this, only see it. */
  available: boolean;
  code: string;
};

/**
 * The reseller portal settings for the current tenant (store-admin only — it
 * returns the access code, so it must never be exposed to the public). Reads the
 * `resellerAccessCode` from branding.config plus the platform entitlement so the
 * owner can see whether their provider has enabled the feature.
 */
export async function getResellerSettingsAction(): Promise<ResellerSettings | { error: string }> {
  const tenantId = await requireStorefrontAdmin();
  if (!tenantId) return { error: "Not signed in to the store admin." };
  const config = await readConfig(tenantId);
  return {
    available: await hasFeature(tenantId, FEATURES.STORE_RESELLER_PORTAL),
    code: typeof config.resellerAccessCode === "string" ? config.resellerAccessCode : "",
  };
}

/**
 * Persist the reseller access code into the shared `branding.config` blob
 * (read-modify-write, mirroring the other save* actions so it never clobbers the
 * rest of the Brand config). The on/off is the operator's entitlement, not stored
 * here; the storefront goes live once this code is set AND the tenant is entitled.
 */
export async function saveResellerSettingsAction(input: unknown): Promise<ActionResult> {
  const tenantId = await requireStorefrontAdmin();
  if (!tenantId) return { error: "Not signed in to the store admin." };

  const o = (input ?? {}) as Record<string, unknown>;
  const code = String(o.code ?? "").slice(0, 120).trim();

  const slug = await getTenantSlug();
  const current = await readConfig(tenantId);
  const config = { ...current, resellerAccessCode: code };

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

/**
 * Verify a reseller access code (server-side) for the current tenant. Public —
 * no admin session — so the wholesale price list can be unlocked by resellers.
 * Returns ok only when the tenant is ENTITLED to the reseller portal (operator
 * toggle) AND the (case-insensitive) code matches the one in branding.config. The
 * code is compared on the server and never shipped to the client.
 */
export async function verifyResellerCodeAction(code: string): Promise<ActionResult> {
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return { error: "Could not resolve this store." };

  if (!(await hasFeature(tenantId, FEATURES.STORE_RESELLER_PORTAL))) {
    return { error: "Reseller access isn't available." };
  }

  const config = await readConfig(tenantId);
  const expected = typeof config.resellerAccessCode === "string" ? config.resellerAccessCode.trim() : "";
  if (!expected) return { error: "Reseller access isn't available." };

  if ((code ?? "").trim().toLowerCase() !== expected.toLowerCase()) {
    return { error: "Incorrect access code." };
  }
  return { ok: true };
}

// ── Card Studio (product card design) ────────────────────────────────────────

const CD_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** A hex color or "" (inherit the theme); anything else collapses to "". */
function cdColor(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  return CD_HEX.test(s) ? s : "";
}

/** One of the allowed enum values, else the default. */
function cdEnum<T extends string>(v: unknown, allowed: readonly T[], dflt: T): T {
  return allowed.includes(v as T) ? (v as T) : dflt;
}

function cdNum(v: unknown, min: number, max: number, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : dflt;
}

/** Coerce an untrusted client payload into a clean CardDesign. */
function normalizeCardDesign(input: unknown): CardDesign {
  const o = (input ?? {}) as Record<string, unknown>;
  const d = DEFAULT_CARD_DESIGN;
  return {
    preset: String(o.preset ?? "custom").slice(0, 64),
    layout: cdEnum(o.layout, ["vertical", "horizontal", "overlay"] as const, d.layout),
    surface: cdEnum(o.surface, ["flat", "glass", "neumorphic", "gradient"] as const, d.surface),
    borderEnabled: o.borderEnabled !== false,
    borderColor: cdColor(o.borderColor),
    borderWidth: cdNum(o.borderWidth, 1, 8, d.borderWidth),
    borderStyle: cdEnum(o.borderStyle, ["solid", "dashed", "dotted"] as const, d.borderStyle),
    radius: cdNum(o.radius, 0, 40, d.radius),
    background: cdColor(o.background),
    background2: cdColor(o.background2),
    textColor: cdColor(o.textColor),
    shadow: cdEnum(o.shadow, ["none", "sm", "md", "lg", "glow"] as const, d.shadow),
    hover: cdEnum(o.hover, ["none", "lift", "grow", "glow", "frame", "tilt"] as const, d.hover),
    titleFont: cdEnum(o.titleFont, ["display", "body"] as const, d.titleFont),
    titleWeight: (Math.round(cdNum(o.titleWeight, 400, 800, d.titleWeight) / 100) * 100) as CardDesign["titleWeight"],
    titleSize: cdEnum(o.titleSize, ["sm", "md", "lg"] as const, d.titleSize),
    titleCase: cdEnum(o.titleCase, ["none", "uppercase"] as const, d.titleCase),
    showDesc: o.showDesc !== false,
    buttonStyle: cdEnum(o.buttonStyle, ["gradient", "solid", "outline", "soft", "contrast"] as const, d.buttonStyle),
    buttonColor: cdColor(o.buttonColor),
    buttonShape: cdEnum(o.buttonShape, ["pill", "rounded", "square"] as const, d.buttonShape),
    badgeStyle: cdEnum(o.badgeStyle, ["solid", "soft", "outline", "mono", "hidden"] as const, d.badgeStyle),
    imageRatio: cdEnum(o.imageRatio, ["square", "landscape", "portrait", "wide"] as const, d.imageRatio),
    mediaInset: o.mediaInset === true,
    spacing: cdEnum(o.spacing, ["compact", "cozy", "roomy"] as const, d.spacing),
  };
}

/**
 * Persist the storefront's product card design into the shared `branding.config`
 * blob (read-modify-write, mirroring savePaymentMethodsAction so it never
 * clobbers the rest of the storefront Brand config). Pass null to reset the
 * tenant to the classic card (the key is removed, not stored as null, so the
 * storefront's "absent → classic" fallback applies).
 */
export async function saveCardDesignAction(design: unknown): Promise<ActionResult> {
  const tenantId = await requireStorefrontAdmin();
  if (!tenantId) return { error: "Not signed in to the store admin." };

  const slug = await getTenantSlug();
  const current = await readConfig(tenantId);
  const config: Record<string, unknown> = { ...current };
  if (design === null || design === undefined) {
    delete config.cardDesign;
  } else {
    config.cardDesign = normalizeCardDesign(design);
  }

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

/** Coerce untrusted client input into clean CardTemplate rows. */
function normalizeCardTemplates(input: unknown): CardTemplate[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 30).map((t, i) => {
    const o = (t ?? {}) as Record<string, unknown>;
    return {
      id: String(o.id ?? `ct${i + 1}`).slice(0, 64),
      name: String(o.name ?? "").slice(0, 80).trim() || `Template ${i + 1}`,
      design: normalizeCardDesign(o.design),
    };
  });
}

/**
 * Persist the owner's saved card design templates ("Save as Template" in the
 * Card Studio) into branding.config — same read-modify-write pattern as
 * saveCardDesignAction so templates and the applied design can't clobber each
 * other or the rest of the Brand config.
 */
export async function saveCardTemplatesAction(templates: unknown): Promise<ActionResult> {
  const tenantId = await requireStorefrontAdmin();
  if (!tenantId) return { error: "Not signed in to the store admin." };

  const slug = await getTenantSlug();
  const current = await readConfig(tenantId);
  const config = { ...current, cardTemplates: normalizeCardTemplates(templates) };

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

/** Coerce untrusted client input into clean Protocol rows. */
function normalizeProtocols(input: unknown): Protocol[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 200).map((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    const notes = Array.isArray(o.notes)
      ? o.notes.map((n) => String(n ?? "").slice(0, 500)).filter(Boolean).slice(0, 50)
      : [];
    return {
      category: String(o.category ?? "").slice(0, 120),
      name: String(o.name ?? "").slice(0, 200),
      dosage: String(o.dosage ?? "").slice(0, 200),
      frequency: String(o.frequency ?? "").slice(0, 200),
      duration: String(o.duration ?? "").slice(0, 200),
      notes,
      storage: String(o.storage ?? "").slice(0, 500),
      image: typeof o.image === "string" ? o.image : "",
      mode: o.mode === "image" ? "image" : "details",
    };
  });
}

/**
 * Persist the storefront's protocol guide into the shared `branding.config`
 * blob (read-modify-write, mirroring savePaymentMethodsAction so it never
 * clobbers the rest of the storefront Brand config). The storefront reads
 * protocols from `branding.config` server-side on every render, so the owner's
 * edits show on every device/customer — fixing the bug where the public
 * protocol page fell back to the seed samples on other devices.
 */
export async function saveProtocolsAction(protocols: unknown): Promise<ActionResult> {
  const tenantId = await requireStorefrontAdmin();
  if (!tenantId) return { error: "Not signed in to the store admin." };

  const slug = await getTenantSlug();
  const normalized = normalizeProtocols(protocols);
  const current = await readConfig(tenantId);
  const config = { ...current, protocols: normalized };

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
