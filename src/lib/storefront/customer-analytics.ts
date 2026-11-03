/**
 * Store-admin Customers analytics — every number on the Customers page (KPIs,
 * revenue trend, segments, Top spenders, concentration, needs-attention, the
 * filtered table and its CSV) is decided here, so AdminCustomers stays a dumb
 * projection.
 *
 * Input is the account list plus the LEDGER: one entry per account-linked,
 * non-cancelled order (listStoreCustomersAction). Money is the checkout
 * formula, already applied server-side; cancelled orders never reach here.
 *
 * Dates bucket by the viewer's local calendar day.
 *
 * Pure: no DB, no React. Covered by scripts/test-customer-analytics.ts.
 */

export type CustomerPeriod = "7d" | "30d" | "90d" | "all";
export type CustomerSegmentKey = "vip" | "repeat" | "one" | "none";
export type LeaderMetric = "spend" | "orders";
export type CustomerFilter =
  | "all"
  | "top"
  | "orders"
  | "recent"
  | "lapsed"
  | "none"
  | "unlinked"
  | "email-only"
  | "disabled";

/** Total spent at which a customer counts as VIP (store currency units). */
export const VIP_SPEND = 25_000;
/** A buyer with no order in this many days is "quiet". */
export const LAPSED_DAYS = 45;
/** "Recently active" = an order within this many days. */
export const RECENT_DAYS = 30;
const NEW_THIS_WEEK_DAYS = 7;
const LEADER_LIMIT = 8;
const TOP_SHARE_COUNT = 3;
const ALL_TIME_MONTHS = 6;
const LAPSED_NAMES = 2;
const DAY = 24 * 60 * 60 * 1000;

export type AccountInput = {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: "active" | "disabled";
  joinedAt: string;
  /** Group-buy email entry: no password, never signed in. */
  emailOnly?: boolean;
  /** Guest orders under this email, not yet linked to the account. */
  unlinkedOrders?: number;
};

export type LedgerEntry = { accountId: string; at: string; total: number };

export type AccountStats = {
  orders: number;
  spent: number;
  avg: number;
  lastAt: string | null;
  segment: CustomerSegmentKey;
  /** Has bought, but not in LAPSED_DAYS. */
  lapsed: boolean;
  /** Ordered within RECENT_DAYS. */
  recent: boolean;
};

// ── Per-account stats ───────────────────────────────────────────────────────

function segmentOf(orders: number, spent: number): CustomerSegmentKey {
  if (orders === 0) return "none";
  if (spent >= VIP_SPEND) return "vip";
  return orders >= 2 ? "repeat" : "one";
}

export function buildAccountStats(
  accounts: AccountInput[],
  ledger: LedgerEntry[],
  now: Date,
): Map<string, AccountStats> {
  const acc = new Map<string, { orders: number; spent: number; last: number }>();
  for (const e of ledger) {
    const t = new Date(e.at).getTime();
    if (Number.isNaN(t)) continue;
    const prev = acc.get(e.accountId);
    acc.set(e.accountId, {
      orders: (prev?.orders ?? 0) + 1,
      spent: (prev?.spent ?? 0) + e.total,
      last: Math.max(prev?.last ?? -Infinity, t),
    });
  }
  const out = new Map<string, AccountStats>();
  for (const a of accounts) {
    const s = acc.get(a.id);
    const orders = s?.orders ?? 0;
    const spent = s?.spent ?? 0;
    const sinceLast = s ? now.getTime() - s.last : Infinity;
    out.set(a.id, {
      orders,
      spent,
      avg: orders > 0 ? spent / orders : 0,
      lastAt: s ? new Date(s.last).toISOString() : null,
      segment: segmentOf(orders, spent),
      lapsed: orders > 0 && sinceLast > LAPSED_DAYS * DAY,
      recent: orders > 0 && sinceLast <= RECENT_DAYS * DAY,
    });
  }
  return out;
}

// ── Periods ─────────────────────────────────────────────────────────────────

export const PERIODS: ReadonlyArray<{ key: CustomerPeriod; label: string; days: number | null }> = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "all", label: "All time", days: null },
];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Inclusive window start for a period, or null for all time. */
function windowStart(period: CustomerPeriod, now: Date): number | null {
  const days = PERIODS.find((p) => p.key === period)?.days ?? null;
  return days === null ? null : startOfDay(now).getTime() - (days - 1) * DAY;
}

// ── KPIs ────────────────────────────────────────────────────────────────────

export type KpiKind = "count" | "money" | "percent";
export type CustomerKpi = { id: string; label: string; value: number; kind: KpiKind; sub: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

export function buildCustomerKpis(input: {
  accounts: AccountInput[];
  ledger: LedgerEntry[];
  stats: Map<string, AccountStats>;
  period: CustomerPeriod;
  now: Date;
}): CustomerKpi[] {
  const { accounts, ledger, stats, period, now } = input;
  const from = windowStart(period, now);
  const inWindow = (iso: string) => from === null || new Date(iso).getTime() >= from;
  const orders = ledger.filter((e) => inWindow(e.at));
  const revenue = orders.reduce((s, e) => s + e.total, 0);
  const buyers = new Set(orders.map((e) => e.accountId));
  const repeat = [...buyers].filter((id) => (stats.get(id)?.orders ?? 0) >= 2).length;
  const aov: CustomerKpi = {
    id: "aov",
    label: "Avg order value",
    value: orders.length > 0 ? revenue / orders.length : 0,
    kind: "money",
    sub: "per order",
  };
  const repeatKpi: CustomerKpi = {
    id: "repeat",
    label: "Repeat buyers",
    value: pct(repeat, buyers.size),
    kind: "percent",
    sub: `${repeat} of ${plural(buyers.size, "buyer")}`,
  };

  if (from === null) {
    const weekAgo = now.getTime() - NEW_THIS_WEEK_DAYS * DAY;
    const joinedThisWeek = accounts.filter((a) => new Date(a.joinedAt).getTime() >= weekAgo).length;
    const emailOnly = accounts.filter((a) => a.emailOnly).length;
    return [
      {
        id: "total",
        label: "Total customers",
        value: accounts.length,
        kind: "count",
        sub: `${joinedThisWeek} joined this week${emailOnly > 0 ? ` · ${emailOnly} email-only` : ""}`,
      },
      {
        id: "with-orders",
        label: "With orders",
        value: buyers.size,
        kind: "count",
        sub: `${Math.round(pct(buyers.size, accounts.length) * 100)}% of accounts`,
      },
      { id: "spent", label: "Total spent", value: revenue, kind: "money", sub: plural(orders.length, "order") },
      aov,
      repeatKpi,
    ];
  }
  const days = PERIODS.find((p) => p.key === period)?.days ?? 0;
  const joined = accounts.filter((a) => new Date(a.joinedAt).getTime() >= from).length;
  return [
    { id: "new", label: "New customers", value: joined, kind: "count", sub: `signed up in ${days} days` },
    { id: "active", label: "Active buyers", value: buyers.size, kind: "count", sub: "placed at least 1 order" },
    { id: "revenue", label: "Revenue", value: revenue, kind: "money", sub: plural(orders.length, "order") },
    aov,
    repeatKpi,
  ];
}

// ── Revenue trend ───────────────────────────────────────────────────────────

export type TrendBar = { key: string; label: string; total: number };
export type RevenueTrend = { caption: string; bars: TrendBar[] };

const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

function dayBuckets(now: Date, count: number, size: number): Array<{ start: number; end: number; label: string }> {
  const today = startOfDay(now).getTime();
  const first = today - (count * size - 1) * DAY;
  return Array.from({ length: count }, (_, i) => {
    const start = first + i * size * DAY;
    const end = start + size * DAY;
    const a = new Date(start);
    const b = new Date(end - DAY);
    const label =
      size === 1
        ? a.toLocaleDateString("en-US", { weekday: "short" })
        : a.getMonth() === b.getMonth()
          ? `${fmtDay(a)}–${b.getDate()}`
          : `${fmtDay(a)}–${fmtDay(b)}`;
    return { start, end, label };
  });
}

function monthBuckets(now: Date, count: number): Array<{ start: number; end: number; label: string }> {
  return Array.from({ length: count }, (_, i) => {
    const m = new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 1);
    const next = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    return { start: m.getTime(), end: next.getTime(), label: m.toLocaleDateString("en-US", { month: "short" }) };
  });
}

export function buildRevenueTrend(ledger: LedgerEntry[], period: CustomerPeriod, now: Date): RevenueTrend {
  const plan =
    period === "7d"
      ? { caption: "Last 7 days · by day", buckets: dayBuckets(now, 7, 1) }
      : period === "30d"
        ? { caption: "Last 30 days · 6-day blocks", buckets: dayBuckets(now, 5, 6) }
        : period === "90d"
          ? { caption: "Last 3 months · by month", buckets: monthBuckets(now, 3) }
          : { caption: `Last ${ALL_TIME_MONTHS} months · by month`, buckets: monthBuckets(now, ALL_TIME_MONTHS) };
  const bars = plan.buckets.map((b) => ({
    key: String(b.start),
    label: b.label,
    total: ledger.reduce((s, e) => {
      const t = new Date(e.at).getTime();
      return t >= b.start && t < b.end ? s + e.total : s;
    }, 0),
  }));
  return { caption: plan.caption, bars };
}

// ── Segments ────────────────────────────────────────────────────────────────

export type SegmentRow = { key: CustomerSegmentKey; label: string; rule: string; count: number; revenue: number; pct: number };

export const SEGMENT_LABELS: Record<CustomerSegmentKey, string> = {
  vip: "VIP",
  repeat: "Repeat",
  one: "One-time",
  none: "No orders yet",
};

export function buildSegments(
  accounts: AccountInput[],
  stats: Map<string, AccountStats>,
  vipRule: string,
): SegmentRow[] {
  const rules: Record<CustomerSegmentKey, string> = {
    vip: vipRule,
    repeat: "2+ orders",
    one: "1 order so far",
    none: "Account created, nothing bought",
  };
  return (Object.keys(SEGMENT_LABELS) as CustomerSegmentKey[]).map((key) => {
    const members = accounts.filter((a) => stats.get(a.id)?.segment === key);
    return {
      key,
      label: SEGMENT_LABELS[key],
      rule: rules[key],
      count: members.length,
      revenue: members.reduce((s, a) => s + (stats.get(a.id)?.spent ?? 0), 0),
      pct: accounts.length > 0 ? (members.length / accounts.length) * 100 : 0,
    };
  });
}

// ── Leaderboard + concentration ─────────────────────────────────────────────

export type LeaderRow = {
  id: string;
  name: string;
  orders: number;
  spent: number;
  avg: number;
  lastAt: string | null;
  /** Bar length relative to #1, 0–100. */
  pct: number;
};

export function buildLeaders(
  accounts: AccountInput[],
  stats: Map<string, AccountStats>,
  by: LeaderMetric,
  limit = LEADER_LIMIT,
): LeaderRow[] {
  const rows = accounts
    .map((a) => ({ a, s: stats.get(a.id) }))
    .filter((r): r is { a: AccountInput; s: AccountStats } => !!r.s && r.s.orders > 0)
    .sort((x, y) =>
      by === "spend"
        ? y.s.spent - x.s.spent || y.s.orders - x.s.orders
        : y.s.orders - x.s.orders || y.s.spent - x.s.spent,
    )
    .slice(0, limit);
  const top = rows[0] ? (by === "spend" ? rows[0].s.spent : rows[0].s.orders) : 0;
  return rows.map(({ a, s }) => ({
    id: a.id,
    name: a.name,
    orders: s.orders,
    spent: s.spent,
    avg: s.avg,
    lastAt: s.lastAt,
    pct: top > 0 ? Math.round(((by === "spend" ? s.spent : s.orders) / top) * 100) : 0,
  }));
}

/** Share of all account revenue from the top N spenders (0–1), or null with no revenue. */
export function topSpenderShare(stats: Map<string, AccountStats>, n = TOP_SHARE_COUNT): number | null {
  const spends = [...stats.values()].map((s) => s.spent).filter((v) => v > 0).sort((a, b) => b - a);
  const total = spends.reduce((s, v) => s + v, 0);
  if (total <= 0) return null;
  return spends.slice(0, n).reduce((s, v) => s + v, 0) / total;
}

// ── Needs attention ─────────────────────────────────────────────────────────

export type CustomerAttention = {
  noOrders: { count: number; joinedThisWeek: number };
  /** Accounts with earlier guest orders under their email, waiting to be linked. */
  toLink: { accounts: number; orders: number };
  lapsed: { count: number; names: string[]; lastAt: string | null };
};

export function buildAttention(
  accounts: AccountInput[],
  stats: Map<string, AccountStats>,
  now: Date,
): CustomerAttention {
  const weekAgo = now.getTime() - NEW_THIS_WEEK_DAYS * DAY;
  const none = accounts.filter((a) => stats.get(a.id)?.segment === "none");
  const lapsed = accounts
    .filter((a) => stats.get(a.id)?.lapsed)
    .sort((x, y) => (stats.get(y.id)?.spent ?? 0) - (stats.get(x.id)?.spent ?? 0));
  const lastAt = lapsed
    .map((a) => stats.get(a.id)?.lastAt ?? "")
    .filter(Boolean)
    .sort()
    .pop();
  const toLink = accounts.filter((a) => (a.unlinkedOrders ?? 0) > 0);
  return {
    noOrders: { count: none.length, joinedThisWeek: none.filter((a) => new Date(a.joinedAt).getTime() >= weekAgo).length },
    toLink: { accounts: toLink.length, orders: toLink.reduce((s, a) => s + (a.unlinkedOrders ?? 0), 0) },
    lapsed: { count: lapsed.length, names: lapsed.slice(0, LAPSED_NAMES).map((a) => a.name), lastAt: lastAt ?? null },
  };
}

// ── Table filters ───────────────────────────────────────────────────────────

type Ranked = { a: AccountInput; s: AccountStats | undefined };
type FilterDef = {
  label: string;
  /** Needs the ledger (spend / order dates) to mean anything. */
  needsLedger: boolean;
  match: (a: AccountInput, s: AccountStats | undefined) => boolean;
  compare: (x: Ranked, y: Ranked) => number;
};

const byJoined = (x: Ranked, y: Ranked) => y.a.joinedAt.localeCompare(x.a.joinedAt);
const spentOf = (r: Ranked) => r.s?.spent ?? 0;
const ordersOf = (r: Ranked) => r.s?.orders ?? 0;
const lastOf = (r: Ranked) => r.s?.lastAt ?? "";

export const CUSTOMER_FILTERS: Record<CustomerFilter, FilterDef> = {
  all: { label: "All", needsLedger: false, match: () => true, compare: byJoined },
  top: {
    label: "Top spenders",
    needsLedger: true,
    match: (_a, s) => (s?.spent ?? 0) > 0,
    compare: (x, y) => spentOf(y) - spentOf(x) || ordersOf(y) - ordersOf(x),
  },
  orders: {
    label: "Most orders",
    needsLedger: true,
    match: (_a, s) => (s?.orders ?? 0) > 0,
    compare: (x, y) => ordersOf(y) - ordersOf(x) || spentOf(y) - spentOf(x),
  },
  recent: {
    label: "Recently active",
    needsLedger: true,
    match: (_a, s) => !!s?.recent,
    compare: (x, y) => lastOf(y).localeCompare(lastOf(x)),
  },
  lapsed: {
    label: `Quiet ${LAPSED_DAYS}+ days`,
    needsLedger: true,
    match: (_a, s) => !!s?.lapsed,
    compare: (x, y) => spentOf(y) - spentOf(x),
  },
  none: { label: "No orders yet", needsLedger: true, match: (_a, s) => (s?.orders ?? 0) === 0, compare: byJoined },
  unlinked: {
    label: "Orders to link",
    needsLedger: true,
    match: (a) => (a.unlinkedOrders ?? 0) > 0,
    compare: (x, y) => (y.a.unlinkedOrders ?? 0) - (x.a.unlinkedOrders ?? 0),
  },
  "email-only": { label: "Email only", needsLedger: false, match: (a) => !!a.emailOnly, compare: byJoined },
  disabled: { label: "Disabled", needsLedger: false, match: (a) => a.status === "disabled", compare: byJoined },
};

export const FILTER_ORDER: readonly CustomerFilter[] = [
  "all",
  "top",
  "orders",
  "recent",
  "lapsed",
  "none",
  "unlinked",
  "email-only",
  "disabled",
];

export function filterCustomers<T extends AccountInput>(
  accounts: T[],
  stats: Map<string, AccountStats>,
  filter: CustomerFilter,
  query: string,
): T[] {
  const def = CUSTOMER_FILTERS[filter];
  const q = query.trim().toLowerCase();
  // "0917…" (local) must find "+63 917…" (stored): try the digits without a trunk 0 too.
  const digits = q.replace(/\D/g, "");
  const digitForms = digits.length > 0 ? [digits, digits.replace(/^0/, "")].filter((d) => d.length > 0) : [];
  const phoneMatches = (phone: string) => {
    const p = phone.replace(/\D/g, "");
    return digitForms.some((d) => p.includes(d));
  };
  return accounts
    .filter((a) => def.match(a, stats.get(a.id)))
    .filter(
      (a) =>
        !q ||
        a.name.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        phoneMatches(a.phone),
    )
    .map((a) => ({ a, s: stats.get(a.id) }))
    .sort((x, y) => def.compare(x, y) || byJoined(x, y))
    .map((r) => r.a as T);
}

export function countByFilter(accounts: AccountInput[], stats: Map<string, AccountStats>): Record<CustomerFilter, number> {
  return Object.fromEntries(
    FILTER_ORDER.map((f) => [f, accounts.filter((a) => CUSTOMER_FILTERS[f].match(a, stats.get(a.id))).length]),
  ) as Record<CustomerFilter, number>;
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/** A cell safe for CSV and for spreadsheet formula injection (=, +, -, @). */
export function csvCell(v: string | number): string {
  const raw = String(v);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function customersCsv(accounts: AccountInput[], stats: Map<string, AccountStats> | null): string {
  const head = ["Name", "Email", "Phone", "Status", "Account", "Joined"];
  const money = stats ? ["Segment", "Orders", "Total spent", "Avg order", "Last order"] : [];
  const lines = accounts.map((a) => {
    const s = stats?.get(a.id);
    const base: Array<string | number> = [
      a.name,
      a.email,
      a.phone,
      a.status,
      a.emailOnly ? "email only" : "signed up",
      a.joinedAt.slice(0, 10),
    ];
    const extra: Array<string | number> = stats
      ? [
          SEGMENT_LABELS[s?.segment ?? "none"],
          s?.orders ?? 0,
          (s?.spent ?? 0).toFixed(2),
          (s?.avg ?? 0).toFixed(2),
          s?.lastAt?.slice(0, 10) ?? "",
        ]
      : [];
    return [...base, ...extra].map(csvCell).join(",");
  });
  return [[...head, ...money].map(csvCell).join(","), ...lines].join("\n");
}
