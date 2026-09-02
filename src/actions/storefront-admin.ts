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
import { isBusinessExclusiveLocked } from "@/lib/trial/trial-info";
import { normalizeHeroLinks } from "@/lib/storefront/hero-links";
import { normalizeHeroContent } from "@/lib/storefront/hero-content";
import { normalizeHeroMedia } from "@/lib/storefront/hero-media";
import { normalizeBanner } from "@/lib/storefront/banner";
import { normalizeFaqGroups } from "@/lib/storefront/faq";
import { normalizeCoaReports } from "@/lib/storefront/coa";
import { normalizeReviews } from "@/lib/storefront/reviews";
import { normalizeNoticeModal } from "@/lib/storefront/notice-modal";
import { normalizeTrackNote } from "@/lib/storefront/track-note";
import { normalizeSortCategories } from "@/lib/storefront/sort-categories";
import { normalizeStoreStatus } from "@/lib/storefront/store-status";
import { normalizeCurrency } from "@/lib/storefront/currency";
import { resolveProtocolImages } from "@/lib/storefront/protocol-images";
import type { Category, Courier, PaymentMethod, Protocol, ShippingLocation } from "@/storefront/types";
import { normalizeCheckoutRules } from "@/lib/storefront/checkout-rules";
import { normalizeGroupBuyRules } from "@/lib/storefront/group-buy-rules";
import { normalizeAdminFee } from "@/lib/storefront/admin-fee";
import { normalizePromoCodes } from "@/lib/storefront/promo";
import { DEFAULT_CARD_DESIGN, type CardDesign, type CardTemplate } from "@/storefront/cardDesign";
import {
  readResellerCredential,
  hasResellerCode,
  verifyResellerCode,
  nextCredential,
} from "@/lib/storefront/reseller-access";
import { readResellerPageCopy, readResellerPageCopyPatch } from "@/lib/storefront/reseller-page-copy";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";
import { resolveResellerCaps } from "@/lib/storefront/reseller-caps";
import { safeExternalUrl } from "@/lib/storefront/courier-booking";
import { saveResellerSession, clearResellerSession } from "@/lib/auth/reseller-session";

export type ActionResult = { ok: true } | { error: string };

/** Returned when a store-admin action is called without a valid session OR
 *  without the per-module permission that gates it (staff enforcement). */
const NO_ACCESS = "You don't have permission to do that.";

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

// NOTE: the password-only `signInStorefrontAdminAction` was removed. Every
// `#admin` sign-in now goes through signInStoreAdminAction (actions/storefront-staff.ts),
// which requires an email AND a password and verifies both against a scrypt
// hash. There is no default password and no password-only path any more.

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
 * credential), then persists the new one as a scrypt hash.
 *
 * Staff rotate their own StorefrontStaff.passwordHash; the owner rotates
 * Tenant.storeAdminPasswordHash. The owner's sign-in EMAIL is not editable here
 * — the super admin owns it in tenant settings.
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

  // The OWNER's credential lives on the Tenant row (storeAdminPasswordHash),
  // never in branding.config — that blob is spread into the public client
  // `brand`, so a password kept there shipped to every visitor.
  const slug = await getTenantSlug();

  if (isDemoMode()) {
    const current = await readConfig(tenantId);
    const stored = typeof current.adminPasswordHash === "string" ? current.adminPasswordHash : "";
    if (!stored || !verifyPassword((currentPassword ?? "").trim(), stored)) {
      return { error: "Current password is incorrect." };
    }
    saveDemoBranding(tenantId, { config: { ...current, adminPasswordHash: hashPassword(next) } });
    revalidateTenant(tenantId, slug);
    return { ok: true };
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { storeAdminPasswordHash: true },
  });
  // No stored credential means the owner cannot prove who they are; the super
  // admin sets it in tenant settings. Fail closed rather than letting anyone
  // claim the account by "changing" a password that was never set.
  if (!tenant?.storeAdminPasswordHash) {
    return { error: "No sign-in is set for this store yet. Contact your provider." };
  }
  if (!verifyPassword((currentPassword ?? "").trim(), tenant.storeAdminPasswordHash)) {
    return { error: "Current password is incorrect." };
  }
  if (verifyPassword(next, tenant.storeAdminPasswordHash)) {
    return { error: "New password must be different from the current one." };
  }

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { storeAdminPasswordHash: hashPassword(next) },
  });

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
      // The owner's QR PH tag — only persisted when set, so every existing
      // method's stored shape is byte-identical and no store starts charging.
      ...(o.qrph === true ? { qrph: true } : {}),
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

/**
 * Persist the owner's catalog sort menu into `branding.config.sortCategories`
 * (read-modify-write, same shape as saveCategoriesAction so it never clobbers
 * the rest of the Brand config).
 *
 * The client list is re-normalized HERE, not trusted: normalizeSortCategories is
 * the same pure function the storefront reads through, so a tampered or stale
 * editor cannot store an unknown `kind`, a duplicate id, or an empty menu that
 * would leave the public catalog with a broken sort dropdown.
 */
export async function saveSortCategoriesAction(categories: unknown): Promise<ActionResult> {
  const ctx = await requireStaffPermission("sort-categories");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

  const slug = await getTenantSlug();
  const normalized = normalizeSortCategories(
    Array.isArray(categories) ? categories.slice(0, 200) : categories,
  );
  const current = await readConfig(tenantId);
  const config = { ...current, sortCategories: normalized };

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
 * Persist the owner's OPEN/CLOSED switch into branding.config.storeStatus
 * (read-modify-write, same shape as saveSortCategoriesAction so it never
 * clobbers the rest of the Brand config).
 *
 * Grantable to staff ("store-status"), because deciding to stop taking orders
 * for the afternoon is day-to-day shop management, not an ownership decision —
 * the owner chooses who gets it.
 *
 * The payload is re-normalized HERE, not trusted: normalizeStoreStatus is the
 * same pure function the storefront and the checkout read through, so a stale or
 * tampered editor cannot store a headline/message longer than the caps or an
 * `open` value the rest of the system would read differently.
 */
export async function saveStoreStatusAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireStaffPermission("store-status");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

  const slug = await getTenantSlug();
  const normalized = normalizeStoreStatus(input);
  const current = await readConfig(tenantId);
  const config = { ...current, storeStatus: normalized };

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
 * Switch the currency the store trades in.
 *
 * Three places store a currency and all three must move together, or the shop
 * renders two currencies at once:
 *
 *   branding.config.currency — the SYMBOL every storefront surface reads
 *   StoreSettings.currency   — the ISO CODE, the tenant-level record
 *   Product.currency + metadata.currencySymbol — captured per row at creation
 *
 * That last one is why this is an action and not a one-field form. A product row
 * keeps the symbol it was created with, so without the re-stamp a store that
 * switched to riyals would keep showing pesos on every card made before the
 * switch. Prices are NOT converted — the numbers are the owner's to decide, and
 * silently converting them would misprice a whole catalog.
 *
 * The input is re-normalized here rather than trusted: normalizeCurrency is the
 * same pure function the storefront reads through, so a tampered form post can't
 * store a value the rest of the system would interpret differently.
 */
export async function saveCurrencyAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireStaffPermission("currency");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

  const slug = await getTenantSlug();
  const money = normalizeCurrency(input);
  const current = await readConfig(tenantId);
  const config = { ...current, currency: money.symbol };

  if (isDemoMode()) {
    saveDemoBranding(tenantId, { config });
    revalidateTenant(tenantId, slug);
    return { ok: true };
  }

  await prisma.branding.upsert({
    where: { tenantId },
    update: { config: config as Prisma.InputJsonValue },
    create: { tenantId, config: config as Prisma.InputJsonValue },
  });

  // A custom glyph has no ISO identity, so the code columns keep whatever the
  // store already had rather than being filled with something invented.
  const iso = money.code;
  if (iso) {
    await prisma.tenantSettings.upsert({
      where: { tenantId },
      update: { currency: iso },
      create: { tenantId, currency: iso },
    });
    await prisma.product.updateMany({ where: { tenantId }, data: { currency: iso } });
  }

  // The display symbol lives inside each row's metadata JSON, which updateMany
  // cannot reach into — so the rows are read and rewritten individually. A
  // tenant's catalog is small (tens to low hundreds), so this stays cheap.
  const rows = await prisma.product.findMany({
    where: { tenantId },
    select: { id: true, metadata: true },
  });
  for (const row of rows) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    if (meta.currencySymbol === money.symbol) continue;
    await prisma.product.update({
      where: { id: row.id },
      data: { metadata: { ...meta, currencySymbol: money.symbol } as Prisma.InputJsonValue },
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
      // Booking/delivery form link. Scheme-validated on the way in because this
      // one is rendered as a link at checkout (trackingUrl above never is), so
      // a javascript: URL saved here would fire for every customer. Only
      // persisted when a safe URL survives, keeping legacy rows unchanged.
      ...(safeExternalUrl(o.bookingUrl)
        ? { bookingUrl: safeExternalUrl(o.bookingUrl).slice(0, 500) }
        : {}),
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

/**
 * Persist the store owner's track-order delivery note (the informational card on
 * the Track Order page, under the order-number search box) into
 * branding.config.trackNote (read-modify-write, mirroring saveNoticeModalAction).
 * OWNER-ONLY. Business/Automated exclusive since the trial system
 * (FEATURES.STORE_TRACK_NOTE, operator-grantable for legacy Starter stores);
 * the payload is normalized and written as-is once the lock check passes.
 */
export async function saveTrackNoteAction(input: unknown): Promise<ActionResult> {
  const tenantId = await requireStoreOwner();
  if (!tenantId) return { error: NO_ACCESS };

  // Business/Automated exclusive (trial system, FEATURES.STORE_TRACK_NOTE):
  // locked during an active trial and whenever the entitlement is revoked.
  if (await isBusinessExclusiveLocked(tenantId, FEATURES.STORE_TRACK_NOTE)) {
    return { error: "Delivery Note is a Business feature — upgrade to unlock it." };
  }

  const slug = await getTenantSlug();
  const current = await readConfig(tenantId);

  const normalized = normalizeTrackNote(input);
  const config = { ...current, trackNote: normalized };

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
  // Image-hero config (mode, banner, ratio/focus, overlay + scrim, link target).
  // Coerced through the same pure core the storefront renders from, so a stored
  // banner can never carry an unsafe src or a javascript: click target.
  const heroMedia = normalizeHeroMedia(input);
  const current = await readConfig(tenantId);
  const config = { ...current, ...hero, ...links, heroMedia };

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

/**
 * Persist the Group Buy Rules engine (incl. Order Ratio Control) into the shared
 * branding.config blob (read-modify-write, mirroring saveCheckoutRulesAction so
 * it never clobbers the rest of the Brand config). Gated on the "groupbuy" staff
 * permission; page.tsx additionally strips brand.groupBuyRules when the tenant
 * lacks the GB_RULES entitlement, so a revoked feature both hides the editor and
 * stops the saved rules from constraining the cart.
 */
export async function saveGroupBuyRulesAction(rules: unknown): Promise<ActionResult> {
  const ctx = await requireStaffPermission("groupbuy");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

  const slug = await getTenantSlug();
  const groupBuyRules = normalizeGroupBuyRules(rules);
  const current = await readConfig(tenantId);
  const config = { ...current, groupBuyRules };

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

  // Business/Automated exclusive (trial system): locked during an active trial
  // and whenever the entitlement is revoked — the UI tile mirrors this lock,
  // but a stale/forged client must not write through it.
  if (await isBusinessExclusiveLocked(tenantId, FEATURES.STORE_ADMIN_FEE)) {
    return { error: "Checkout Fee is a Business feature — upgrade to unlock it." };
  }

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
// (FEATURES.STORE_RESELLER_PORTAL + its .page child), toggled per tenant by the
// operator in admin → Features. The store owner controls the PASSWORD and the
// page copy (+ per-product wholesale prices). The storefront shows the portal
// when entitled AND a password is set (see (storefront)/page.tsx); the password
// is verified server-side here and never leaves the server.
export type ResellerSettings = {
  /** The Reseller parent entitlement — the owner can't change this, only see it. */
  available: boolean;
  /** The reseller PAGE child. Without it the gated portal doesn't render at all. */
  pageAvailable: boolean;
  /** The wholesale-pricing child — MOQ pricing on the regular storefront. */
  wholesaleAvailable: boolean;
  /** Whether a password is currently set. The password ITSELF is never returned:
   *  it is stored as a scrypt hash and cannot be read back, so the admin UI shows
   *  "set / not set" and offers replace + remove rather than an editable value. */
  hasCode: boolean;
  /** Owner-editable gate copy. */
  gateTitle: string;
  gateSub: string;
};

/**
 * The reseller portal settings for the current tenant (store-admin only).
 *
 * Deliberately returns `hasCode` rather than the password. The password used to
 * be stored — and returned — in plaintext, so anyone who reached this action, or
 * any log that captured its response, saw the live wholesale credential. It is a
 * scrypt hash now (lib/storefront/reseller-access.ts), which is one-way: even the
 * owner cannot read their own password back, only replace or remove it.
 */
export async function getResellerSettingsAction(): Promise<ResellerSettings | { error: string }> {
  const ctx = await requireStaffPermission("reseller");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;
  const config = await readConfig(tenantId);
  const caps = await resolveResellerCaps(tenantId);
  const cred = readResellerCredential(config);
  const copy = readResellerPageCopy(config);
  return {
    available: caps.enabled,
    pageAvailable: caps.resellerPage,
    wholesaleAvailable: caps.wholesalePricing,
    hasCode: hasResellerCode(cred),
    gateTitle: copy.gateTitle,
    gateSub: copy.gateSub,
  };
}

/**
 * Persist the reseller password + page copy into the shared `branding.config`
 * blob (read-modify-write, mirroring the other save* actions so it never
 * clobbers the rest of the Brand config).
 *
 * The password is hashed with scrypt before it is stored and the legacy
 * plaintext field is deleted in the same write, so a tenant is fully migrated off
 * plaintext the first time their owner touches this screen. Every save bumps
 * `resellerCodeVersion`, which invalidates every reseller session currently
 * holding the old password — that is what makes changing or removing the
 * password actually revoke access rather than merely change what the next login
 * expects.
 *
 * `code` semantics:
 *   omitted / undefined → keep the existing password (the owner only edited copy)
 *   a non-empty string  → set it as the new password
 *   "" with clear: true → REMOVE the password, re-locking the portal
 */
export async function saveResellerSettingsAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireStaffPermission("reseller");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

  const o = (input ?? {}) as Record<string, unknown>;
  const rawCode = typeof o.code === "string" ? o.code.slice(0, 120).trim() : null;
  const clear = o.clear === true;

  const slug = await getTenantSlug();
  const current = await readConfig(tenantId);
  const cred = readResellerCredential(current);

  // A blank submission is NOT a removal — that has to be asked for explicitly,
  // or an owner who saved the page copy with the (unreadable) password box empty
  // would silently lock every one of their resellers out.
  if (rawCode !== null && !rawCode && !clear) {
    return { error: "Enter a password, or use Remove password to clear it." };
  }
  if (rawCode !== null && rawCode && rawCode.length < 4) {
    return { error: "Use a password of at least 4 characters." };
  }

  const config: Record<string, unknown> = {
    ...current,
    ...readResellerPageCopyPatch(o, current),
  };
  if (clear || rawCode) {
    Object.assign(config, nextCredential(clear ? "" : (rawCode ?? ""), cred));
    // `nextCredential` sets the legacy plaintext key to undefined so it is
    // dropped rather than left beside the new hash; strip it explicitly because
    // an undefined value would otherwise survive into the stored JSON as null.
    delete config.resellerAccessCode;
    if (clear) delete config.resellerAccessCodeHash;
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

/**
 * Verify a reseller password (server-side) for the current tenant and, on
 * success, MINT THE SESSION COOKIE. Public — no admin session — so resellers can
 * unlock the wholesale price list themselves.
 *
 * Three things changed here relative to the original check, all of them
 * load-bearing:
 *
 *  1. It gates on the reseller PAGE child, not just the Reseller parent. The
 *     storefront already hid the page on that child (page.tsx), so verifying
 *     against the parent alone meant this action would happily authenticate
 *     against a page the tenant was not entitled to run.
 *  2. It compares against a scrypt hash (falling back to the legacy plaintext for
 *     tenants who have not re-saved yet) instead of a plaintext string.
 *  3. It sets an httpOnly, tenant-scoped, version-stamped cookie. The unlock used
 *     to be a `sessionStorage` flag in the browser, which decided nothing on the
 *     server — the wholesale prices were already in the page for everyone. The
 *     cookie is what lets the RENDER withhold those prices until the password is
 *     actually presented.
 */
/** Brute-force window for the public reseller code check — the same 15 minutes
 *  the visitor access gate uses. */
const RESELLER_VERIFY_WINDOW_MS = 15 * 60 * 1000;

export async function verifyResellerCodeAction(code: string): Promise<ActionResult> {
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return { error: "Could not resolve this store." };

  const caps = await resolveResellerCaps(tenantId);
  if (!caps.resellerPage) return { error: "Reseller access isn't available." };

  // ~10 attempts / 15 min / IP, exactly as the visitor access gate does
  // (actions/storefront-gate.ts). This endpoint is public and unauthenticated
  // and it guards a wholesale price list; codes are accepted at 4 characters and
  // lowercased before comparison, so the keyspace is small enough to walk.
  // Scoped to tenant AND ip so one store's attacker cannot lock out another's
  // resellers. Checked BEFORE the comparison below: verifyResellerCode runs a
  // synchronous scrypt, so limiting afterwards would still let an attacker burn
  // the event loop at will.
  const ip = await clientIp();
  const limited = rateLimit(`reseller:verify:${tenantId}:${ip}`, 10, RESELLER_VERIFY_WINDOW_MS);
  if (!limited.ok) return { error: "Too many attempts. Try again in a few minutes." };

  const config = await readConfig(tenantId);
  const cred = readResellerCredential(config);
  if (!hasResellerCode(cred)) return { error: "Reseller access isn't available." };

  if (!verifyResellerCode(code ?? "", cred)) {
    return { error: "Incorrect access code." };
  }

  await saveResellerSession(tenantId, cred.version);
  return { ok: true };
}

/** Drop the reseller session (the portal's "Lock" / sign-out). Always succeeds. */
export async function resellerSignOutAction(): Promise<ActionResult> {
  await clearResellerSession();
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

/**
 * Persist the storefront's FAQ groups into the shared `branding.config` blob
 * (read-modify-write, mirroring saveProtocolsAction so it never clobbers the
 * rest of the storefront Brand config). The storefront reads faqGroups from
 * `branding.config` server-side on every render, so the owner's edits show on
 * every device/customer — fixing the bug where FAQ edits lived only in the
 * editing browser's localStorage and "couldn't be saved".
 */
export async function saveFaqAction(groups: unknown): Promise<ActionResult> {
  const ctx = await requireStaffPermission("faq");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

  const slug = await getTenantSlug();
  const normalized = normalizeFaqGroups(groups);
  const current = await readConfig(tenantId);
  const config = { ...current, faqGroups: normalized };

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
 * Persist the storefront's lab reports (COAs) into the shared `branding.config`
 * blob (read-modify-write, mirroring saveProtocolsAction so it never clobbers
 * the rest of the storefront Brand config). The storefront reads coaReports from
 * `branding.config` server-side on every render, so the owner's reports show on
 * every device/customer — fixing the bug where COA edits lived only in the
 * editing browser's localStorage and never reached other devices.
 */
export async function saveCoaReportsAction(reports: unknown): Promise<ActionResult> {
  const ctx = await requireStaffPermission("lab");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

  const slug = await getTenantSlug();
  const normalized = normalizeCoaReports(reports);
  const current = await readConfig(tenantId);
  const config = { ...current, coaReports: normalized };

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
 * Persist the store's customer testimonials.
 *
 * Reviews were the last storefront collection with no server save — they lived
 * only in the editing browser's localStorage, so an owner's real testimonials
 * never reached another device or a single customer. Same shape as
 * saveCoaReportsAction: staff-gated, sanitized at the boundary, written to
 * branding.config.
 */
export async function saveReviewsAction(reviews: unknown): Promise<ActionResult> {
  const ctx = await requireStaffPermission("reviews");
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

  const slug = await getTenantSlug();
  const normalized = normalizeReviews(reviews);
  const current = await readConfig(tenantId);
  const config = { ...current, reviews: normalized };

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
