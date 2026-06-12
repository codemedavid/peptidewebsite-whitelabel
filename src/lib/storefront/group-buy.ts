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
  multipleActive: boolean;
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
  multipleActive: false,
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
    createdAt: isoOrNull(x.createdAt) ?? now,
    updatedAt: isoOrNull(x.updatedAt) ?? now,
  };
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

/** The group buys currently live, honoring the multiple-active entitlement:
 *  without it, only the earliest-created live run counts. */
export function liveGroupBuys(
  list: GroupBuy[],
  caps: Pick<GroupBuyCapabilities, "scheduled" | "multipleActive">,
  now: Date = new Date(),
): GroupBuy[] {
  const live = list
    .filter((gb) => effectiveGroupBuyStatus(gb, caps.scheduled, now) === "active")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return caps.multipleActive ? live : live.slice(0, 1);
}

/**
 * The group buy an order belongs to, decided server-side at placement: the first
 * live run whose product assignment covers at least one ordered line (runs with
 * no assignment — or when the tenant lacks groupbuy.product_assignment — cover
 * the whole catalog).
 */
export function groupBuyForOrder(
  list: GroupBuy[],
  caps: Pick<GroupBuyCapabilities, "scheduled" | "multipleActive" | "productAssignment">,
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
  };
}

// ── Supplier report ──────────────────────────────────────────────────────────
// Aggregated per-product quantities across a group buy's orders — the list the
// owner sends the supplier. Cancelled orders are excluded.

export type SupplierReportLine = {
  productId: string | null; // null = legacy/name-only line
  name: string;
  qty: number;
  revenue: number; // qty × price across the counted orders
};

export type SupplierReport = {
  groupBuyId: string;
  orderCount: number;
  totalQty: number;
  totalRevenue: number;
  lines: SupplierReportLine[];
};

type ReportOrder = {
  status: string;
  items: Array<{ name: string; qty: number; price: number; productId?: string }>;
};

export function buildSupplierReport(groupBuyId: string, orders: ReportOrder[]): SupplierReport {
  const counted = orders.filter((o) => o.status !== "cancelled");
  const byKey = new Map<string, SupplierReportLine>();
  for (const o of counted) {
    for (const it of o.items) {
      const key = it.productId ?? `name:${it.name}`;
      const line = byKey.get(key) ?? {
        productId: it.productId ?? null,
        name: it.name,
        qty: 0,
        revenue: 0,
      };
      line.qty += it.qty;
      line.revenue += it.qty * it.price;
      byKey.set(key, line);
    }
  }
  const lines = [...byKey.values()].sort((a, b) => b.qty - a.qty);
  return {
    groupBuyId,
    orderCount: counted.length,
    totalQty: lines.reduce((s, l) => s + l.qty, 0),
    totalRevenue: lines.reduce((s, l) => s + l.revenue, 0),
    lines,
  };
}
