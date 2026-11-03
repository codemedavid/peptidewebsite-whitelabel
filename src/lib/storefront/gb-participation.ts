// Member tracker — how many group buys each member joined in a period
// (mnm-pepsabuy, 2026-11-03: "ilang GB na nasalihan nila … for the whole
// December, for the last 3 months").
//
// A MEMBER is the round report's definition (gb-member-orders.groupIndexes):
// one account, email OR phone links two orders, and links chain. Identity is
// resolved over the WHOLE history before the window is applied, so a member
// who used their phone in October and only their email in December is still
// one person in December's count.
//
// A member JOINED a round when they have a counted (not cancelled) order in it;
// the round lands in the window of the order date. Several checkouts in one
// round count as one group buy joined.
//
// Calendar months are Philippine time (UTC+8, no DST): every store on the
// platform sells in PH, and "December" means the owner's December.
//
// Pure; pinned by `npm run test:gb-participation`.

import { orderCountsAsDemand } from "./group-buy";
import { groupIndexes, type MemberIdentitySource } from "./gb-member-orders";

const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** One group-buy order as the tracker reads it — already attributed to a round. */
export type ParticipationOrder = MemberIdentitySource & {
  roundId: string;
  roundName: string;
  /** ISO-8601 placement time. */
  date: string;
  status: string;
  /** The checkout's total (checkoutTotals) in the store's major unit. */
  total: number;
};

export type ParticipationPeriod =
  | { kind: "all" }
  | { kind: "month"; month: string } // "2026-12"
  | { kind: "last"; months: number }; // this month so far + the N-1 before it… see participationWindow

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

/** UTC instant of 00:00 Manila on the 1st of (year, monthIndex). Month may overflow. */
function phMonthStart(year: number, monthIndex: number): Date {
  return new Date(Date.UTC(year, monthIndex, 1) - PH_OFFSET_MS);
}

/** Manila calendar (year, monthIndex) of an instant. */
function phYearMonth(d: Date): { year: number; month: number } {
  const local = new Date(d.getTime() + PH_OFFSET_MS);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() };
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * The window a period covers.
 * - month "2026-12" → all of December (Manila time).
 * - last N months   → the N calendar months ending with the PREVIOUS month,
 *                     plus the current month so far ("last 3 months" in mid-
 *                     January = 1 Oct → now). Open-ended, so today's orders count.
 */
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

/** Newest non-blank value of a field across a member's orders. */
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

/** One row per member who joined at least one round in the window, most group
 *  buys first, then most spent, then name. */
export function buildParticipation(orders: readonly ParticipationOrder[], window: ParticipationWindow): ParticipantRow[] {
  return groupIndexes(orders)
    .map((idx) => buildRow(idx.map((i) => orders[i]), window, `m${idx[0]}`))
    .filter((r): r is ParticipantRow => r !== null)
    .sort((a, b) => b.groupBuys - a.groupBuys || b.spent - a.spent || a.name.localeCompare(b.name));
}

/** "N members joined M group buys" headline numbers for the window. */
export function participationSummary(rows: readonly ParticipantRow[]): { members: number; repeat: number; joins: number } {
  return {
    members: rows.length,
    repeat: rows.filter((r) => r.groupBuys > 1).length,
    joins: rows.reduce((s, r) => s + r.groupBuys, 0),
  };
}
