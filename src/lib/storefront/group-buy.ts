// Group Buy domain helpers shared by the server actions, the store admin UI and
// checkout attribution. A group buy is a buying window: orders placed while it is
// live are stamped with its id (StorefrontOrder.groupBuyId) so the owner can roll
// the demand up into one supplier order. Every capability is feature-gated — see
// the groupbuy.* keys in src/lib/features/catalog.ts.

export const GROUP_BUY_STATUSES = [
  "draft",
  "scheduled",
  "active",
  "closed",
  "archived",
] as const;

export type GroupBuyStatus = (typeof GROUP_BUY_STATUSES)[number];

/** The storefront-facing group buy shape (dates as ISO strings — JSON-safe). */
export type GroupBuy = {
  id: string;
  name: string;
  description: string;
  status: GroupBuyStatus;
  startsAt: string | null; // ISO — scheduled go-live (groupbuy.scheduled)
  endsAt: string | null; // ISO — auto-close boundary
  deliveryEta: string; // customer-facing free text, e.g. "3–4 weeks after close"
  productIds: string[]; // assigned products; empty = whole catalog
  // Slot goal for the storefront progress bar ("18 of 30 slots filled"). 0 = the
  // goal is OFF and no progress bar renders — the owner sets/clears it per round.
  slotGoal: number;
  createdAt: string;
  updatedAt: string;
};

/** Report-output entitlements (groupbuy.reports.*) — which export formats and
 *  report sections the supplier-report view may offer. */
export type GroupBuyReportCapabilities = {
  excel: boolean;
  csv: boolean;
  pdf: boolean;
  autoOnClose: boolean;
  customerBreakdown: boolean;
  productBreakdown: boolean;
  supplierSummary: boolean;
};

/** Per-tenant capability flags resolved from entitlements — shipped to the store
 *  admin UI (to hide buttons) and re-checked server-side in every action. */
export type GroupBuyCapabilities = {
  enabled: boolean; // groupbuy.module — master switch
  canCreate: boolean;
  canEdit: boolean;
  canDuplicate: boolean;
  canArchive: boolean;
  scheduled: boolean;
  // NOTE: there is deliberately no `multipleActive` capability. Exactly one
  // active round per tenant is an invariant (rule #4), enforced by the DB partial
  // unique index and by liveGroupBuys — never widened per tenant.
  productAssignment: boolean;
  supplierReports: boolean;
  reports: GroupBuyReportCapabilities;
};

export const GROUP_BUY_CAPS_OFF: GroupBuyCapabilities = {
  enabled: false,
  canCreate: false,
  canEdit: false,
  canDuplicate: false,
  canArchive: false,
  scheduled: false,
  productAssignment: false,
  supplierReports: false,
  reports: {
    excel: false,
    csv: false,
    pdf: false,
    autoOnClose: false,
    customerBreakdown: false,
    productBreakdown: false,
    supplierSummary: false,
  },
};

// ── Per-tenant defaults (branding.config.groupBuySettings) ──────────────────
// Configured by the platform operator on the tenant's Features page; the store
// admin's "New group buy" form prefills from these.

export type GroupBuySettings = {
  defaultStatus: Extract<GroupBuyStatus, "draft" | "scheduled" | "active">;
  defaultDurationDays: number; // prefills endsAt = startsAt + N days
  defaultDeliveryEta: string;
};

export const GROUP_BUY_SETTINGS_DEFAULTS: GroupBuySettings = {
  defaultStatus: "draft",
  defaultDurationDays: 14,
  defaultDeliveryEta: "3–4 weeks after the group buy closes",
};

const DEFAULTABLE_STATUSES = new Set(["draft", "scheduled", "active"]);

export function normalizeGroupBuySettings(input: unknown): GroupBuySettings {
  const x = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const status = DEFAULTABLE_STATUSES.has(String(x.defaultStatus))
    ? (String(x.defaultStatus) as GroupBuySettings["defaultStatus"])
    : GROUP_BUY_SETTINGS_DEFAULTS.defaultStatus;
  const days = Math.round(Number(x.defaultDurationDays));
  return {
    defaultStatus: status,
    defaultDurationDays:
      Number.isFinite(days) && days >= 1 && days <= 365
        ? days
        : GROUP_BUY_SETTINGS_DEFAULTS.defaultDurationDays,
    defaultDeliveryEta:
      typeof x.defaultDeliveryEta === "string" && x.defaultDeliveryEta.trim()
        ? x.defaultDeliveryEta.slice(0, 200)
        : GROUP_BUY_SETTINGS_DEFAULTS.defaultDeliveryEta,
  };
}

// ── Normalization (untrusted input → clean GroupBuy) ────────────────────────

function str(v: unknown, max: number): string {
  if (typeof v === "string") return v.slice(0, max);
  if (v == null) return "";
  return String(v).slice(0, max);
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function normalizeGroupBuy(input: unknown): GroupBuy {
  const x = (input ?? {}) as Record<string, unknown>;
  const status = GROUP_BUY_STATUSES.includes(x.status as GroupBuyStatus)
    ? (x.status as GroupBuyStatus)
    : "draft";
  const productIds = Array.isArray(x.productIds)
    ? x.productIds
        .filter((p): p is string => typeof p === "string" && p.length > 0)
        .slice(0, 500)
        .map((p) => p.slice(0, 64))
    : [];
  const now = new Date().toISOString();
  return {
    id: str(x.id, 64),
    name: str(x.name, 200).trim(),
    description: str(x.description, 2000),
    status,
    startsAt: isoOrNull(x.startsAt),
    endsAt: isoOrNull(x.endsAt),
    deliveryEta: str(x.deliveryEta, 200),
    productIds,
    slotGoal: slotGoalInt(x.slotGoal),
    createdAt: isoOrNull(x.createdAt) ?? now,
    updatedAt: isoOrNull(x.updatedAt) ?? now,
  };
}

/** Coerce an untrusted slot goal to a clean count: a non-negative integer, capped
 *  at a sane ceiling. Anything invalid, negative or absent → 0 (goal off). */
function slotGoalInt(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 100000);
}

// ── Status resolution ────────────────────────────────────────────────────────
// `status` is what the owner stored; the EFFECTIVE status also folds in the
// window: a scheduled run goes live once startsAt passes (when the tenant has
// groupbuy.scheduled) and anything live closes once endsAt passes. Derived on
// read — no cron needed.

export function effectiveGroupBuyStatus(
  gb: Pick<GroupBuy, "status" | "startsAt" | "endsAt">,
  scheduledEnabled: boolean,
  now: Date = new Date(),
): GroupBuyStatus {
  if (gb.status === "draft" || gb.status === "archived" || gb.status === "closed") {
    return gb.status;
  }
  const t = now.getTime();
  if (gb.status === "scheduled") {
    if (!scheduledEnabled) return "scheduled"; // never auto-activates without the flag
    if (gb.startsAt && t < new Date(gb.startsAt).getTime()) return "scheduled";
    if (gb.endsAt && t > new Date(gb.endsAt).getTime()) return "closed";
    return gb.startsAt ? "active" : "scheduled"; // no start date → stays pending
  }
  // status === "active"
  if (gb.endsAt && t > new Date(gb.endsAt).getTime()) return "closed";
  return "active";
}

/** The group buys currently live. At most ONE per tenant — rule #4, an invariant
 *  rather than an entitlement: a tenant can never run two rounds at once. Ties
 *  break on earliest-created so the winner is deterministic, not insertion-ordered.
 *  The DB partial unique index (group_buys_one_active_per_tenant) enforces the same
 *  rule at the storage layer; this slice is the read-side backstop for any row that
 *  predates it. */
export function liveGroupBuys(
  list: GroupBuy[],
  caps: Pick<GroupBuyCapabilities, "scheduled">,
  now: Date = new Date(),
): GroupBuy[] {
  return list
    .filter((gb) => effectiveGroupBuyStatus(gb, caps.scheduled, now) === "active")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, 1);
}

/**
 * Rounds stored as `status = 'active'` whose window has since lapsed (effective
 * status "closed"). effectiveGroupBuyStatus derives the close on read, so nothing
 * ever persists it — a lapsed round lingers stored-active indefinitely. The save
 * path closes these before activating a new round; otherwise the DB partial
 * unique index (group_buys_one_active_per_tenant, one stored-active per tenant)
 * would false-reject a legitimate activation against a round that is really over.
 */
export function staleActiveRoundIds(
  list: GroupBuy[],
  caps: Pick<GroupBuyCapabilities, "scheduled">,
  now: Date = new Date(),
): string[] {
  return list
    .filter(
      (gb) =>
        gb.status === "active" &&
        effectiveGroupBuyStatus(gb, caps.scheduled, now) === "closed",
    )
    .map((gb) => gb.id);
}

/**
 * The group buy an order belongs to, decided server-side at placement: the first
 * live run whose product assignment covers at least one ordered line (runs with
 * no assignment — or when the tenant lacks groupbuy.product_assignment — cover
 * the whole catalog).
 */
export function groupBuyForOrder(
  list: GroupBuy[],
  caps: Pick<GroupBuyCapabilities, "scheduled" | "productAssignment">,
  orderedProductIds: string[],
  now: Date = new Date(),
): GroupBuy | null {
  const live = liveGroupBuys(list, caps, now);
  for (const gb of live) {
    if (!caps.productAssignment || gb.productIds.length === 0) return gb;
    if (orderedProductIds.some((id) => gb.productIds.includes(id))) return gb;
  }
  return null;
}

// ── Storefront gate (on-hand products during a live run) ────────────────────
// When a group buy is live AND product assignment is in use, products that
// aren't assigned to any live run are "on-hand" (regular stock). The owner can
// choose (branding.config.groupBuyAllowOnHand) whether customers may still buy
// those on-hand products while the run is open, or only the group-buy products.
// Computed server-side and shipped to the storefront so the cart can disable
// blocked add-to-cart; placeStorefrontOrderAction re-checks the same gate.

export type GroupBuyStorefrontGate = {
  active: boolean; // a group buy is currently live
  allowOnHand: boolean; // may on-hand (non-group-buy) products be added while active
  coversAll: boolean; // a live run covers the whole catalog → no on-hand distinction
  productIds: string[]; // products covered by a live run (meaningful only when !coversAll)
};

export const GROUP_BUY_GATE_OPEN: GroupBuyStorefrontGate = {
  active: false,
  allowOnHand: true,
  coversAll: true,
  productIds: [],
};

export function buildGroupBuyGate(
  list: GroupBuy[],
  caps: Pick<GroupBuyCapabilities, "scheduled" | "productAssignment">,
  allowOnHand: boolean,
  now: Date = new Date(),
): GroupBuyStorefrontGate {
  const live = liveGroupBuys(list, caps, now);
  if (live.length === 0) return GROUP_BUY_GATE_OPEN;
  // Without product assignment every live run covers the whole catalog, so there
  // is no on-hand vs group-buy split to gate.
  if (!caps.productAssignment) {
    return { active: true, allowOnHand: true, coversAll: true, productIds: [] };
  }
  const ids = new Set<string>();
  for (const gb of live) {
    if (gb.productIds.length === 0) {
      return { active: true, allowOnHand: true, coversAll: true, productIds: [] };
    }
    gb.productIds.forEach((id) => ids.add(id));
  }
  return { active: true, allowOnHand, coversAll: false, productIds: [...ids] };
}

/** True when `productId` is an on-hand (non-group-buy) product that the owner has
 *  chosen to block while a group buy is live. Anything covered by a live run, or
 *  when on-hand sales are allowed / no run is live, is never blocked. */
export function isOnHandBlocked(
  productId: string,
  gate: GroupBuyStorefrontGate | undefined,
): boolean {
  if (!gate || !gate.active || gate.allowOnHand || gate.coversAll) return false;
  return !gate.productIds.includes(productId);
}

// ── DB row mapping (group_buys table ↔ storefront type) ─────────────────────

export type DbGroupBuyRow = {
  id: string;
  name: string;
  description: string;
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
  deliveryEta: string;
  productIds: unknown;
  slotGoal?: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export function dbGroupBuyToStorefront(row: DbGroupBuyRow): GroupBuy {
  return normalizeGroupBuy({
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    deliveryEta: row.deliveryEta,
    productIds: row.productIds,
    slotGoal: row.slotGoal ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function groupBuyToDbWrite(gb: GroupBuy) {
  return {
    name: gb.name,
    description: gb.description,
    status: gb.status,
    startsAt: gb.startsAt ? new Date(gb.startsAt) : null,
    endsAt: gb.endsAt ? new Date(gb.endsAt) : null,
    deliveryEta: gb.deliveryEta,
    productIds: gb.productIds,
    slotGoal: gb.slotGoal,
  };
}

// ── Supplier report ──────────────────────────────────────────────────────────
// Aggregated per-product quantities across a group buy's orders — the list the
// owner sends the supplier. Two number sets, reported side by side (spec §6):
//
//   DEMAND    — every order EXCEPT cancelled / canceled / refunded, paid or not.
//               The headline: what the supplier order is sized against. The
//               instinct to "only count paid" under-orders and is wrong here.
//   COMMITTED — the DEMAND subset that is paymentStatus 'paid' OR a fulfilled
//               order status. Reported ALONGSIDE demand, never instead of it.

export type SupplierReportLine = {
  productId: string | null; // null = legacy/name-only line
  name: string;
  qty: number; // DEMAND qty
  revenue: number; // DEMAND revenue (qty × price)
  committedQty: number; // committed subset of qty
  committedRevenue: number; // committed subset of revenue
};

export type SupplierReport = {
  groupBuyId: string;
  // DEMAND (headline)
  orderCount: number;
  totalQty: number;
  totalRevenue: number;
  // COMMITTED (alongside)
  committedOrderCount: number;
  committedTotalQty: number;
  committedTotalRevenue: number;
  lines: SupplierReportLine[];
};

type ReportOrder = {
  status: string;
  paymentStatus?: string;
  items: Array<{ name: string; qty: number; price: number; productId?: string }>;
};

// Excluded from demand entirely. Both English spellings + refunds. Exported as
// the single source of truth so every "counts as demand" surface — the supplier
// report here AND the storefront's live-round filled-slot count (page.tsx) —
// shares one list instead of re-hardcoding it and silently drifting.
export const DEMAND_EXCLUDED_STATUS_LIST = ["cancelled", "canceled", "refunded"] as const;
const DEMAND_EXCLUDED_STATUSES = new Set<string>(DEMAND_EXCLUDED_STATUS_LIST);
// Order statuses that mark an order committed regardless of payment.
const COMMITTED_STATUSES = new Set(["confirmed", "processing", "shipped", "delivered", "completed"]);

/** Whether an order status feeds supplier-report DEMAND (everything except
 *  cancelled / canceled / refunded). Exported so every report surface — the
 *  supplier lines AND the per-customer breakdown — shares one definition. */
export function orderCountsAsDemand(status: string): boolean {
  return !DEMAND_EXCLUDED_STATUSES.has(status.toLowerCase());
}
function isDemand(o: ReportOrder): boolean {
  return orderCountsAsDemand(o.status);
}
function isCommitted(o: ReportOrder): boolean {
  return o.paymentStatus?.toLowerCase() === "paid" || COMMITTED_STATUSES.has(o.status.toLowerCase());
}

export function buildSupplierReport(groupBuyId: string, orders: ReportOrder[]): SupplierReport {
  const counted = orders.filter(isDemand);
  const byKey = new Map<string, SupplierReportLine>();
  let committedOrderCount = 0;
  for (const o of counted) {
    const committed = isCommitted(o); // subset of demand: `counted` already excludes cancels
    if (committed) committedOrderCount++;
    for (const it of o.items) {
      const key = it.productId ?? `name:${it.name}`;
      const line = byKey.get(key) ?? {
        productId: it.productId ?? null,
        name: it.name,
        qty: 0,
        revenue: 0,
        committedQty: 0,
        committedRevenue: 0,
      };
      line.qty += it.qty;
      line.revenue += it.qty * it.price;
      if (committed) {
        line.committedQty += it.qty;
        line.committedRevenue += it.qty * it.price;
      }
      byKey.set(key, line);
    }
  }
  const lines = [...byKey.values()].sort((a, b) => b.qty - a.qty);
  return {
    groupBuyId,
    orderCount: counted.length,
    totalQty: lines.reduce((s, l) => s + l.qty, 0),
    totalRevenue: lines.reduce((s, l) => s + l.revenue, 0),
    committedOrderCount,
    committedTotalQty: lines.reduce((s, l) => s + l.committedQty, 0),
    committedTotalRevenue: lines.reduce((s, l) => s + l.committedRevenue, 0),
    lines,
  };
}
