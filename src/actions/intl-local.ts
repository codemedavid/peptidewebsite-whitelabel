"use server";

// Server actions for the Intl & Local layout.
//
//   saveIntlLocalAction       — store admin: persist the whole layout config
//                               (and optionally switch the store onto / off it)
//   subscribeNewsletterAction — PUBLIC: the layout's "Stay in the loop" form
//   listNewsletterSubscribersAction / unsubscribeNewsletterAction
//                             — store admin: who signed up, CSV export, opt-out
//
// Newsletter sign-ups land in the existing tenant-scoped `Contact` table (email
// + unsubscribed + traits — the platform's marketing-contact record), keyed
// `newsletter:<email>` so a re-subscribe updates the same row. Every write goes
// through withTenant, and the tenant is always derived from the request host,
// never from the client.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { withTenant } from "@/lib/db/tenant-client";
import { getTenantIdOrNull, getTenantSlug } from "@/lib/tenant/headers";
import { isDemoMode, getDemoBranding, saveDemoBranding } from "@/lib/demo/fixtures";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { requireStaffPermission } from "@/lib/auth/staff-guard";
import { isValidEmail } from "@/lib/analytics/events";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";
import { normalizeIntlLocalConfig } from "@/lib/storefront/intl-local/normalize";
import { isIntlLocalLayout } from "@/lib/storefront/home-layout";
import { normalizeIntlMarket, type IntlMarketConfig } from "@/lib/storefront/intl-market";

export type ActionResult = { ok: true } | { error: string };

const NO_ACCESS = "You don't have permission to do that.";
const MODULE = "site-layout";
const NEWSLETTER_PREFIX = "newsletter:";
const SUBSCRIBE_LIMIT = 5;
const SUBSCRIBE_WINDOW_MS = 10 * 60 * 1000;
const SUBSCRIBER_LIST_MAX = 5000;

async function readConfig(tenantId: string): Promise<Record<string, unknown>> {
  if (isDemoMode()) return (getDemoBranding(tenantId).config ?? {}) as Record<string, unknown>;
  const branding = await prisma.branding.findUnique({ where: { tenantId }, select: { config: true } });
  return (branding?.config ?? {}) as Record<string, unknown>;
}

async function writeConfig(tenantId: string, config: Record<string, unknown>): Promise<void> {
  if (isDemoMode()) {
    saveDemoBranding(tenantId, { config });
    return;
  }
  await prisma.branding.upsert({
    where: { tenantId },
    update: { config: config as Prisma.InputJsonValue },
    create: { tenantId, config: config as Prisma.InputJsonValue },
  });
}

/**
 * Persist the layout config (read-modify-write into branding.config, so it can
 * never clobber the rest of the storefront's settings).
 *
 * `activate`: true switches the store's home onto this layout and remembers the
 * one it replaces; false puts that previous layout back. Omitted = content only.
 * Remembering matters: "two-ways" is a SOLD module, and a store that tried this
 * template and switched back must land on the home it had, not on "classic".
 */
/** Saved — and the home layout the store is on now (so the editor can mirror
 *  an activate / deactivate into the open storefront without a reload, which
 *  would end the admin session). */
export type SaveIntlLocalResult = { ok: true; homeLayout: string } | { error: string };

export async function saveIntlLocalAction(input: { config: unknown; activate?: boolean }): Promise<SaveIntlLocalResult> {
  const ctx = await requireStaffPermission(MODULE);
  if (!ctx) return { error: NO_ACCESS };
  const tenantId = ctx.tenantId;

  try {
    const current = await readConfig(tenantId);
    const next: Record<string, unknown> = { ...current, intlLocal: normalizeIntlLocalConfig(input?.config) };
    const onLayout = isIntlLocalLayout(current.homeLayout);
    if (input?.activate === true && !onLayout) {
      next.intlLocalPrevLayout = typeof current.homeLayout === "string" ? current.homeLayout : null;
      next.homeLayout = "intl-local";
    }
    if (input?.activate === false && onLayout) {
      const prev = current.intlLocalPrevLayout;
      if (typeof prev === "string" && prev && !isIntlLocalLayout(prev)) next.homeLayout = prev;
      else delete next.homeLayout;
      delete next.intlLocalPrevLayout;
    }
    await writeConfig(tenantId, next);
    revalidateTenant(tenantId, await getTenantSlug());
    return { ok: true, homeLayout: typeof next.homeLayout === "string" ? next.homeLayout : "classic" };
  } catch (e) {
    console.error("[intl-local] save failed", { tenantId, error: e instanceof Error ? e.message : e });
    return { error: "Couldn't save your layout. Please try again." };
  }
}

/**
 * Save the International market's settings (branding.config.intlMarket):
 * the on/off switch (Website Layout permission) and/or the USD shipping rates
 * (Shipping permission). Each half is only written when sent, and each needs
 * its own permission, so a shipping clerk can't switch the market off.
 */
export async function saveIntlMarketAction(input: {
  enabled?: boolean;
  shippingLocations?: unknown;
}): Promise<{ ok: true; intlMarket: IntlMarketConfig } | { error: string }> {
  const needsShipping = input?.shippingLocations !== undefined;
  const needsSwitch = typeof input?.enabled === "boolean";
  const ctx = await requireStaffPermission(needsShipping ? "shipping" : MODULE);
  if (!ctx) return { error: NO_ACCESS };
  if (needsShipping && needsSwitch && !(await requireStaffPermission(MODULE))) return { error: NO_ACCESS };
  try {
    const current = await readConfig(ctx.tenantId);
    const prev = normalizeIntlMarket(current.intlMarket);
    const intlMarket = normalizeIntlMarket({
      enabled: needsSwitch ? input.enabled : prev.enabled,
      shippingLocations: needsShipping ? input.shippingLocations : prev.shippingLocations,
    });
    await writeConfig(ctx.tenantId, { ...current, intlMarket });
    revalidateTenant(ctx.tenantId, await getTenantSlug());
    return { ok: true, intlMarket };
  } catch (e) {
    console.error("[intl-local] save intl market failed", { tenantId: ctx.tenantId, error: e instanceof Error ? e.message : e });
    return { error: "Couldn't save — please try again." };
  }
}

/** PUBLIC — the newsletter form. Rate-limited per IP, honeypot-guarded, and
 *  only accepted for a store that is actually showing the form. */
export async function subscribeNewsletterAction(emailRaw: unknown, honeypot: unknown): Promise<ActionResult> {
  // A filled honeypot is a bot. Answer "ok" so it learns nothing.
  if (typeof honeypot === "string" && honeypot.trim()) return { ok: true };

  const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase().slice(0, 254) : "";
  if (!isValidEmail(email)) return { error: "Please enter a valid email address." };

  const limited = rateLimit(`il-newsletter:${await clientIp()}`, SUBSCRIBE_LIMIT, SUBSCRIBE_WINDOW_MS);
  if (!limited.ok) return { error: "Too many attempts — please try again in a few minutes." };

  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return { error: "This store isn't available." };
  if (isDemoMode()) return { error: "Sign-ups are disabled in the demo store." };

  try {
    const config = await readConfig(tenantId);
    const showing =
      isIntlLocalLayout(config.homeLayout) && normalizeIntlLocalConfig(config.intlLocal).newsletter.show;
    if (!showing) return { error: "Sign-ups aren't open on this store." };

    const traits = { newsletter: true, source: "intl-local", subscribedAt: new Date().toISOString() };
    await withTenant(tenantId, (db) =>
      db.contact.upsert({
        where: { tenantId_distinctId: { tenantId, distinctId: `${NEWSLETTER_PREFIX}${email}` } },
        create: { tenantId, distinctId: `${NEWSLETTER_PREFIX}${email}`, email, traits },
        update: { email, unsubscribed: false, traits },
      }),
    );
    return { ok: true };
  } catch (e) {
    console.error("[intl-local] subscribe failed", { tenantId, error: e instanceof Error ? e.message : e });
    return { error: "Couldn't subscribe right now — please try again." };
  }
}

export type NewsletterSubscriber = { id: string; email: string; subscribedAt: string };

export async function listNewsletterSubscribersAction(): Promise<{ subscribers: NewsletterSubscriber[] } | { error: string }> {
  const ctx = await requireStaffPermission(MODULE);
  if (!ctx) return { error: NO_ACCESS };
  if (isDemoMode()) return { subscribers: [] };
  try {
    const rows = await withTenant(ctx.tenantId, (db) =>
      db.contact.findMany({
        where: { distinctId: { startsWith: NEWSLETTER_PREFIX }, unsubscribed: false },
        orderBy: { createdAt: "desc" },
        take: SUBSCRIBER_LIST_MAX,
        select: { id: true, email: true, createdAt: true },
      }),
    );
    return {
      subscribers: rows.map((r) => ({ id: r.id, email: r.email ?? "", subscribedAt: r.createdAt.toISOString() })),
    };
  } catch (e) {
    console.error("[intl-local] list subscribers failed", { tenantId: ctx.tenantId, error: e instanceof Error ? e.message : e });
    return { error: "Couldn't load subscribers." };
  }
}

/** Opt a subscriber out. The row is kept (unsubscribed = true) so the opt-out
 *  is remembered rather than silently re-added by an old import. */
export async function unsubscribeNewsletterAction(id: unknown): Promise<ActionResult> {
  const ctx = await requireStaffPermission(MODULE);
  if (!ctx) return { error: NO_ACCESS };
  if (typeof id !== "string" || !id) return { error: "Unknown subscriber." };
  try {
    const res = await withTenant(ctx.tenantId, (db) =>
      db.contact.updateMany({
        where: { id, distinctId: { startsWith: NEWSLETTER_PREFIX } },
        data: { unsubscribed: true },
      }),
    );
    return res.count > 0 ? { ok: true } : { error: "Unknown subscriber." };
  } catch (e) {
    console.error("[intl-local] unsubscribe failed", { tenantId: ctx.tenantId, error: e instanceof Error ? e.message : e });
    return { error: "Couldn't update that subscriber." };
  }
}
