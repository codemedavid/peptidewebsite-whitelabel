/**
 * Member tracker — how many group buys each member joined in a period.
 *
 * COPIED from src/lib/storefront/gb-participation.ts (+ the identity helpers it
 * needs from gb-member-orders.ts groupIndexes, admin-fee-once.ts emailKey /
 * phoneKey, group-buy.ts orderCountsAsDemand and customer-analytics.ts csvCell).
 * The app can't import website code; `npm run test:gb-participation` pins the
 * website's copy — keep this one in step when that file changes.
 *
 * A MEMBER is one account, email OR phone (links chain). A member JOINED a round
 * when they have a counted (not cancelled) order in it. Months are Philippine
 * time (UTC+8, no DST).
 */

// ── shapes ───────────────────────────────────────────────────────────────────

export type ParticipationOrder = {
  roundId: string;
  roundName: string;
  /** ISO-8601 placement time. */
  date: string;
  status: string;
  /** The checkout's total in the store's major unit. */
  total: number;
  customerAccountId?: string | null;
  customer?: { name?: string; email?: string; phone?: string; whatsapp?: string; whatsappName?: string };
};

export type ParticipationResult = { ok: true; enabled: false } | { ok: true; enabled: true; orders: ParticipationOrder[] };

export type ParticipationPeriod = { kind: "all" } | { kind: "month"; month: string } | { kind: "last"; months: number };

/** Half-open [from, to) window; null = unbounded on that side. */
export type ParticipationWindow = { from: Date | null; to: Date | null };

export type ParticipantRow = {
  key: string;
  name: string;
  email: string;
  /** Phone, else email, else "—". */
  contact: string;
  whatsapp: string;
  whatsappName: string;
  /** Distinct rounds joined inside the window. */
  groupBuys: number;
  /** Checkouts inside the window (a top-up is a second checkout). */
  checkouts: number;
  spent: number;
  /** Round names joined in the window, oldest first. */
  rounds: string[];
  /** Newest counted order inside the window (ISO). */
  lastJoinedAt: string;
};

// ── identity (admin-fee-once.ts, gb-member-orders.ts, group-buy.ts) ──────────

const MIN_PHONE_DIGITS = 7;
const PHONE_MATCH_DIGITS = 10;
const DEMAND_EXCLUDED_STATUSES = new Set(["cancelled", "canceled", "refunded"]);

const orderCountsAsDemand = (status: string): boolean => !DEMAND_EXCLUDED_STATUSES.has(status.toLowerCase());

function emailKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return v.includes("@") ? v : null;
}

function phoneKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= MIN_PHONE_DIGITS ? digits.slice(-PHONE_MATCH_DIGITS) : null;
}

type IdentitySource = Pick<ParticipationOrder, "customerAccountId" | "customer">;

function identityKeys(o: IdentitySource, index: number): string[] {
  const c = o.customer ?? {};
  const email = emailKey(c.email);
  const phone = phoneKey(c.phone);
  const keys = [
    o.customerAccountId ? `a:${o.customerAccountId}` : null,
    email ? `e:${email}` : null,
    phone ? `p:${phone}` : null,
  ].filter((k): k is string => k !== null);
  if (keys.length > 0) return keys;
  // No contact at all: only the exact same name links it, never a stranger's.
  const name = c.name?.trim().toLowerCase();
  return [name ? `n:${name}` : `o:${index}`];
}

/** Union-find over orders: two orders that share any identity key merge. */
function groupIndexes(orders: readonly IdentitySource[]): number[][] {
  const parent = orders.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    return root;
  };
  const owner = new Map<string, number>();
  orders.forEach((o, i) => {
    for (const key of identityKeys(o, i)) {
      const seen = owner.get(key);
      if (seen === undefined) owner.set(key, i);
      else parent[find(i)] = find(seen);
    }
  });
  const groups = new Map<number, number[]>();
  orders.forEach((_, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  });
  return [...groups.values()];
}

// ── periods (gb-participation.ts) ────────────────────────────────────────────

const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

function phMonthStart(year: number, monthIndex: number): Date {
  return new Date(Date.UTC(year, monthIndex, 1) - PH_OFFSET_MS);
}

function phYearMonth(d: Date): { year: number; month: number } {
  const local = new Date(d.getTime() + PH_OFFSET_MS);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() };
}

/** month "2026-12" → all of December; last N months → the N months before this one plus this month so far. */
export function participationWindow(period: ParticipationPeriod, now: Date): ParticipationWindow {
  if (period.kind === "month") {
    const m = MONTH_RE.exec(period.month);
    if (!m) return { from: null, to: null };
    const year = Number(m[1]);
    const month = Number(m[2]) - 1;
    return { from: phMonthStart(year, month), to: phMonthStart(year, month + 1) };
  }
  if (period.kind === "last") {
    const months = Math.max(1, Math.floor(period.months));
    const { year, month } = phYearMonth(now);
    return { from: phMonthStart(year, month - months), to: null };
  }
  return { from: null, to: null };
}

const inWindow = (iso: string, w: ParticipationWindow): boolean => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return (!w.from || t >= w.from.getTime()) && (!w.to || t < w.to.getTime());
};

/** Months the picker offers: this month back to the oldest order, newest first. */
export function monthOptions(orders: readonly Pick<ParticipationOrder, "date">[], now: Date): { value: string; label: string }[] {
  const times = orders.map((o) => Date.parse(o.date)).filter((t) => !Number.isNaN(t));
  const end = phYearMonth(now);
  const start = times.length ? phYearMonth(new Date(Math.min(...times))) : end;
  const out: { value: string; label: string }[] = [];
  for (let y = end.year, m = end.month; y > start.year || (y === start.year && m >= start.month); ) {
    out.push({ value: `${y}-${String(m + 1).padStart(2, "0")}`, label: `${MONTH_NAMES[m]} ${y}` });
    if (--m < 0) {
      m = 11;
      y--;
    }
  }
  return out;
}

// ── rows ─────────────────────────────────────────────────────────────────────

function newest(orders: readonly ParticipationOrder[], read: (o: ParticipationOrder) => string | undefined): string {
  const byNewest = [...orders].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return byNewest.map(read).find((v) => v && v.trim())?.trim() ?? "";
}

function buildRow(all: readonly ParticipationOrder[], w: ParticipationWindow, key: string): ParticipantRow | null {
  const counted = all.filter((o) => orderCountsAsDemand(o.status));
  const inside = counted.filter((o) => inWindow(o.date, w));
  if (inside.length === 0) return null;
  const firstOrderOfRound = new Map<string, ParticipationOrder>();
  for (const o of [...inside].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))) {
    if (!firstOrderOfRound.has(o.roundId)) firstOrderOfRound.set(o.roundId, o);
  }
  const email = newest(counted, (o) => o.customer?.email).toLowerCase();
  const phone = newest(counted, (o) => o.customer?.phone);
  const last = inside.reduce((a, b) => (Date.parse(b.date) > Date.parse(a.date) ? b : a));
  return {
    key,
    name: newest(counted, (o) => o.customer?.name) || email || phone || "Unknown",
    email,
    contact: phone || email || "—",
    whatsapp: newest(counted, (o) => o.customer?.whatsapp),
    whatsappName: newest(counted, (o) => o.customer?.whatsappName),
    groupBuys: firstOrderOfRound.size,
    checkouts: inside.length,
    spent: inside.reduce((s, o) => s + (Number(o.total) || 0), 0),
    rounds: [...firstOrderOfRound.values()].map((o) => o.roundName),
    lastJoinedAt: last.date,
  };
}

/** One row per member who joined at least one round in the window: most group buys, then most spent, then name. */
export function buildParticipation(orders: readonly ParticipationOrder[], window: ParticipationWindow): ParticipantRow[] {
  return groupIndexes(orders)
    .map((idx) => buildRow(idx.map((i) => orders[i]), window, `m${idx[0]}`))
    .filter((r): r is ParticipantRow => r !== null)
    .sort((a, b) => b.groupBuys - a.groupBuys || b.spent - a.spent || a.name.localeCompare(b.name));
}

export function participationSummary(rows: readonly ParticipantRow[]): { members: number; repeat: number; joins: number } {
  return {
    members: rows.length,
    repeat: rows.filter((r) => r.groupBuys > 1).length,
    joins: rows.reduce((s, r) => s + r.groupBuys, 0),
  };
}

// ── export (GbMemberTracker downloadCsv) ─────────────────────────────────────

/** COPIED from src/lib/storefront/customer-analytics.ts csvCell — formula-injection safe. */
function csvCell(v: string | number): string {
  const raw = String(v);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const trackerDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });

export function participationCsv(rows: readonly ParticipantRow[]): string {
  const header = ["Member", "Email", "Contact", "WhatsApp", "WhatsApp name", "Group buys joined", "Checkouts", "Spent", "Last joined", "Group buys"];
  return [
    header,
    ...rows.map((r) => [
      r.name,
      r.email,
      r.contact,
      r.whatsapp,
      r.whatsappName,
      r.groupBuys,
      r.checkouts,
      r.spent,
      trackerDate(r.lastJoinedAt),
      r.rounds.join(" | "),
    ]),
  ]
    .map((cells) => cells.map((c) => csvCell(c)).join(","))
    .join("\n");
}

export const participationCsvName = (periodLabel: string): string =>
  `member-tracker-${periodLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
