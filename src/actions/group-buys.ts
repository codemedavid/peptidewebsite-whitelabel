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
import {
  detectAssignmentDrift,
  productsToAssign,
  type AssignmentDrift,
} from "@/lib/storefront/group-buy-assignment";
import {
  applyGbPrice,
  gbPriceError,
  removeFromGroupBuy,
  setPurchasable,
} from "@/lib/storefront/gb-pricing";
import {
  currencySymbolToIso,
  dbProductToStorefront,
  productToDbWrite,
  type DbProductRow,
} from "@/lib/storefront/product-mapping";
import { preserveResellerMetadata } from "@/lib/storefront/reseller-gate";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import {
  getDemoProducts,
  getDemoStoreProducts,
  saveDemoStoreProducts,
} from "@/lib/demo/fixtures";
import { requireAnyStaffPermission } from "@/lib/auth/staff-guard";
import type { Product } from "@/storefront/types";
import { normalizeGroupBuyContent, type GroupBuyContent } from "@/lib/storefront/gb-content";
import { normalizeTwoWaysMode, type TwoWaysMode } from "@/lib/storefront/two-ways-mode";
import { prepareReport, type ReportPrep } from "@/lib/storefront/group-buy-report";
import {
  resolveRoundOrders,
  summarizeRoundOrders,
  buildProductsToOrder,
  buildRoundOrderRows,
  type LinkableOrder,
  type ProductToOrder,
  type ReportRoundWindow,
  type RoundOrderRow,
  type RoundSummary,
} from "@/lib/storefront/group-buy-orders";
import {
  buildRoundAnalytics,
  buildRoundListRow,
  type AnalyticsRound,
  type RoundAnalytics,
  type RoundListRow,
} from "@/lib/storefront/group-buy-analytics";
import type { Order } from "@/storefront/types";

export type ListGroupBuysResult =
  | {
      ok: true;
      groupBuys: GroupBuy[];
      /** Per-round management-list stats, keyed by round id order-matched to
       *  `groupBuys`. Derived from the same analytics the dashboard renders. */
      rows: RoundListRow[];
      caps: GroupBuyCapabilities;
      settings: GroupBuySettings;
      content: GroupBuyContent;
    }
  | { error: string };

/** Everything one round's dedicated dashboard renders, in a single round trip. */
export type GroupBuyDashboardResult =
  | {
      ok: true;
      groupBuy: GroupBuy;
      analytics: RoundAnalytics;
      orderRows: RoundOrderRow[];
      /** Workbook prep for THIS round only. */
      prep: ReportPrep;
      caps: GroupBuyCapabilities;
      /** Orders belonging to no round's window — surfaced, never dropped. */
      unlinked: number;
      /** Does the assignment still match what customers are ordering? An
       *  unnoticed mismatch is what cost k-glow its attribution AND its
       *  group-buy pricing — see lib/storefront/group-buy-assignment.ts. */
      drift: AssignmentDrift;
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
  | {
      ok: true;
      report: SupplierReport;
      customers: GroupBuyCustomerLine[] | null;
      prep: ReportPrep;
      /** Owner-facing headline counts — cancelled excluded from vials/sales. */
      counts: RoundSummary;
      /** Vials to buy per product, cancelled orders excluded. */
      productsToOrder: ProductToOrder[];
      /** One row per order LINE, cancelled included and flagged. */
      orderRows: RoundOrderRow[];
      /** Orders that belong to no round's window — surfaced, never dropped. */
      unlinked: number;
    }
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

    // One query for every candidate order, then resolve per round in memory —
    // never one query per round, which would be an N+1 on the list page.
    const candidates = await loadCandidateOrders(tenantId, slug, groupBuys);
    const productNames = await loadProductNames(tenantId, slug, groupBuys);
    const windows = groupBuys.map(toAnalyticsRound);
    const rows = groupBuys.map((gb, i) =>
      buildRoundListRow(
        windows[i],
        resolveRoundOrders(windows[i], candidates, windows).orders,
        productNames,
      ),
    );

    return { ok: true, groupBuys, rows, caps, settings, content };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't load group buys." };
  }
}

/** A GroupBuy narrowed to what the analytics need — one place, so the list and
 *  the dashboard can never disagree about which fields feed the numbers. */
function toAnalyticsRound(gb: GroupBuy): AnalyticsRound {
  return {
    id: gb.id,
    name: gb.name,
    status: gb.status,
    startsAt: gb.startsAt,
    endsAt: gb.endsAt,
    createdAt: gb.createdAt,
    batchNumber: gb.batchNumber,
    minVials: gb.minVials,
    maxVials: gb.maxVials,
    closedAt: gb.closedAt,
    productIds: gb.productIds,
  };
}

/**
 * The orders any round might own: everything already attributed to a round, plus
 * everything unattributed that could fall in a round's window.
 *
 * Deliberately NOT `where: { groupBuyId: <id> }`. That column is stamped once at
 * checkout and is NULL whenever the round's product assignment didn't cover what
 * the customer bought — the k-glow bug. resolveRoundOrders() narrows this
 * superset down to exactly one owning round per order.
 *
 * Bounded by the earliest round start so a tenant with years of on-hand orders
 * doesn't read its whole history to draw a list of rounds.
 */
async function loadCandidateOrders(
  tenantId: string,
  slug: string,
  rounds: GroupBuy[],
): Promise<LinkableOrder[]> {
  if (isDemoMode()) {
    return getDemoStoreOrders(slug).map(toLinkableOrder);
  }
  const starts = rounds
    .map((r) => r.startsAt)
    .filter((s): s is string => !!s)
    .sort();
  const earliest = starts[0] ? new Date(starts[0]) : null;
  const rows = await withTenant(tenantId, (db) =>
    db.storefrontOrder.findMany({
      where: earliest
        ? { OR: [{ NOT: { groupBuyId: null } }, { placedAt: { gte: earliest } }] }
        : { NOT: { groupBuyId: null } },
      select: {
        orderNumber: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        paymentProofUrl: true,
        placedAt: true,
        items: true,
        customer: true,
        shipping: true,
        groupBuyId: true,
        groupBuyName: true,
      },
      orderBy: { placedAt: "asc" },
    }),
  );
  return rows.map(toLinkableOrder);
}

/** id → name for every product assigned to any round, so the list/dashboard can
 *  show a product name instead of a cuid. One query, ids only. */
async function loadProductNames(
  tenantId: string,
  slug: string,
  rounds: GroupBuy[],
): Promise<Map<string, string>> {
  const ids = [...new Set(rounds.flatMap((r) => r.productIds))];
  if (ids.length === 0) return new Map();
  if (isDemoMode()) {
    const list = getDemoStoreProducts(slug) ?? [];
    return new Map(list.filter((p) => ids.includes(p.id)).map((p) => [p.id, p.name]));
  }
  const rows = await withTenant(tenantId, (db) =>
    db.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
  );
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * Every product id that still exists for the tenant — ids only, one query. Used
 * to spot assignments pointing at deleted products. Returning an EMPTY set is
 * meaningful: the drift check treats it as "unknown" rather than "everything is
 * deleted", so a store with no products never mass-flags its assignments.
 */
async function loadCatalogProductIds(tenantId: string, slug: string): Promise<Set<string>> {
  if (isDemoMode()) {
    return new Set((getDemoStoreProducts(slug) ?? []).map((p) => p.id));
  }
  const rows = await withTenant(tenantId, (db) => db.product.findMany({ select: { id: true } }));
  return new Set(rows.map((r) => r.id));
}

// ── Per-round dashboard ──────────────────────────────────────────────────────

/**
 * Everything ONE round's dashboard renders. Scoped by construction: the orders
 * are resolved for this round only (resolveRoundOrders), and every number is
 * computed from that slice — there is no tenant-wide aggregate anywhere in here,
 * which is what makes the analytics per-round rather than global.
 */
export async function getGroupBuyDashboardAction(id: unknown): Promise<GroupBuyDashboardResult> {
  const gate = await requireGroupBuyAdmin();
  if ("error" in gate) return gate;
  const { tenantId, slug, caps } = gate;
  const gbId = typeof id === "string" ? id : "";
  if (!gbId) return { error: "Missing group buy id." };

  try {
    const rounds = await loadGroupBuys(tenantId, slug);
    const groupBuy = rounds.find((g) => g.id === gbId);
    if (!groupBuy) return { error: "Group buy not found." };

    const windows = rounds.map(toAnalyticsRound);
    const round = windows.find((w) => w.id === gbId)!;
    const candidates = await loadCandidateOrders(tenantId, slug, rounds);
    const resolved = resolveRoundOrders(round, candidates, windows);
    const productNames = await loadProductNames(tenantId, slug, rounds);

    const analytics = buildRoundAnalytics(round, resolved.orders, productNames);
    const orderRows = buildRoundOrderRows(round, resolved.orders);

    // The export is fed the SAME resolved orders and the same aggregation, so a
    // download can never disagree with the dashboard it was taken from.
    const report = buildSupplierReport(
      gbId,
      resolved.orders.map((o) => ({
        status: o.status,
        paymentStatus: o.paymentStatus,
        items: o.items ?? [],
      })),
    );
    const prep = prepareReport(round, resolved.orders, report);

    // Is the assignment still tracking reality? Names for assigned-but-unsold
    // rows come from the catalog lookup we already did; the drift module only
    // knows the ids, and a cuid is not something the owner can recognise.
    const raw = detectAssignmentDrift(
      groupBuy,
      resolved.orders,
      await loadCatalogProductIds(tenantId, slug),
    );
    const drift: AssignmentDrift = {
      ...raw,
      assignedUnsold: raw.assignedUnsold.map((p) => ({
        ...p,
        name: productNames.get(p.productId) ?? p.name,
      })),
    };

    return {
      ok: true,
      groupBuy,
      analytics,
      orderRows,
      prep,
      caps,
      unlinked: resolved.unlinked,
      drift,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't load the group buy." };
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

/**
 * Add the products customers are actually ordering to a round's assignment, and
 * drop assignments whose product no longer exists. The one-click fix behind the
 * drift warning on the round's dashboard.
 *
 * Only touches productIds — dates, status and every other field are left alone,
 * so this can be run on a live round without disturbing it. The drift is
 * recomputed server-side from the round's real orders rather than trusting a
 * list from the client, which is the only way this can't be used to widen a
 * round to arbitrary products.
 */
export async function addOrderedProductsToRoundAction(id: unknown): Promise<SaveGroupBuyResult> {
  const gate = await requireGroupBuyAdmin();
  if ("error" in gate) return gate;
  const { tenantId, slug, caps } = gate;
  if (!caps.canEdit) return { error: "Editing group buys isn't enabled for this store." };
  if (!caps.productAssignment) {
    return { error: "Product assignment isn't enabled for this store." };
  }
  const gbId = typeof id === "string" ? id : "";
  if (!gbId) return { error: "Missing group buy id." };

  try {
    const rounds = await loadGroupBuys(tenantId, slug);
    const groupBuy = rounds.find((g) => g.id === gbId);
    if (!groupBuy) return { error: "Group buy not found." };

    const windows = rounds.map(toAnalyticsRound);
    const round = windows.find((w) => w.id === gbId)!;
    const candidates = await loadCandidateOrders(tenantId, slug, rounds);
    const resolved = resolveRoundOrders(round, candidates, windows);
    const drift = detectAssignmentDrift(
      groupBuy,
      resolved.orders,
      await loadCatalogProductIds(tenantId, slug),
    );
    if (!drift.hasDrift) return { ok: true, groupBuy };

    const productIds = productsToAssign(groupBuy, drift);
    const next: GroupBuy = { ...groupBuy, productIds };

    if (isDemoMode()) {
      const list = rounds.map((g) => (g.id === gbId ? next : g));
      await persistDemo(slug, list);
      return { ok: true, groupBuy: next };
    }

    const row = await withTenant(tenantId, async (db) => {
      // updateMany is tenant-scoped by the extension; a bare-id update isn't.
      const n = await db.groupBuy.updateMany({
        where: { id: gbId },
        data: { productIds: productIds as unknown as Prisma.InputJsonValue },
      });
      return n.count ? db.groupBuy.findFirst({ where: { id: gbId } }) : null;
    });
    if (!row) return { error: "Group buy not found." };
    // The assignment drives storefront group-buy pricing and the on-hand gate,
    // so the tenant's cached pages have to recompute.
    revalidateTenant(tenantId, slug);
    return { ok: true, groupBuy: dbGroupBuyToStorefront(row as DbGroupBuyRow) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't update the assignment." };
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

// ── Ways to order (store admin) ──────────────────────────────────────────────

/**
 * Persist per-way management of the two order paths into
 * branding.config.twoWaysMode (read-modify-write, so the rest of the storefront
 * config is untouched). Store-admin gated + module entitlement, and the input is
 * re-normalized server-side — a tampered client can't write a state the
 * storefront doesn't understand, and can't hide BOTH ways and leave a store with
 * nothing to buy (normalizeTwoWaysMode refuses that combination).
 *
 * Revalidates the tenant so the storefront, the cart gate, and the checkout gate
 * all pick the new states up together.
 */
export async function saveTwoWaysModeAction(
  mode: unknown,
): Promise<{ ok: true; mode: TwoWaysMode } | { error: string }> {
  const gate = await requireGroupBuyAdmin();
  if ("error" in gate) return gate;
  const { tenantId, slug } = gate;
  const value = normalizeTwoWaysMode(mode);

  try {
    if (isDemoMode()) {
      const current = (getDemoBranding(slug).config ?? {}) as Record<string, unknown>;
      saveDemoBranding(slug, { config: { ...current, twoWaysMode: value } });
    } else {
      const current = await readTenantConfig(tenantId);
      const config = { ...current, twoWaysMode: value } as Prisma.InputJsonValue;
      await prisma.branding.upsert({
        where: { tenantId },
        update: { config },
        create: { tenantId, config },
      });
    }
    revalidateTenant(tenantId, slug);
    return { ok: true, mode: value };
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
    const rounds = await loadGroupBuys(tenantId, slug);
    const round = rounds.find((g) => g.id === gbId);
    if (!round) return { error: "Group buy not found." };

    // Load the CANDIDATES, not "the round's orders". A round's orders can't be
    // selected with `where: { groupBuyId: gbId }` — that was the bug. groupBuyId
    // is stamped once at checkout by groupBuyForOrder(), which silently stamps
    // NULL whenever the round's productIds assignment doesn't cover what the
    // customer actually bought, and nothing ever backfills it. So we fetch the
    // orders stamped for THIS round plus every unattributed order, and let
    // resolveRoundOrders() apply the window fallback. Orders stamped for another
    // round are excluded in SQL — they already belong somewhere else.
    let candidates: LinkableOrder[];
    if (isDemoMode()) {
      candidates = getDemoStoreOrders(slug)
        .filter((o) => !o.groupBuyId || o.groupBuyId === gbId)
        .map(toLinkableOrder);
    } else {
      const rows = await withTenant(tenantId, (db) =>
        db.storefrontOrder.findMany({
          where: { OR: [{ groupBuyId: gbId }, { groupBuyId: null }] },
          select: {
            orderNumber: true,
            status: true,
            paymentStatus: true,
            paymentMethod: true,
            paymentProofUrl: true,
            placedAt: true,
            items: true,
            customer: true,
            shipping: true,
            groupBuyId: true,
            groupBuyName: true,
          },
          orderBy: { placedAt: "asc" },
        }),
      );
      candidates = rows.map((r) => toLinkableOrder(r));
    }

    const roundWindows: ReportRoundWindow[] = rounds.map((g) => ({
      id: g.id,
      name: g.name,
      status: g.status,
      startsAt: g.startsAt,
      endsAt: g.endsAt,
      createdAt: g.createdAt,
    }));
    const resolved = resolveRoundOrders(
      roundWindows.find((r) => r.id === gbId)!,
      candidates,
      roundWindows,
    );
    const orders = resolved.orders as unknown as Order[];

    const report = buildSupplierReport(
      gbId,
      resolved.orders.map((o) => ({ status: o.status, paymentStatus: o.paymentStatus, items: o.items ?? [] })),
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

    // Structured workbook prep for the client's lazy exceljs serializer. It is
    // fed the SAME resolved orders and the SAME aggregation the screen renders,
    // so the download can never disagree with what the owner just looked at.
    const roundWindow = roundWindows.find((r) => r.id === gbId)!;
    const prep = prepareReport(roundWindow, resolved.orders, report);

    return {
      ok: true,
      report,
      customers,
      prep,
      counts: prep.counts,
      productsToOrder: prep.productsToOrder,
      orderRows: prep.orderLines,
      unlinked: resolved.unlinked,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't build the report." };
  }
}

/** Narrow a DB row or demo order to the report's LinkableOrder shape. Untrusted
 *  JSON columns are cast rather than re-validated — the report only reads them. */
function toLinkableOrder(r: {
  orderNumber?: string | null;
  status: string;
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  paymentProofUrl?: string | null;
  paymentProof?: string | null;
  placedAt?: Date | string | null;
  date?: string;
  items: unknown;
  customer: unknown;
  shipping?: unknown;
  groupBuyId?: string | null;
  groupBuyName?: string | null;
}): LinkableOrder {
  const placed = r.placedAt ?? r.date ?? "";
  return {
    orderNumber: r.orderNumber ?? undefined,
    date: placed instanceof Date ? placed.toISOString() : String(placed),
    status: r.status,
    paymentStatus: r.paymentStatus ?? undefined,
    paymentMethod: r.paymentMethod ?? undefined,
    paymentProof: r.paymentProofUrl ?? r.paymentProof ?? null,
    groupBuyId: r.groupBuyId ?? null,
    groupBuyName: r.groupBuyName ?? null,
    customer: (r.customer ?? {}) as LinkableOrder["customer"],
    shipping: (r.shipping ?? {}) as LinkableOrder["shipping"],
    items: (Array.isArray(r.items) ? r.items : []) as LinkableOrder["items"],
  };
}

// ── Platform operator: per-tenant defaults (Features page) ──────────────────

// ── Group Buy Pricing (store admin → Group Buys → Pricing tab) ──────────────

export type GbPricingOp =
  | { op: "price"; productId: string; price: number }
  | { op: "remove"; productId: string }
  | { op: "availability"; productId: string; available: boolean };

export type SaveGbPricingResult =
  | { ok: true; product: Product; groupBuys: GroupBuy[]; warning?: string }
  | { error: string };

/** Coerce the untrusted client payload into one of the three operations. */
function normalizeGbPricingOp(input: unknown): GbPricingOp | null {
  const x = (input ?? {}) as Record<string, unknown>;
  const productId = typeof x.productId === "string" ? x.productId.slice(0, 64) : "";
  if (!productId) return null;
  if (x.op === "price") return { op: "price", productId, price: Number(x.price) };
  if (x.op === "remove") return { op: "remove", productId };
  if (x.op === "availability") {
    return { op: "availability", productId, available: x.available !== false };
  }
  return null;
}

/**
 * One product's group-buy pricing: set/replace its GB price, retire it from the
 * group buy, or pause/resume it.
 *
 * Deliberately ONE action rather than reusing saveProductAction +
 * saveGroupBuyAction, because "remove from the group buy" is a two-table write —
 * the product's metadata AND every round that assigns it. Split across two
 * client calls, a failure of the second would leave a product untagged but still
 * listed in a live round, which prices it at full price inside a group buy.
 *
 * Gating is the intersection of both surfaces: the Group Buy module entitlement
 * plus `groupbuy.can_edit` (this changes what a round sells), AND a catalog
 * grant — it writes the Product row, so a staff member with only "groupbuys"
 * must not reach it. Every check is re-run here; the tab hiding a button is UX.
 */
export async function saveGroupBuyProductPricingAction(
  input: unknown,
): Promise<SaveGbPricingResult> {
  const gate = await requireGroupBuyAdmin();
  if ("error" in gate) return gate;
  const { tenantId, slug, caps } = gate;
  if (!caps.canEdit) return { error: "Your plan doesn't allow editing group buys." };
  // Writes the catalog, so a catalog grant is required on top of "groupbuys".
  if (!(await requireAnyStaffPermission(["products", "add-product"]))) {
    return { error: "You don't have permission to edit products." };
  }

  const op = normalizeGbPricingOp(input);
  if (!op) return { error: "Nothing to save." };

  const config = await readTenantConfig(tenantId);
  const displaySymbol = String(config.currency ?? "") || "₱";

  try {
    const rounds = await loadGroupBuys(tenantId, slug);

    // ── Demo mode: same operations against the file-backed store ──
    if (isDemoMode()) {
      const list =
        getDemoStoreProducts(slug) ??
        getDemoProducts(slug).map((dp) =>
          dbProductToStorefront(dp as unknown as DbProductRow, displaySymbol),
        );
      const current = list.find((p) => p.id === op.productId);
      if (!current) return { error: "That product no longer exists." };

      const applied = applyOp(op, current, rounds);
      if ("error" in applied) return applied;

      saveDemoStoreProducts(
        slug,
        list.map((p) => (p.id === applied.product.id ? applied.product : p)),
      );
      if (applied.roundUpdates.length) {
        const byId = new Map(applied.roundUpdates.map((u) => [u.id, u.productIds]));
        await persistDemo(
          slug,
          rounds.map((gb) =>
            byId.has(gb.id) ? { ...gb, productIds: byId.get(gb.id)! } : gb,
          ),
        );
      }
      revalidateTenant(tenantId, slug);
      return {
        ok: true,
        product: applied.product,
        groupBuys: await loadGroupBuys(tenantId, slug),
        ...(applied.warning ? { warning: applied.warning } : {}),
      };
    }

    // ── DB path ──
    const row = await withTenant(tenantId, (db) =>
      db.product.findFirst({ where: { id: op.productId } }),
    );
    if (!row) return { error: "That product no longer exists." };
    const current = dbProductToStorefront(row as DbProductRow, displaySymbol);

    const applied = applyOp(op, current, rounds);
    if ("error" in applied) return applied;

    // Reseller wholesale data is entitlement-gated: an unentitled tenant's
    // catalog is served stripped, so writing back what we just read would wipe
    // the DB's dormant wholesale legs. Same preserve saveProductAction applies.
    const resellerEntitled = await hasFeature(tenantId, FEATURES.STORE_RESELLER_PORTAL);
    const write = productToDbWrite(
      applied.product,
      currencySymbolToIso(displaySymbol),
      displaySymbol,
    );

    await withTenant(tenantId, async (db) => {
      await db.product.update({
        where: { id: row.id },
        data: {
          metadata: preserveResellerMetadata(
            write.metadata as Record<string, unknown>,
            row.metadata,
            resellerEntitled,
          ) as unknown as Prisma.InputJsonValue,
        },
      });
      for (const u of applied.roundUpdates) {
        await db.groupBuy.update({
          where: { id: u.id },
          data: { productIds: u.productIds as unknown as Prisma.InputJsonValue },
        });
      }
    });

    revalidateTenant(tenantId, slug);
    return {
      ok: true,
      product: applied.product,
      groupBuys: await loadGroupBuys(tenantId, slug),
      ...(applied.warning ? { warning: applied.warning } : {}),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save the pricing." };
  }
}

/**
 * Resolve one operation into the product to store plus any round rewrites.
 * Pure apart from the error strings — the real logic lives in lib/gb-pricing so
 * the admin UI, this action and the test all agree.
 */
function applyOp(
  op: GbPricingOp,
  current: Product,
  rounds: GroupBuy[],
):
  | { product: Product; roundUpdates: { id: string; productIds: string[] }[]; warning?: string }
  | { error: string } {
  if (op.op === "price") {
    const invalid = gbPriceError(current, op.price);
    if (invalid) return { error: invalid };
    return { product: applyGbPrice(current, op.price), roundUpdates: [] };
  }
  if (op.op === "availability") {
    return { product: setPurchasable(current, op.available), roundUpdates: [] };
  }
  const removal = removeFromGroupBuy(current, rounds);
  return {
    product: removal.product,
    roundUpdates: removal.roundUpdates,
    // An emptied round covers the WHOLE catalog everywhere else in the group-buy
    // code, so silently letting it empty would widen the round from one product
    // to everything. The write still goes through — the owner asked for it — but
    // they are told, rather than finding out from the storefront.
    ...(removal.emptiesRound
      ? {
          warning:
            "That was the last product assigned to a group buy — the round now covers your whole catalog. Assign products to it, or close it.",
        }
      : {}),
  };
}

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
