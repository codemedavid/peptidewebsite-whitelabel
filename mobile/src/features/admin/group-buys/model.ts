import type { Tone } from "@contract";

/**
 * The Group Buy shapes and the PURE rules the website's Group Buys admin applies
 * client-side (src/storefront/admin/AdminGroupBuys*.tsx). The app can't import
 * website code, so each rule names its source. Every save re-runs the server's
 * own normalizer and entitlement checks — these only keep the form honest.
 */

// ── shapes (src/lib/storefront/group-buy.ts, group-buy-analytics.ts, …) ───────

export type GroupBuyStatus = "draft" | "scheduled" | "active" | "closed" | "cancelled" | "archived";

export type GroupBuy = {
  id: string;
  name: string;
  description: string;
  status: GroupBuyStatus;
  startsAt: string | null;
  endsAt: string | null;
  deliveryEta: string;
  productIds: string[];
  slotGoal: number;
  batchNumber: string;
  minVials: number | null;
  maxVials: number | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GroupBuyCapabilities = {
  enabled: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDuplicate: boolean;
  canArchive: boolean;
  scheduled: boolean;
  productAssignment: boolean;
  supplierReports: boolean;
  reports: {
    excel: boolean;
    csv: boolean;
    pdf: boolean;
    autoOnClose: boolean;
    customerBreakdown: boolean;
    productBreakdown: boolean;
    supplierSummary: boolean;
  };
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

export type GroupBuySettings = {
  defaultStatus: "draft" | "scheduled" | "active";
  defaultDurationDays: number;
  defaultDeliveryEta: string;
};

export const GROUP_BUY_SETTINGS_DEFAULTS: GroupBuySettings = {
  defaultStatus: "draft",
  defaultDurationDays: 14,
  defaultDeliveryEta: "3–4 weeks after the group buy closes",
};

export type RoundDisplayStatus = "Draft" | "Scheduled" | "Open" | "Completed" | "Cancelled" | "Archived";

export type RoundListRow = {
  id: string;
  name: string;
  productName: string;
  batchNumber: string;
  status: RoundDisplayStatus;
  currentVials: number;
  maxVials: number | null;
  totalOrders: number;
  participants: number;
  grossIncome: number;
  createdAt: string;
};

export type PaymentDisplayStatus = "Pending" | "Confirmed" | "Cancelled";

export type RoundOrderRow = {
  orderNumber: string;
  customer: string;
  contact: string;
  address: string;
  product: string;
  productId: string | null;
  batch: string;
  vials: number;
  price: number;
  orderDate: string;
  paymentMethod: string;
  paymentStatus: PaymentDisplayStatus;
  orderStatus: string;
  proofUrl: string | null;
  customerNote: string;
  counted: boolean;
};

export type RoundSummary = {
  totalOrders: number;
  activeOrders: number;
  confirmedOrders: number;
  pendingOrders: number;
  cancelledOrders: number;
  totalVials: number;
  totalSales: number;
};

export type ProductToOrder = {
  product: string;
  productId: string | null;
  variation: string | null;
  vials: number;
  orders: number;
};

export type ReportCustomerLine = {
  name: string;
  email: string;
  contact: string;
  address: string;
  orders: number;
  qty: number;
  total: number;
};

export type ReportPrep = {
  supplierFilename: string;
  customerFilename: string;
  totals: { label: string; value: string | number }[];
  counts: RoundSummary;
  productsToOrder: ProductToOrder[];
  summary: {
    product: string;
    productId: string | null;
    variation: string | null;
    demandQty: number;
    committedQty: number;
    orders: number;
  }[];
  orderLines: RoundOrderRow[];
  customerLines: ReportCustomerLine[];
};

export type RoundAnalytics = {
  overview: {
    name: string;
    productName: string;
    batchNumber: string;
    status: RoundDisplayStatus;
    createdAt: string;
    closedAt: string | null;
    currentVials: number;
    maxVials: number | null;
    minVials: number | null;
    minimumMet: boolean | null;
    participants: number;
    totalOrders: number;
  };
  financial: {
    grossIncome: number;
    confirmedPayments: number;
    pendingPayments: number;
    cancelledOrders: number;
    revenueCollected: number;
    outstandingBalance: number;
  };
  product: {
    totalVials: number;
    confirmedVials: number;
    pendingVials: number;
    cancelledVials: number;
    remainingVials: number | null;
    completionPct: number | null;
    productsToOrder: ProductToOrder[];
  };
};

export type DriftProduct = { productId: string; name: string; vials: number; orders: number };

export type AssignmentDrift = {
  coversWholeCatalog: boolean;
  orderedUnassigned: DriftProduct[];
  assignedUnsold: DriftProduct[];
  danglingAssignments: string[];
  hasDrift: boolean;
};

export type GroupBuyContent = { howTitle: string; steps: string[]; terms: string };

export type WayState = "open" | "closed" | "hidden";
export type TwoWaysMode = { onHand: WayState; groupBuy: WayState };
export type WayKey = keyof TwoWaysMode;

// ── action results (src/actions/group-buys.ts) ───────────────────────────────

export type ListResult = {
  ok: true;
  groupBuys: GroupBuy[];
  rows: RoundListRow[];
  caps: GroupBuyCapabilities;
  settings: GroupBuySettings;
  content: GroupBuyContent;
  /** Absent on a server that predates the live strip. */
  liveBanner?: GroupBuyLiveBanner;
  /** Storefront hero countdown settings. Absent on a server that predates it. */
  heroCountdown?: HeroCountdownConfig;
  /** Pay-after-close invoices (invoice.ts). Absent on older servers. */
  invoice?: unknown;
};

export type DashboardResult = {
  ok: true;
  groupBuy: GroupBuy;
  analytics: RoundAnalytics;
  orderRows: RoundOrderRow[];
  prep: ReportPrep;
  caps: GroupBuyCapabilities;
  unlinked: number;
  drift: AssignmentDrift;
};

export type ReportResult = {
  ok: true;
  customers: ReportCustomerLine[] | null;
  prep: ReportPrep;
  counts: RoundSummary;
  productsToOrder: ProductToOrder[];
  orderRows: RoundOrderRow[];
  unlinked: number;
};

// ── status (group-buy.ts effectiveGroupBuyStatus, group-buy-report.ts) ───────

/** Derived on read — no cron — exactly as the website derives it. */
export function effectiveGroupBuyStatus(
  gb: Pick<GroupBuy, "status" | "startsAt" | "endsAt">,
  scheduledEnabled: boolean,
  now: Date = new Date(),
): GroupBuyStatus {
  if (gb.status === "draft" || gb.status === "archived" || gb.status === "closed" || gb.status === "cancelled") {
    return gb.status;
  }
  const t = now.getTime();
  if (gb.status === "scheduled") {
    if (!scheduledEnabled) return "scheduled";
    if (gb.startsAt && t < new Date(gb.startsAt).getTime()) return "scheduled";
    if (gb.endsAt && t > new Date(gb.endsAt).getTime()) return "closed";
    return gb.startsAt ? "active" : "scheduled";
  }
  if (gb.endsAt && t > new Date(gb.endsAt).getTime()) return "closed";
  return "active";
}

/** Finished-but-unarchived rounds — the persistent "Reports ready" badge. */
export function roundsAwaitingReport<T extends Pick<GroupBuy, "status" | "startsAt" | "endsAt">>(
  rounds: T[],
  scheduledEnabled: boolean,
): T[] {
  return rounds.filter(
    (gb) => gb.status !== "archived" && gb.status !== "cancelled" && effectiveGroupBuyStatus(gb, scheduledEnabled) === "closed",
  );
}

/** The website's status chip tints, as the app's tones (icon + words, never colour alone). */
export const STATUS_TONE: Record<GroupBuyStatus, Tone> = {
  draft: "warning",
  scheduled: "info",
  active: "success",
  closed: "neutral",
  cancelled: "danger",
  archived: "danger",
};

export const statusLabel = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

export const PAYMENT_TONE: Record<PaymentDisplayStatus, Tone> = {
  Confirmed: "success",
  Pending: "warning",
  Cancelled: "danger",
};

// ── ways to order (src/lib/storefront/two-ways-mode.ts) ──────────────────────

const WAY_STATES: readonly WayState[] = ["open", "closed", "hidden"];
const wayState = (v: unknown): WayState => (WAY_STATES.includes(v as WayState) ? (v as WayState) : "open");

export function normalizeTwoWaysMode(value: unknown): TwoWaysMode {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { onHand: "open", groupBuy: "open" };
  const raw = value as Record<string, unknown>;
  const mode: TwoWaysMode = { onHand: wayState(raw.onHand), groupBuy: wayState(raw.groupBuy) };
  return mode.onHand === "hidden" && mode.groupBuy === "hidden" ? { onHand: "open", groupBuy: "open" } : mode;
}

export const wayIsVisible = (s: WayState): boolean => s !== "hidden";
export const wayAcceptsOrders = (s: WayState): boolean => s === "open";
export const setWayVisible = (s: WayState, visible: boolean): WayState => (!visible ? "hidden" : s === "hidden" ? "open" : s);
export const setWayAcceptOrders = (s: WayState, accept: boolean): WayState =>
  s === "hidden" ? "hidden" : accept ? "open" : "closed";

// ── storefront copy (src/lib/storefront/gb-content.ts) ───────────────────────

export const GB_CONTENT_LIMITS = { maxSteps: 6, maxTitleLen: 80, maxTextLen: 300 } as const;

const GB_CONTENT_DEFAULTS: GroupBuyContent = {
  howTitle: "How group buys work",
  steps: [
    "Browse what's on hand for instant shipping, or join the live group buy for a lower price.",
    "Pay to lock your slot at the group price while the round is open.",
    "When the round closes, we place one bulk order with the supplier.",
    "Your order ships {eta}, COA posted before shipping.",
  ],
  terms: "Pay now to lock your slot. Ships {eta}. COA posted before shipping.",
};

export function normalizeGroupBuyContent(input: unknown): GroupBuyContent {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const title = typeof raw.howTitle === "string" ? raw.howTitle.trim().slice(0, GB_CONTENT_LIMITS.maxTitleLen) : "";
  const steps = (Array.isArray(raw.steps) ? raw.steps : [])
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim().slice(0, GB_CONTENT_LIMITS.maxTextLen))
    .filter((s) => s.length > 0)
    .slice(0, GB_CONTENT_LIMITS.maxSteps);
  const terms = typeof raw.terms === "string" ? raw.terms.trim().slice(0, GB_CONTENT_LIMITS.maxTextLen) : "";
  return {
    howTitle: title || GB_CONTENT_DEFAULTS.howTitle,
    steps: steps.length > 0 ? steps : [...GB_CONTENT_DEFAULTS.steps],
    terms: terms || GB_CONTENT_DEFAULTS.terms,
  };
}

export const renderGbCopy = (text: string, eta: string): string => text.split("{eta}").join(eta || "after the round closes");

// ── live strip (src/lib/storefront/gb-live-banner.ts) ────────────────────────
// Blank = automatic text from the round. npm run test:gb-live-banner pins parity.

export type GroupBuyLiveBanner = { enabled: boolean; headline: string; message: string; ctaLabel: string };
export type GroupBuyLiveBannerText = { headline: string; message: string; ctaLabel: string };

export const GB_LIVE_BANNER_LIMITS = { headline: 60, message: 140, ctaLabel: 20 } as const;

const oneLine = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

export function normalizeGroupBuyLiveBanner(input: unknown): GroupBuyLiveBanner {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  return {
    enabled: raw.enabled !== false,
    headline: oneLine(raw.headline, GB_LIVE_BANNER_LIMITS.headline),
    message: oneLine(raw.message, GB_LIVE_BANNER_LIMITS.message),
    ctaLabel: oneLine(raw.ctaLabel, GB_LIVE_BANNER_LIMITS.ctaLabel),
  };
}

export function renderGroupBuyLiveBanner(
  config: unknown,
  round: { name: string; description: string; deliveryEta: string },
): GroupBuyLiveBannerText | null {
  const c = normalizeGroupBuyLiveBanner(config);
  if (!c.enabled) return null;
  const fill = (text: string) => renderGbCopy(text, round.deliveryEta).split("{name}").join(round.name);
  return {
    headline: fill(c.headline) || `${round.name} is live`,
    message: fill(c.message) || round.description.trim() || "Lock your slot at the group price.",
    ctaLabel: c.ctaLabel || "Join now",
  };
}

// ── hero countdown (src/lib/storefront/hero-countdown.ts) ────────────────────
// The website hero's "opens in / closes in" timer. Blank heading = automatic
// text. npm run test:hero-countdown pins parity.

export type HeroCountdownConfig = { enabled: boolean; showHeading: boolean; closingHeading: string; openingHeading: string };

export const HERO_COUNTDOWN_LIMITS = { heading: 80 } as const;

export const HERO_COUNTDOWN_AUTO_HEADING = { closing: "{name} closes in", opening: "{name} opens in" } as const;

export function normalizeHeroCountdown(input: unknown): HeroCountdownConfig {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  return {
    enabled: raw.enabled === true,
    showHeading: raw.showHeading !== false,
    closingHeading: oneLine(raw.closingHeading, HERO_COUNTDOWN_LIMITS.heading),
    openingHeading: oneLine(raw.openingHeading, HERO_COUNTDOWN_LIMITS.heading),
  };
}

// ── dates (AdminGroupBuys isoToLocal/localToIso — datetime-local as text) ────

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO → "YYYY-MM-DD HH:MM" in the phone's local time ("" when unset). */
export function isoToLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/;

/** "YYYY-MM-DD[ HH:MM]" (local) → ISO; null when blank; undefined when invalid. */
export function localToIso(v: string): string | null | undefined {
  const s = v.trim();
  if (!s) return null;
  const m = LOCAL_RE.exec(s);
  if (!m) return undefined;
  const [y, mo, d, h = "0", mi = "0"] = m.slice(1);
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  if (Number.isNaN(date.getTime()) || date.getMonth() !== Number(mo) - 1 || Number(h) > 23 || Number(mi) > 59) return undefined;
  return date.toISOString();
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export const moneyOf = (currency: string) => (n: number) => `${currency}${(Number(n) || 0).toLocaleString()}`;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ── dashboard order filters (group-buy-analytics.ts filterOrderRows) ─────────

export const ORDER_STATUSES = ["new", "confirmed", "processing", "ready", "shipped", "delivered", "cancelled"];

export type OrderRowFilters = {
  paymentStatus?: PaymentDisplayStatus | "";
  orderStatus?: string;
  from?: string;
  to?: string;
  customer?: string;
};

function dayBound(value: string, edge: "start" | "end"): number | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return edge === "start" ? d.getTime() : d.getTime() + 24 * 60 * 60 * 1000 - 1;
  }
  return d.getTime();
}

export function filterOrderRows(rows: RoundOrderRow[], f: OrderRowFilters): RoundOrderRow[] {
  const customer = f.customer?.trim().toLowerCase() ?? "";
  const orderStatus = f.orderStatus?.trim().toLowerCase() ?? "";
  const from = f.from?.trim() ? dayBound(f.from.trim(), "start") : null;
  const to = f.to?.trim() ? dayBound(f.to.trim(), "end") : null;
  return rows.filter((r) => {
    if (f.paymentStatus && r.paymentStatus !== f.paymentStatus) return false;
    if (orderStatus && r.orderStatus.toLowerCase() !== orderStatus) return false;
    if (customer && !r.customer.toLowerCase().includes(customer)) return false;
    if (from !== null || to !== null) {
      const t = new Date(r.orderDate).getTime();
      if (Number.isNaN(t)) return false;
      if (from !== null && t < from) return false;
      if (to !== null && t > to) return false;
    }
    return true;
  });
}
