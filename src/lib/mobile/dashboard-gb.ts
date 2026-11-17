import "server-only";

import { getDashboardGroupBuyAction } from "@/actions/group-buys";
import { formatDashboardMoney } from "@/lib/storefront/admin-dashboard";
import {
  buildGroupBuyAlerts,
  buildGroupBuyPanel,
  canSeeGroupBuyPanel,
  GB_VIEW_JOINS,
  GB_VIEW_ROUND,
  type GbCatalogEntry,
  type GbKitRow,
  type GbPanel,
} from "@/lib/storefront/admin-dashboard-gb";
import { ADMIN_VIEWER } from "@/lib/storefront/gb-access.server";
import type { GroupBuy } from "@/lib/storefront/group-buy";
import { loadStorefrontBrand } from "@/lib/storefront/storefront-brand";
import type { Product } from "@/storefront/types";
import { asAppActor } from "./admin-bridge";
import type { MobileContext } from "./auth";
import { mobileCan } from "./branding";
import type { DashboardAlert, DashboardAlertTarget, DashboardGbKit, DashboardGroupBuyResponse } from "./contract";

/**
 * GET /dashboard/group-buy — the website dashboard's Group Buy card
 * (storefront/admin/DashboardGroupBuy.tsx), display-ready for the app.
 *
 * Same gate (canSeeGroupBuyPanel: module on, actor granted, not trial-locked),
 * same single round trip (getDashboardGroupBuyAction, run as this app user so
 * its requireGroupBuyAdmin guard still decides), and the same pure builders
 * (buildGroupBuyPanel / buildGroupBuyAlerts) — so the phone card can never
 * disagree with the website card or the round's own dashboard. Money (the
 * unpaid amount) only with Sales Analytics, like the website.
 *
 * Kept off GET /dashboard: it loads every round and order of the store, and
 * Home polls /dashboard every few seconds.
 */

const STORE_TZ = "Asia/Manila";

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: STORE_TZ });
}

/** DashboardGroupBuy kitNote. */
export function kitNote(k: GbKitRow): string {
  if (k.remaining === 0) return `${k.fullKits} ${k.fullKits === 1 ? "kit" : "kits"} full ✓`;
  const base = `${k.inKit}/${k.perKit} · ${k.remaining} more closes kit ${k.fullKits + 1}`;
  return k.tone === "risk" ? `${base} · at risk` : base;
}

/** "Supplier order so far: 4 full kits + 2 partial (5 vials short)". */
export function supplierLabel(panel: GbPanel): string | null {
  const s = panel.supplier;
  if (!s) return null;
  const lead = panel.mode === "live" ? "Supplier order so far" : "Supplier order at close";
  const full = `${s.fullKits} full ${s.fullKits === 1 ? "kit" : "kits"}`;
  const partial = s.partialKits > 0 ? ` + ${s.partialKits} partial (${s.shortBy} ${s.shortBy === 1 ? "vial" : "vials"} short)` : "";
  return `${lead}: ${full}${partial}`;
}

function nextRef(next: GroupBuy | null): (DashboardGroupBuyResponse & { status: "empty" })["next"] {
  if (!next) return null;
  return { id: next.id, name: next.name, opensLabel: next.startsAt ? `Opens ${shortDate(next.startsAt)}` : "Scheduled · no start date yet" };
}

const GB_TARGET: Record<string, DashboardAlertTarget> = { [GB_VIEW_JOINS]: "gb-joins", [GB_VIEW_ROUND]: "gb-round" };

/** Pure projection of the website card's state into the app contract. */
export function projectGroupBuyCard(input: {
  panel: GbPanel;
  next: GroupBuy | null;
  currency: string | undefined;
}): DashboardGroupBuyResponse {
  const { panel, next, currency } = input;
  const alerts: DashboardAlert[] = buildGroupBuyAlerts(panel, currency).map((a) => ({
    id: a.id,
    title: a.title,
    sub: a.sub,
    tone: a.tone,
    target: GB_TARGET[a.view] ?? "group-buys",
  }));
  const kits: DashboardGbKit[] = panel.kits.map((k) => ({ id: k.id, name: k.name, note: kitNote(k), pct: k.pct, tone: k.tone }));
  return {
    status: "ready",
    mode: panel.mode,
    round: { id: panel.roundId, name: panel.roundName },
    timing: { label: panel.timing.label, tone: panel.timing.tone },
    orders: panel.orders,
    buyers: panel.buyers,
    vials: panel.vials,
    unpaidOrders: panel.unpaidOrders,
    unpaidLabel: panel.unpaidAmount !== null ? formatDashboardMoney(panel.unpaidAmount, currency) : null,
    joinsWaiting: panel.joinsWaiting,
    kits,
    untrackedProducts: panel.untrackedProducts,
    supplierLabel: supplierLabel(panel),
    next: nextRef(next),
    alerts,
  };
}

function kitCatalog(products: Product[]): Map<string, GbCatalogEntry> {
  return new Map(products.map((p) => [p.id, { name: p.name, vialsPerKit: p.vialsPerKit }]));
}

/** The card, or the website guard's own `{ error }` wording. */
export async function buildDashboardGroupBuy(ctx: MobileContext): Promise<DashboardGroupBuyResponse | { error: string }> {
  const { brand, products } = await asAppActor(ctx, () =>
    loadStorefrontBrand({
      tenantId: ctx.tenantId,
      slug: ctx.slug,
      isResellerUnlocked: async () => false,
      groupBuyViewer: async () => ADMIN_VIEWER,
    }),
  );
  if (!canSeeGroupBuyPanel(brand, ctx.actor)) return { status: "off" };

  const res = await asAppActor(ctx, () => getDashboardGroupBuyAction());
  if ("error" in res) return { error: res.error };
  if (!res.focus || !res.analytics) return { status: "empty", next: nextRef(res.next) };

  const panel = buildGroupBuyPanel({
    focus: res.focus,
    analytics: res.analytics,
    orderRows: res.orderRows,
    catalog: kitCatalog(products),
    joinsWaiting: res.joinsWaiting,
    showMoney: mobileCan(ctx).analytics,
  });
  return projectGroupBuyCard({ panel, next: res.next, currency: brand.currency });
}
