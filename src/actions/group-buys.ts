"use server";

// Group Buy Management — the DB/demo write path behind the store admin's
// "Group Buys" view, plus the platform operator's per-tenant defaults.
//
// Two audiences, two gates (same split as actions/orders.ts):
//   • The store-admin CRUD + supplier report require a real `sf_admin_session`
//     for the current tenant AND the matching groupbuy.* entitlement — every
//     capability the UI hides is re-checked here, so a tampered client can't
//     call what the plan doesn't grant.
//   • saveGroupBuySettingsAction is PLATFORM-OPERATOR only (the Features page):
//     it stores the tenant's defaults (status / duration / delivery ETA) in
//     branding.config.groupBuySettings.
//
// DB rows live in the tenant-scoped group_buys table (RLS-backed via
// withTenant); demo mode round-trips against .demo-data/group-buys.json.

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getPlatformUser } from "@/lib/auth/session";
import { getTenantSlug } from "@/lib/tenant/headers";
import { requireStaffPermission } from "@/lib/auth/staff-guard";
import { withTenant } from "@/lib/db/tenant-client";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import {
  isDemoMode,
  getDemoBranding,
  saveDemoBranding,
  getDemoGroupBuys,
  saveDemoGroupBuys,
  getDemoStoreOrders,
  listDemoTenants,
} from "@/lib/demo/fixtures";
import {
  normalizeGroupBuy,
  normalizeGroupBuySettings,
  effectiveGroupBuyStatus,
  staleActiveRoundIds,
  buildSupplierReport,
  orderCountsAsDemand,
  dbGroupBuyToStorefront,
  groupBuyToDbWrite,
  type DbGroupBuyRow,
  type GroupBuy,
  type GroupBuyCapabilities,
  type GroupBuySettings,
  type SupplierReport,
} from "@/lib/storefront/group-buy";
import { resolveGroupBuyCaps, loadGroupBuys } from "@/lib/storefront/group-buy-server";
import { normalizeGroupBuyContent, type GroupBuyContent } from "@/lib/storefront/gb-content";
import { prepareReport, type ReportPrep } from "@/lib/storefront/group-buy-report";
import type { Order } from "@/storefront/types";

export type ListGroupBuysResult =
  | {
      ok: true;
      groupBuys: GroupBuy[];
      caps: GroupBuyCapabilities;
      settings: GroupBuySettings;
      content: GroupBuyContent;
    }
  | { error: string };
export type SaveGroupBuyResult = { ok: true; groupBuy: GroupBuy } | { error: string };
export type ArchiveGroupBuyResult = { ok: true; groupBuy: GroupBuy } | { error: string };

/** Per-customer report section (groupbuy.reports.customer_breakdown). */
export type GroupBuyCustomerLine = {
  name: string;
  email: string;
  orders: number;
  qty: number;
  total: number; // items only — fees/shipping excluded, same as the supplier lines
};
export type SupplierReportResult =
  | { ok: true; report: SupplierReport; customers: GroupBuyCustomerLine[] | null; prep: ReportPrep }
  | { error: string };

const NOT_SIGNED_IN = "Not signed in to the store admin.";

/** Store-admin session + module entitlement, or a customer-facing error. */
async function requireGroupBuyAdmin(): Promise<
  { tenantId: string; slug: string; caps: GroupBuyCapabilities } | { error: string }
> {
  const ctx = await requireStaffPermission("groupbuys");
  if (!ctx) return { error: NOT_SIGNED_IN };
  const tenantId = ctx.tenantId;
  const caps = await resolveGroupBuyCaps(tenantId);
  if (!caps.enabled) return { error: "Group buys aren't enabled for this store." };
  const slug = (await getTenantSlug()) ?? tenantId;
  return { tenantId, slug, caps };
}

async function persistDemo(slug: string, list: GroupBuy[]): Promise<void> {
  saveDemoGroupBuys(slug, list);
}

// ── List ──────────────────────────────────────────────────────────────────────

/** The tenant's group buys plus the resolved capabilities and form defaults —
 *  one round trip for the whole admin view. */
export async function listGroupBuysAction(): Promise<ListGroupBuysResult> {
  const gate = await requireGroupBuyAdmin();
  if ("error" in gate) return gate;
  const { tenantId, slug, caps } = gate;

  try {
    const groupBuys = await loadGroupBuys(tenantId, slug);
    const config = await readTenantConfig(tenantId);
    const settings = normalizeGroupBuySettings(config.groupBuySettings);
    const content = normalizeGroupBuyContent(config.groupBuyContent);
    return { ok: true, groupBuys, caps, settings, content };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't load group buys." };
  }
}

// ── Create / edit ─────────────────────────────────────────────────────────────

/**
 * Create (no id) or update (id) a group buy. Capability gates: create needs
 * groupbuy.create, edit needs groupbuy.edit, a "scheduled" status needs
 * groupbuy.scheduled, product assignment is dropped without
 * groupbuy.product_assignment, and going live alongside another live run is
 * always rejected — exactly one active round per tenant (rule #4).
 */
export async function saveGroupBuyAction(input: unknown): Promise<SaveGroupBuyResult> {
  const gate = await requireGroupBuyAdmin();
  if ("error" in gate) return gate;
  const { tenantId, slug, caps } = gate;

  const gb = normalizeGroupBuy(input);
  const isEdit = gb.id !== "";
  if (isEdit && !caps.canEdit) return { error: "Editing group buys isn't enabled for this store." };
  if (!isEdit && !caps.canCreate) return { error: "Creating group buys isn't enabled for this store." };
  if (!gb.name) return { error: "Give the group buy a name." };
  if (gb.status === "scheduled" && !caps.scheduled) {
    return { error: "Scheduled group buys aren't enabled for this store." };
  }
  if (!caps.productAssignment) gb.productIds = [];
  if (gb.startsAt && gb.endsAt && gb.startsAt > gb.endsAt) {
    return { error: "The group buy can't end before it starts." };
  }

  try {
    // Single-active guard (rule #4): at most one run may be live (effective
    // status "active") at a time. Unconditional — there is no entitlement that
    // widens this. Still a read-then-write, so it races under concurrent saves;
    // the DB partial unique index group_buys_one_active_per_tenant is the real
    // enforcement and this check exists to return a readable error first.
    const others = (await loadGroupBuys(tenantId, slug)).filter((x) => x.id !== gb.id);
    const wouldBeLive = effectiveGroupBuyStatus(gb, caps.scheduled) === "active";
    const otherLive = others.some((x) => effectiveGroupBuyStatus(x, caps.scheduled) === "active");
    if (wouldBeLive && otherLive) {
      return { error: "Another group buy is already active. Close it before opening this one." };
    }

    // Reconcile before writing a stored-active row: persist the close of any
    // lapsed round still stored 'active' (effective status "closed") so the DB
    // partial unique index group_buys_one_active_per_tenant doesn't false-reject
    // this activation. Only relevant when the row we're about to write is itself
    // stored 'active'.
    const staleIds = gb.status === "active" ? staleActiveRoundIds(others, caps) : [];

    if (isDemoMode()) {
      const list = (await loadGroupBuys(tenantId, slug)).slice();
      const now = new Date().toISOString();
      if (isEdit) {
        const i = list.findIndex((x) => x.id === gb.id);
        if (i < 0) return { error: "Group buy not found." };
        list[i] = { ...gb, createdAt: list[i].createdAt, updatedAt: now };
        await persistDemo(slug, list);
        return { ok: true, groupBuy: list[i] };
      }
      const created: GroupBuy = { ...gb, id: `gb-${Date.now()}`, createdAt: now, updatedAt: now };
      await persistDemo(slug, [created, ...list]);
      return { ok: true, groupBuy: created };
    }

    const data = {
      ...groupBuyToDbWrite(gb),
      productIds: gb.productIds as unknown as Prisma.InputJsonValue,
    };
    if (isEdit) {
      const row = await withTenant(tenantId, async (db) => {
        if (staleIds.length) {
          await db.groupBuy.updateMany({ where: { id: { in: staleIds } }, data: { status: "closed" } });
        }
        // updateMany is tenant-scoped by the extension; the bare-id update isn't.
        const n = await db.groupBuy.updateMany({ where: { id: gb.id }, data });
        return n.count ? db.groupBuy.findFirst({ where: { id: gb.id } }) : null;
      });
      if (!row) return { error: "Group buy not found." };
      return { ok: true, groupBuy: dbGroupBuyToStorefront(row as DbGroupBuyRow) };
    }
    const row = await withTenant(tenantId, async (db) => {
      if (staleIds.length) {
        await db.groupBuy.updateMany({ where: { id: { in: staleIds } }, data: { status: "closed" } });
      }
      return db.groupBuy.create({ data: { ...data, tenantId } });
    });
    return { ok: true, groupBuy: dbGroupBuyToStorefront(row as DbGroupBuyRow) };
  } catch (e) {
    // The DB partial unique index rejects a second concurrent activation with
    // P2002 — surface the same readable message the app guard would have, never
    // the raw constraint text.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "Another group buy is already active. Close it before opening this one." };
    }
    return { error: e instanceof Error ? e.message : "Couldn't save the group buy." };
  }
}

// ── Storefront on-hand toggle (store admin) ─────────────────────────────────

/**
 * Persist the store owner's choice of whether on-hand (non-group-buy) products
 * stay buyable while a group buy is live, into branding.config.groupBuyAllowOnHand
 * (read-modify-write so the rest of the storefront config is untouched). Store-
 * admin gated + module entitlement; revalidates the tenant so the storefront
 * gate recomputes. Only meaningful with product assignment — without it every
 * live run covers the whole catalog, so there are no on-hand products to gate.
 */
export async function saveGroupBuyAllowOnHandAction(
  allowOnHand: unknown,
): Promise<{ ok: true; allowOnHand: boolean } | { error: string }> {
  const gate = await requireGroupBuyAdmin();
  if ("error" in gate) return gate;
  const { tenantId, slug } = gate;
  const value = allowOnHand !== false;

  try {
    if (isDemoMode()) {
      const current = (getDemoBranding(slug).config ?? {}) as Record<string, unknown>;
      saveDemoBranding(slug, { config: { ...current, groupBuyAllowOnHand: value } });
    } else {
      const current = await readTenantConfig(tenantId);
      const config = { ...current, groupBuyAllowOnHand: value } as Prisma.InputJsonValue;
      await prisma.branding.upsert({
        where: { tenantId },
        update: { config },
        create: { tenantId, config },
      });
    }
    revalidateTenant(tenantId, slug);
    return { ok: true, allowOnHand: value };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save the setting." };
  }
}

// ── Storefront copy (store admin) ────────────────────────────────────────────

/**
 * Persist the owner-editable Group Buy storefront copy — the "How group buys
 * work" section (title + steps) and the live-round terms line — into
 * branding.config.groupBuyContent (read-modify-write so the rest of the config
 * is untouched). Store-admin gated + module entitlement (requireGroupBuyAdmin),
 * so a tampered client can't write copy without the Group Buy module. The input
 * is normalized server-side (trim/caps/fallbacks) — the client preview and the
 * storefront always agree because both render the normalized shape. Revalidates
 * the tenant so the two-ways home and the GB page recompute.
 */
export async function saveGroupBuyContentAction(
  input: unknown,
): Promise<{ ok: true; content: GroupBuyContent } | { error: string }> {
  const gate = await requireGroupBuyAdmin();
  if ("error" in gate) return gate;
  const { tenantId, slug } = gate;
  const content = normalizeGroupBuyContent(input);

  try {
    if (isDemoMode()) {
      const current = (getDemoBranding(slug).config ?? {}) as Record<string, unknown>;
      saveDemoBranding(slug, { config: { ...current, groupBuyContent: content } });
    } else {
      const current = await readTenantConfig(tenantId);
      const config = { ...current, groupBuyContent: content } as Prisma.InputJsonValue;
      await prisma.branding.upsert({
        where: { tenantId },
        update: { config },
        create: { tenantId, config },
      });
    }
    revalidateTenant(tenantId, slug);
    return { ok: true, content };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save the storefront copy." };
  }
}

// ── Duplicate ─────────────────────────────────────────────────────────────────

/** Copy an existing group buy as a fresh draft ("Copy of …") with no window —
 *  the owner re-dates it before launch. */
export async function duplicateGroupBuyAction(id: unknown): Promise<SaveGroupBuyResult> {
  const gate = await requireGroupBuyAdmin();
  if ("error" in gate) return gate;
  const { tenantId, slug, caps } = gate;
  if (!caps.canDuplicate) {
    return { error: "Duplicating group buys isn't enabled for this store." };
  }
  const sourceId = typeof id === "string" ? id : "";
  if (!sourceId) return { error: "Missing group buy id." };

  try {
    const source = (await loadGroupBuys(tenantId, slug)).find((x) => x.id === sourceId);
    if (!source) return { error: "Group buy not found." };
    const copy = normalizeGroupBuy({
      ...source,
      id: "",
      name: `Copy of ${source.name}`.slice(0, 200),
      status: "draft",
      startsAt: null,
      endsAt: null,
    });

    if (isDemoMode()) {
      const now = new Date().toISOString();
      const created: GroupBuy = { ...copy, id: `gb-${Date.now()}`, createdAt: now, updatedAt: now };
      await persistDemo(slug, [created, ...(await loadGroupBuys(tenantId, slug))]);
      return { ok: true, groupBuy: created };
    }
    const row = await withTenant(tenantId, (db) =>
      db.groupBuy.create({
        data: {
          ...groupBuyToDbWrite(copy),
          productIds: copy.productIds as unknown as Prisma.InputJsonValue,
          tenantId,
        },
      }),
    );
    return { ok: true, groupBuy: dbGroupBuyToStorefront(row as DbGroupBuyRow) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't duplicate the group buy." };
  }
}

// ── Archive / restore ─────────────────────────────────────────────────────────

/** Archive a finished group buy (or restore one to draft). Archived runs keep
 *  their order attribution and stay reportable — they just leave the working list. */
export async function setGroupBuyArchivedAction(
  id: unknown,
  archived: unknown,
): Promise<ArchiveGroupBuyResult> {
  const gate = await requireGroupBuyAdmin();
  if ("error" in gate) return gate;
  const { tenantId, slug, caps } = gate;
  if (!caps.canArchive) return { error: "Archiving group buys isn't enabled for this store." };
  const gbId = typeof id === "string" ? id : "";
  if (!gbId) return { error: "Missing group buy id." };
  const status = archived === true ? "archived" : "draft";

  try {
    if (isDemoMode()) {
      const list = (await loadGroupBuys(tenantId, slug)).slice();
      const i = list.findIndex((x) => x.id === gbId);
      if (i < 0) return { error: "Group buy not found." };
      list[i] = { ...list[i], status, updatedAt: new Date().toISOString() };
      await persistDemo(slug, list);
      return { ok: true, groupBuy: list[i] };
    }
    const row = await withTenant(tenantId, async (db) => {
      const n = await db.groupBuy.updateMany({ where: { id: gbId }, data: { status } });
      return n.count ? db.groupBuy.findFirst({ where: { id: gbId } }) : null;
    });
    if (!row) return { error: "Group buy not found." };
    return { ok: true, groupBuy: dbGroupBuyToStorefront(row as DbGroupBuyRow) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't archive the group buy." };
  }
}

// ── Supplier report ───────────────────────────────────────────────────────────

/** Aggregate a group buy's orders into the supplier order list (+ the optional
 *  per-customer breakdown when the tenant has groupbuy.reports.customer_breakdown). */
export async function getGroupBuySupplierReportAction(
  id: unknown,
): Promise<SupplierReportResult> {
  const gate = await requireGroupBuyAdmin();
  if ("error" in gate) return gate;
  const { tenantId, slug, caps } = gate;
  if (!caps.supplierReports) {
    return { error: "Supplier reports aren't enabled for this store." };
  }
  const gbId = typeof id === "string" ? id : "";
  if (!gbId) return { error: "Missing group buy id." };

  try {
    let orders: Order[];
    if (isDemoMode()) {
      orders = getDemoStoreOrders(slug).filter((o) => o.groupBuyId === gbId);
    } else {
      const rows = await withTenant(tenantId, (db) =>
        db.storefrontOrder.findMany({
          where: { groupBuyId: gbId },
          select: { orderNumber: true, status: true, paymentStatus: true, items: true, customer: true },
        }),
      );
      orders = rows.map((r) => ({
        orderNumber: r.orderNumber,
        status: r.status,
        paymentStatus: r.paymentStatus,
        items: r.items,
        customer: r.customer,
      })) as unknown as Order[];
    }

    const report = buildSupplierReport(
      gbId,
      orders.map((o) => ({ status: o.status, paymentStatus: o.paymentStatus, items: o.items ?? [] })),
    );

    let customers: GroupBuyCustomerLine[] | null = null;
    if (caps.reports.customerBreakdown) {
      const byKey = new Map<string, GroupBuyCustomerLine>();
      for (const o of orders) {
        if (!orderCountsAsDemand(o.status)) continue; // same demand rule as the supplier lines
        const c = (o.customer ?? {}) as { name?: string; email?: string };
        const key = (c.email || c.name || "unknown").toLowerCase();
        const line = byKey.get(key) ?? {
          name: c.name || "Unknown",
          email: c.email || "",
          orders: 0,
          qty: 0,
          total: 0,
        };
        line.orders += 1;
        for (const it of o.items ?? []) {
          line.qty += it.qty;
          line.total += it.qty * it.price;
        }
        byKey.set(key, line);
      }
      customers = [...byKey.values()].sort((a, b) => b.total - a.total);
    }

    // Structured 3-sheet workbook prep for the client's lazy exceljs serializer.
    const round = (await loadGroupBuys(tenantId, slug)).find((g) => g.id === gbId);
    const prep = prepareReport(
      {
        name: round?.name ?? "",
        status: round?.status ?? "",
        startsAt: round?.startsAt ?? null,
        endsAt: round?.endsAt ?? null,
      },
      orders.map((o) => {
        const oo = o as unknown as {
          orderNumber?: string;
          status: string;
          paymentStatus?: string;
          customer?: { name?: string; email?: string; phone?: string };
          items?: Array<{ name: string; qty: number; price: number; productId?: string }>;
        };
        return {
          orderNumber: oo.orderNumber,
          status: oo.status,
          paymentStatus: oo.paymentStatus,
          customer: oo.customer,
          items: oo.items ?? [],
        };
      }),
      // Reuse the report already aggregated above — one pass over the orders, and
      // the workbook can never diverge from the on-screen numbers.
      report,
    );
    return { ok: true, report, customers, prep };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't build the report." };
  }
}

// ── Platform operator: per-tenant defaults (Features page) ──────────────────

async function readTenantConfig(tenantId: string): Promise<Record<string, unknown>> {
  if (isDemoMode()) {
    const slug = (await getTenantSlug()) ?? tenantId;
    return (getDemoBranding(slug).config ?? {}) as Record<string, unknown>;
  }
  const branding = await prisma.branding.findUnique({
    where: { tenantId },
    select: { config: true },
  });
  return (branding?.config ?? {}) as Record<string, unknown>;
}

/**
 * Persist a tenant's group-buy defaults into branding.config.groupBuySettings
 * (read-modify-write so the rest of the storefront config is untouched).
 * Platform-operator only — this is the "Group Buy Settings" card on the
 * tenant's Features page, keyed by slug like saveFeatures.
 */
export async function saveGroupBuySettingsAction(
  slug: unknown,
  input: unknown,
): Promise<{ ok: true } | { error: string }> {
  const operator = await getPlatformUser();
  if (!operator) return { error: "FORBIDDEN" };
  const tenantSlug = typeof slug === "string" ? slug : "";
  if (!/^[a-z0-9-]{2,}$/.test(tenantSlug)) return { error: "Invalid tenant slug." };

  const settings = normalizeGroupBuySettings(input);

  try {
    if (isDemoMode()) {
      if (!listDemoTenants().some((t) => t.slug === tenantSlug)) {
        return { error: `Tenant not found: ${tenantSlug}` };
      }
      const current = (getDemoBranding(tenantSlug).config ?? {}) as Record<string, unknown>;
      saveDemoBranding(tenantSlug, { config: { ...current, groupBuySettings: settings } });
      revalidateTenant(tenantSlug, tenantSlug);
    } else {
      const tenant = await prisma.tenant.findUnique({
        where: { slug: tenantSlug },
        select: { id: true, branding: { select: { config: true } } },
      });
      if (!tenant) return { error: `Tenant not found: ${tenantSlug}` };
      const current = (tenant.branding?.config ?? {}) as Record<string, unknown>;
      const config = { ...current, groupBuySettings: settings } as Prisma.InputJsonValue;
      await prisma.branding.upsert({
        where: { tenantId: tenant.id },
        update: { config },
        create: { tenantId: tenant.id, config },
      });
      revalidateTenant(tenant.id, tenantSlug);
    }
    revalidatePath(`/admin/tenants/${tenantSlug}/features`);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save the settings." };
  }
}
