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
import { requireStaffPermission, getStorefrontAdminActor, requireStoreOwner } from "@/lib/auth/staff-guard";
import { isValidEmail } from "@/lib/analytics/events";
import { hashPassword, verifyPassword } from "@/lib/auth/password-hash";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { normalizeHeroLinks } from "@/lib/storefront/hero-links";
import { normalizeBanner } from "@/lib/storefront/banner";
import { normalizeNoticeModal } from "@/lib/storefront/notice-modal";
import { resolveProtocolImages } from "@/lib/storefront/protocol-images";
import type { Category, Courier, PaymentMethod, Protocol, ShippingLocation } from "@/storefront/types";
import { normalizeCheckoutRules } from "@/lib/storefront/checkout-rules";
import { normalizeAdminFee } from "@/lib/storefront/admin-fee";
import { normalizePromoCodes } from "@/lib/storefront/promo";
import { DEFAULT_CARD_DESIGN, type CardDesign, type CardTemplate } from "@/storefront/cardDesign";

export type ActionResult = { ok: true } | { error: string };

/** Returned when a store-admin action is called without a valid session OR
 *  without the per-module permission that gates it (staff enforcement). */
const NO_ACCESS = "You don't have permission to do that.";

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

/**
 * Change the storefront admin password. Requires a valid session, re-verifies the
 * current password (so a hijacked open session can't silently rotate the
 * credential), then persists the new one into `branding.config.adminPassword`
 * (read-modify-write, mirroring the save* actions). Passwords are stored as the
 * plaintext the owner typed — same scheme signInStorefrontAdminAction checks.
 */
export async function changeStorefrontAdminPasswordAction(
  currentPassword: string,
  newPassword: string,
): Promise<ActionResult> {
  const ctx = await getStorefrontAdminActor();
  if (!ctx) return { error: "Not signed in to the store admin." };
  const tenantId = ctx.tenantId;

  const next = (newPassword ?? "").trim();
  if (next.length < 6) {
    return { error: "New password must be at least 6 characters." };
  }

  // Staff change their OWN credential (StorefrontStaff.passwordHash); the owner
  // changes the shared owner password in branding.config. Account Settings →
  // "change password" routes here for both.
  if (ctx.actor.kind === "staff") {
    const staff = await prisma.storefrontStaff.findFirst({
      where: { id: ctx.actor.id, tenantId },
      select: { passwordHash: true },
    });
    if (!staff) return { error: "Staff member not found." };
    if (!verifyPassword((currentPassword ?? "").trim(), staff.passwordHash)) {
      return { error: "Current password is incorrect." };
    }
    await prisma.storefrontStaff.update({
      where: { id: ctx.actor.id },
      data: { passwordHash: hashPassword(next) },
    });
    return { ok: true };
  }

  const slug = await getTenantSlug();
  const current = await readConfig(tenantId);
  if ((currentPassword ?? "").trim() !== resolvePassword(current)) {
    return { error: "Current password is incorrect." };
  }
  if (next === resolvePassword(current)) {
    return { error: "New password must be different from the current one." };
  }

  const config = { ...current, adminPassword: next };
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
  const ctx = await requireStaffPermission("pay");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

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
  const ctx = await requireStaffPermission("categories");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

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

/** Coerce untrusted client input into clean Courier rows. */
function normalizeCouriers(input: unknown): Courier[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: Courier[] = [];
  for (const c of input.slice(0, 100)) {
    const o = (c ?? {}) as Record<string, unknown>;
    const id = String(o.id ?? "").slice(0, 64).trim();
    const name = String(o.name ?? "").slice(0, 120).trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name,
      trackingUrl: typeof o.trackingUrl === "string" ? o.trackingUrl.slice(0, 300).trim() : "",
      active: o.active !== false,
      // COD/no-location couriers (Lalamove, Maxim) need no shipping location or
      // fee — only persist the flag when set so legacy rows stay unchanged.
      ...(o.noLocation === true ? { noLocation: true } : {}),
    });
  }
  return out;
}

/**
 * Persist the store's couriers into the shared `branding.config` blob
 * (read-modify-write, mirroring saveCategoriesAction so it never clobbers the
 * rest of the storefront Brand config). The storefront reads couriers from
 * `branding.config` server-side on every render, so the configured list feeds
 * the order-detail courier dropdown on every device — not only the editing
 * browser.
 */
export async function saveCouriersAction(couriers: unknown): Promise<ActionResult> {
  const ctx = await requireStaffPermission("couriers");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

  const slug = await getTenantSlug();
  const normalized = normalizeCouriers(couriers);
  const current = await readConfig(tenantId);
  const config = { ...current, couriers: normalized };

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

/** Coerce untrusted client input into clean ShippingLocation rows. Each row
 *  carries the courier it belongs to (courierId); blank when unassigned. */
function normalizeShippingLocations(input: unknown): ShippingLocation[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: ShippingLocation[] = [];
  for (const l of input.slice(0, 500)) {
    const o = (l ?? {}) as Record<string, unknown>;
    const id = String(o.id ?? "").slice(0, 64).trim();
    const code = String(o.code ?? "").slice(0, 64).trim();
    const name = String(o.name ?? "").slice(0, 120).trim();
    if (!id || !code || !name || seen.has(id)) continue;
    seen.add(id);
    // Price is OPTIONAL: a blank/non-numeric value means "no per-location fee"
    // (the location is a label only — e.g. the store charges a flat fee instead).
    // Store it as undefined in that case so checkout shows "Free" rather than ₱0.
    const hasPrice =
      o.price !== "" && o.price !== null && o.price !== undefined && Number.isFinite(Number(o.price));
    out.push({
      id,
      courierId: String(o.courierId ?? "").slice(0, 64).trim(),
      code,
      name,
      ...(hasPrice ? { price: Math.max(0, Number(o.price)) } : {}),
      active: o.active !== false,
    });
  }
  return out;
}

/**
 * Persist the store's shipping locations into the shared `branding.config` blob
 * (read-modify-write, mirroring saveCouriersAction so it never clobbers the rest
 * of the storefront Brand config). The storefront reads them from
 * `branding.config` server-side on every render, so the configured set — and
 * each location's courier link + fee — feeds the checkout courier/location
 * selectors on every device, not only the editing browser.
 */
export async function saveShippingLocationsAction(locations: unknown): Promise<ActionResult> {
  const ctx = await requireStaffPermission("shipping");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

  const slug = await getTenantSlug();
  const normalized = normalizeShippingLocations(locations);
  const current = await readConfig(tenantId);
  const config = { ...current, shippingLocations: normalized };

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
 * Persist the store's discount / promo codes into the shared `branding.config`
 * blob (read-modify-write, mirroring saveCouriersAction so it never clobbers the
 * rest of the storefront Brand config). The storefront reads promo codes from
 * `branding.config` server-side on every render, so the owner's codes are offered
 * to every customer on every device — not only the editing browser — and
 * placeStorefrontOrderAction re-derives each discount from this same stored set.
 */
export async function savePromoCodesAction(codes: unknown): Promise<ActionResult> {
  const ctx = await requireStaffPermission("promo");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

  const slug = await getTenantSlug();
  const promoCodes = normalizePromoCodes(codes);
  const current = await readConfig(tenantId);
  const config = { ...current, promoCodes };

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

// ── Order notifications (store-owner "you received an order" email) ───────────

/** Coerce untrusted client input into a clean orderNotifications slice. A blank
 *  email is only allowed while disabled; enabling requires a valid address so we
 *  never persist an "on but unreachable" state that silently drops alerts. */
function normalizeOrderNotifications(input: unknown): { enabled: boolean; email: string } | { error: string } {
  const o = (input ?? {}) as Record<string, unknown>;
  const enabled = o.enabled === true;
  const email = typeof o.email === "string" ? o.email.trim() : "";
  if (enabled && !isValidEmail(email)) {
    return { error: "Enter a valid email address to receive order alerts." };
  }
  return { enabled, email };
}

/**
 * Persist the store owner's order-alert recipient into branding.config
 * (read-modify-write, mirroring savePromoCodesAction). OWNER-ONLY — the alert
 * routes order emails to a chosen inbox, so staff (even with grants) can't
 * redirect it. The storefront never reads this; only placeStorefrontOrderAction
 * does, server-side, when a new order is created.
 */
export async function saveOrderNotificationsAction(input: unknown): Promise<ActionResult> {
  const tenantId = await requireStoreOwner();
  if (!tenantId) return { error: NO_ACCESS };

  const normalized = normalizeOrderNotifications(input);
  if ("error" in normalized) return normalized;

  const slug = await getTenantSlug();
  const current = await readConfig(tenantId);
  const config = { ...current, orderNotifications: normalized };

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
 * Persist the store owner's notice-modal config (the per-tenant disclaimer that
 * pops up on every storefront visit) into branding.config.noticeModal
 * (read-modify-write, mirroring saveOrderNotificationsAction). OWNER-ONLY.
 *
 * The super-admin grant (operatorEnabled) is NEVER writable here: it is re-read
 * from the stored config and forced back onto the payload, so the owner can only
 * flip their own `enabled` toggle and edit copy. When the operator has not
 * granted the feature the action refuses outright — matching the hidden view.
 */
export async function saveNoticeModalAction(input: unknown): Promise<ActionResult> {
  const tenantId = await requireStoreOwner();
  if (!tenantId) return { error: NO_ACCESS };

  const slug = await getTenantSlug();
  const current = await readConfig(tenantId);

  // The operator grant is the source of truth for availability. Read it from the
  // stored config; the owner can neither set nor bypass it from the client.
  const storedNotice = (current.noticeModal ?? {}) as Record<string, unknown>;
  const operatorEnabled = storedNotice.operatorEnabled === true;
  if (!operatorEnabled) return { error: NO_ACCESS };

  const owned = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  // Force the server-held grant on top of whatever the client sent.
  const normalized = normalizeNoticeModal({ ...owned, operatorEnabled });
  const config = { ...current, noticeModal: normalized };

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

// ── Hero copy (homepage hero section) ────────────────────────────────────────

/**
 * The editable hero copy fields. These are the SAME `hero*` keys the platform
 * operator edits in the Branding editor's Hero tab — the store owner can now
 * edit the text themselves. Only the copy is exposed here (chip, headline lines,
 * tagline, CTA labels); layout/typography/variant stay operator-controlled.
 */
const HERO_COPY_FIELDS = [
  "heroChipLabel",
  "heroLine1",
  "heroLine2",
  "heroSub",
  "heroCta1",
  "heroCta2",
] as const;

/** Coerce untrusted client input into clean hero copy strings (trimmed, capped). */
function normalizeHeroContent(input: unknown): Record<string, string> {
  const o = (input ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of HERO_COPY_FIELDS) {
    // Headline lines and CTA labels are short; the tagline gets more room.
    const cap = key === "heroSub" ? 400 : 120;
    out[key] = String(o[key] ?? "").slice(0, cap).trim();
  }
  return out;
}

// Hero CTA link normalization (whitelist + http(s)-only URL sanitizing) lives in
// the shared pure core so the storefront resolves the same config it was saved
// with. See @/lib/storefront/hero-links (covered by npm run test:hero-links).

/**
 * Persist the storefront's hero copy into the shared `branding.config` blob
 * (read-modify-write, mirroring savePaymentMethodsAction so it never clobbers
 * the rest of the storefront Brand config). The storefront reads the hero text
 * from `branding.config` server-side on every render, so the owner's edits show
 * on every device/customer — not only the editing browser.
 */
export async function saveHeroContentAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireStaffPermission("hero");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

  const slug = await getTenantSlug();
  const hero = normalizeHeroContent(input);
  const links = normalizeHeroLinks(input);
  const current = await readConfig(tenantId);
  const config = { ...current, ...hero, ...links };

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

// ── Announcement Banner ──────────────────────────────────────────────────────

/**
 * Persist the storefront's announcement banner (the promo bar under the header)
 * into the shared `branding.config` blob (read-modify-write, mirroring
 * saveHeroContentAction so it never clobbers the rest of the storefront Brand
 * config). The untrusted input is coerced through normalizeBanner FIRST, so a
 * stored slide can never carry a javascript:/data: link or a color that breaks
 * out of an inline style. The storefront reads `config.banner` server-side on
 * every render, so the owner's edits show on every device — not only the
 * editing browser.
 */
export async function saveBannerAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireStaffPermission("banner");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

  const slug = await getTenantSlug();
  const banner = normalizeBanner(input);
  const current = await readConfig(tenantId);
  const config = { ...current, banner };

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

// ── Smart Cart & Checkout Logic ──────────────────────────────────────────────

/**
 * Persist the storefront's cart/checkout rules into the shared `branding.config`
 * blob (read-modify-write, mirroring savePaymentMethodsAction so it never
 * clobbers the rest of the storefront Brand config). The storefront reads the
 * rules from `branding.config` server-side on every render, and
 * placeStorefrontOrderAction re-validates against the same stored value, so the
 * server enforces exactly what the owner configured.
 */
export async function saveCheckoutRulesAction(rules: unknown): Promise<ActionResult> {
  const ctx = await requireStaffPermission("checkout");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

  const slug = await getTenantSlug();
  const checkoutRules = normalizeCheckoutRules(rules);
  const current = await readConfig(tenantId);
  const config = { ...current, checkoutRules };

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

// ── Admin / service / shipping fee ───────────────────────────────────────────

/**
 * Persist the storefront's checkout fee into the shared `branding.config` blob
 * (read-modify-write, mirroring saveCheckoutRulesAction so it never clobbers the
 * rest of the Brand config). This is the SAME `adminFee` key the platform
 * operator edits in the tenant settings — the store owner can now configure it
 * themselves (toggle, label, amount). The label is free text, so a store that
 * prefers a single flat shipping charge can label it "Shipping fee" instead of
 * "Admin fee". Checkout and placeStorefrontOrderAction read this same stored
 * value, so the server charges exactly what the owner configured.
 */
export async function saveStoreAdminFeeAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireStaffPermission("fee");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

  const slug = await getTenantSlug();
  const adminFee = normalizeAdminFee(input);
  const current = await readConfig(tenantId);
  const config = { ...current, adminFee };

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
  const ctx = await requireStaffPermission("reseller");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;
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
  const ctx = await requireStaffPermission("reseller");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

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
  const ctx = await requireStaffPermission("design");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

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
  const ctx = await requireStaffPermission("design");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

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
    // Canonicalize to a clean, capped image list (drops blanks, falls back to
    // the legacy single `image`); `image` mirrors the first entry so any legacy
    // reader still resolves a value.
    const images = resolveProtocolImages({ images: o.images, image: o.image } as Protocol);
    return {
      category: String(o.category ?? "").slice(0, 120),
      name: String(o.name ?? "").slice(0, 200),
      dosage: String(o.dosage ?? "").slice(0, 200),
      frequency: String(o.frequency ?? "").slice(0, 200),
      duration: String(o.duration ?? "").slice(0, 200),
      notes,
      storage: String(o.storage ?? "").slice(0, 500),
      images,
      image: images[0] ?? "",
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
  const ctx = await requireStaffPermission("proto");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

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
