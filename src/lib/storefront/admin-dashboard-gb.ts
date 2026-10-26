/**
 * Store-admin dashboard — the Group Buy panel. On a group-buy store the generic
 * "Stock levels" panel says nothing useful (every pre-order item reads "Out of
 * stock"), so the dashboard leads with the round instead: how it is filling,
 * who still owes money, who is waiting to be let in, and which kits are short.
 *
 * Every number is derived from the SAME per-round analytics the round's own
 * dashboard renders (getGroupBuyDashboardAction → buildRoundAnalytics), so the
 * home screen can never disagree with the page it links to.
 *
 * Pure: no DB, no React, no Next runtime. Covered by
 * scripts/test-admin-dashboard-gb.ts.
 */

import {
  effectiveGroupBuyStatus,
  liveGroupBuys,
  type GroupBuy,
} from "./group-buy";
import type { RoundAnalytics } from "./group-buy-analytics";
import type { RoundOrderRow } from "./group-buy-orders";
import { kitProgress } from "./gb-moq-kits";
import type { AttentionAlert, MetricTone } from "./admin-dashboard";
import type { Brand } from "@/storefront/types";
import { isAdminModuleLocked, isAdminViewVisible } from "@/storefront/visibility";
import { isViewAllowed, type StaffActor } from "@/storefront/admin/staff-permissions";

// ── Constants ────────────────────────────────────────────────────────────────

/** Kit rows shown before "Manage round". */
const KIT_ROW_LIMIT = 6;

/** A kit this close to full (share of its size) reads as "almost there". */
const CLOSE_TO_FULL_RATIO = 0.3;

/** A kit under this share of full is "at risk" of being short at close. */
const AT_RISK_RATIO = 0.5;

/** Within this many days of close, short kits become a dashboard alert. */
export const CLOSING_SOON_DAYS = 3;

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * View ids the panel and its alerts emit. AdminPage resolves them to the real
 * views (Group Buys on its Join requests tab, or the round's own dashboard) —
 * both still pass through its activeView permission guard.
 */
export const GB_VIEW_JOINS = "gb:joins";
export const GB_VIEW_ROUND = "gb:round";
export const GB_VIEW_MANAGE = "groupbuys";

// ── Access ───────────────────────────────────────────────────────────────────

/** May this actor see the Group Buy panel? The same three checks AdminPage's
 *  view guard applies to the Group Buys view: module on, actor granted, and
 *  not a visible-but-locked trial module. */
export function canSeeGroupBuyPanel(brand: Brand, actor: StaffActor): boolean {
  return (
    isAdminViewVisible(brand, "groupbuys") &&
    isViewAllowed(actor, "groupbuys") &&
    !isAdminModuleLocked(brand, "groupbuys")
  );
}

// ── Which round ──────────────────────────────────────────────────────────────

export type FocusRound = { round: GroupBuy; mode: "live" | "recap" };

/**
 * The round the dashboard talks about: the live one if any; otherwise the most
 * recently finished (closed, not archived) round as a recap; otherwise null.
 */
export function pickFocusRound(
  groupBuys: GroupBuy[],
  scheduledEnabled: boolean,
  now: Date = new Date(),
): FocusRound | null {
  const [live] = liveGroupBuys(groupBuys, { scheduled: scheduledEnabled }, now);
  if (live) return { round: live, mode: "live" };

  const finished = groupBuys
    .filter((gb) => effectiveGroupBuyStatus(gb, scheduledEnabled, now) === "closed")
    .sort((a, b) => finishedAt(b).localeCompare(finishedAt(a)));
  return finished[0] ? { round: finished[0], mode: "recap" } : null;
}

/** The next round that has not started yet, soonest first — or null. */
export function pickNextRound(
  groupBuys: GroupBuy[],
  scheduledEnabled: boolean,
  now: Date = new Date(),
): GroupBuy | null {
  const upcoming = groupBuys
    .filter((gb) => effectiveGroupBuyStatus(gb, scheduledEnabled, now) === "scheduled")
    .sort((a, b) => (a.startsAt ?? "~").localeCompare(b.startsAt ?? "~"));
  return upcoming[0] ?? null;
}

function finishedAt(gb: GroupBuy): string {
  return gb.closedAt ?? gb.endsAt ?? gb.updatedAt ?? "";
}

// ── Panel ────────────────────────────────────────────────────────────────────

export type KitTone = "full" | "close" | "filling" | "risk";

export type GbKitRow = {
  id: string;
  name: string;
  /** Round demand for this product, every variation combined. */
  vials: number;
  inKit: number;
  perKit: number;
  /** Vials still needed to complete the kit currently filling. 0 = full. */
  remaining: number;
  fullKits: number;
  /** Bar width 0..100 for the kit currently filling. */
  pct: number;
  tone: KitTone;
};

export type GbTiming = { label: string; tone: MetricTone; daysLeft: number | null };

export type GbSupplierSummary = { fullKits: number; partialKits: number; shortBy: number };

export type GbPanel = {
  mode: "live" | "recap";
  roundId: string;
  roundName: string;
  timing: GbTiming;
  /** Orders that still count (cancelled excluded). */
  orders: number;
  buyers: number;
  vials: number;
  /** Orders still marked unpaid (cancelled excluded). */
  unpaidOrders: number;
  /** Their value — null unless the actor may see money (Sales Analytics). */
  unpaidAmount: number | null;
  /** Paid-join receipts waiting for approval on this round — null when the
   *  store doesn't have paid join. */
  joinsWaiting: number | null;
  kits: GbKitRow[];
  /** Products ordered in this round that have no kit size set. */
  untrackedProducts: number;
  /** The supplier order as it stands, kit-tracked products only. */
  supplier: GbSupplierSummary | null;
};

export type GbCatalogEntry = { name: string; vialsPerKit?: number };

export type GbPanelInput = {
  focus: FocusRound;
  analytics: RoundAnalytics;
  orderRows: RoundOrderRow[];
  /** product id → name + kit size, from the store's catalog. */
  catalog: ReadonlyMap<string, GbCatalogEntry>;
  joinsWaiting: number | null;
  showMoney: boolean;
  now?: Date;
};

export function buildGroupBuyPanel(input: GbPanelInput): GbPanel {
  const { focus, analytics, orderRows, catalog } = input;
  const { kits, untracked } = buildKitRows(analytics, catalog);

  return {
    mode: focus.mode,
    roundId: focus.round.id,
    roundName: focus.round.name,
    timing: roundTiming(focus, input.now ?? new Date()),
    orders: analytics.overview.totalOrders - analytics.financial.cancelledOrders,
    buyers: analytics.overview.participants,
    vials: analytics.product.totalVials,
    unpaidOrders: countUnpaidOrders(orderRows),
    unpaidAmount: input.showMoney ? analytics.financial.outstandingBalance : null,
    joinsWaiting: input.joinsWaiting,
    kits: sortKits(kits).slice(0, KIT_ROW_LIMIT),
    untrackedProducts: untracked,
    supplier: kits.length > 0 ? summarizeSupplier(kits) : null,
  };
}

/** "Closes in 3 days" / "Closes in 5 hours" / "Closed Oct 12" — and how urgent. */
export function roundTiming(focus: FocusRound, now: Date = new Date()): GbTiming {
  const { round, mode } = focus;
  if (mode === "recap") {
    const at = finishedAt(round);
    return { label: at ? `Closed ${shortDate(at)}` : "Closed", tone: "neutral", daysLeft: null };
  }
  if (!round.endsAt) return { label: "Open · no close date", tone: "neutral", daysLeft: null };

  const ms = new Date(round.endsAt).getTime() - now.getTime();
  if (Number.isNaN(ms)) return { label: "Open", tone: "neutral", daysLeft: null };
  if (ms <= MS_PER_DAY) {
    const hours = Math.max(1, Math.ceil(ms / MS_PER_HOUR));
    return { label: `Closes in ${hours} ${hours === 1 ? "hour" : "hours"}`, tone: "bad", daysLeft: 0 };
  }
  const daysLeft = Math.ceil(ms / MS_PER_DAY);
  return {
    label: `Closes in ${daysLeft} days`,
    tone: daysLeft <= CLOSING_SOON_DAYS ? "warn" : "neutral",
    daysLeft,
  };
}

/** Distinct unpaid orders. Rows are per order LINE, so an order with three
 *  products counts once; cancelled orders never count. */
export function countUnpaidOrders(rows: RoundOrderRow[]): number {
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    if (!r.counted || r.paymentStatus !== "Pending") return;
    seen.add(r.orderNumber || `${r.customer}|${r.orderDate}|${i}`);
  });
  return seen.size;
}

/** Kit rows per PRODUCT — variations share their product's kit, so the
 *  per-variation "products to order" lines fold back together. */
function buildKitRows(
  analytics: RoundAnalytics,
  catalog: GbPanelInput["catalog"],
): { kits: GbKitRow[]; untracked: number } {
  const demand = new Map<string, { vials: number; name: string; perKit: number }>();
  const untracked = new Set<string>();

  for (const line of analytics.product.productsToOrder) {
    const entry = line.productId ? catalog.get(line.productId) : undefined;
    if (!line.productId || !entry?.vialsPerKit) {
      untracked.add(line.productId ?? line.product);
      continue;
    }
    const cur = demand.get(line.productId);
    demand.set(line.productId, {
      vials: (cur?.vials ?? 0) + line.vials,
      name: entry.name || line.product,
      perKit: entry.vialsPerKit,
    });
  }

  const kits = [...demand].flatMap(([id, d]): GbKitRow[] => {
    const p = kitProgress(d.vials, d.perKit);
    if (!p) return [];
    return [
      {
        id,
        name: d.name,
        vials: d.vials,
        inKit: p.inKit,
        perKit: p.perKit,
        remaining: p.remaining,
        fullKits: p.fullKits,
        pct: Math.round((p.inKit / p.perKit) * 100),
        tone: kitTone(p.inKit, p.perKit, p.remaining),
      },
    ];
  });
  return { kits, untracked: untracked.size };
}

function kitTone(inKit: number, perKit: number, remaining: number): KitTone {
  if (remaining === 0) return "full";
  if (remaining <= Math.max(1, Math.ceil(perKit * CLOSE_TO_FULL_RATIO))) return "close";
  return inKit / perKit < AT_RISK_RATIO ? "risk" : "filling";
}

/** Closest-to-full first (the ones worth one more push), full kits last. */
function sortKits(kits: GbKitRow[]): GbKitRow[] {
  return [...kits].sort((a, b) => {
    const aFull = a.remaining === 0 ? 1 : 0;
    const bFull = b.remaining === 0 ? 1 : 0;
    return aFull - bFull || a.remaining - b.remaining || a.name.localeCompare(b.name);
  });
}

function summarizeSupplier(kits: GbKitRow[]): GbSupplierSummary {
  return kits.reduce<GbSupplierSummary>(
    (acc, k) => {
      const partial = k.remaining > 0;
      return {
        fullKits: acc.fullKits + k.fullKits,
        partialKits: acc.partialKits + (partial ? 1 : 0),
        shortBy: acc.shortBy + (partial ? k.remaining : 0),
      };
    },
    { fullKits: 0, partialKits: 0, shortBy: 0 },
  );
}

// ── Needs attention ──────────────────────────────────────────────────────────

/**
 * Group-buy entries for the "Needs attention" list. Only a LIVE round raises
 * them — a finished round's numbers show on the recap, not as a nag.
 */
export function buildGroupBuyAlerts(panel: GbPanel | null, currency?: string): AttentionAlert[] {
  if (!panel || panel.mode !== "live") return [];
  const alerts: AttentionAlert[] = [];

  if (panel.joinsWaiting !== null && panel.joinsWaiting > 0) {
    alerts.push({
      id: "gb-joins",
      title: `${plural(panel.joinsWaiting, "join request is", "join requests are")} waiting for approval`,
      sub: `${panel.roundName} · review receipts`,
      tone: "bad",
      view: GB_VIEW_JOINS,
    });
  }

  if (panel.unpaidOrders > 0) {
    const money =
      panel.unpaidAmount !== null && panel.unpaidAmount > 0
        ? ` · ${currency || "₱"}${panel.unpaidAmount.toLocaleString()}`
        : "";
    alerts.push({
      id: "gb-unpaid",
      title: `${plural(panel.unpaidOrders, "group-buy order is", "group-buy orders are")} unpaid`,
      sub: `${panel.roundName}${money}`,
      tone: "warn",
      view: GB_VIEW_ROUND,
    });
  }

  const { daysLeft } = panel.timing;
  if (panel.supplier && panel.supplier.partialKits > 0 && daysLeft !== null && daysLeft <= CLOSING_SOON_DAYS) {
    const { partialKits, shortBy } = panel.supplier;
    alerts.push({
      id: "gb-short-kits",
      title: `${plural(partialKits, "kit is", "kits are")} short · ${panel.timing.label.toLowerCase()}`,
      sub: `${plural(shortBy, "more vial", "more vials")} fills them`,
      tone: "warn",
      view: GB_VIEW_ROUND,
    });
  }

  return alerts;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
