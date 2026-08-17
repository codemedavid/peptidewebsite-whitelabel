/**
 * Pure settlement core for the Super Admin calendar — the "this tenant paid"
 * half of /admin/calendar. Sibling of calendar-core.ts (the month grid and the
 * derived due dates); this module owns everything that happens when the operator
 * ticks one of those due dates off.
 *
 * Marking a due date paid does three separate things, and the split matters:
 *
 *   1. RECORDS THE MONEY — plans a *confirmed* SubscriptionPayment. My Income
 *      (income-analytics.ts) rolls up confirmed rows by `paidAt ?? submittedAt`,
 *      so the amount lands in the month the operator says it landed, not the
 *      month the due date sits in. Paying the 21st on the 5th counts on the 5th.
 *
 *   2. ROLLS THE WINDOW — advances Tenant.subscriptionStartsAt/EndsAt one cycle.
 *      This is the ONLY thing that clears the near-due countdown: near-due.ts
 *      and the store-admin banner read the *window*, never the ledger. Recording
 *      a payment without moving the window would leave the tenant reading
 *      "due soon" forever, which is the bug this module exists to prevent.
 *
 *   3. RE-PRICES THE NEXT TERM (optional) — the "amount to charge" the operator
 *      types is stored as both the term total and its monthly equivalent, so a
 *      yearly tenant contributes a sane monthly figure to MRR rather than
 *      spiking it twelvefold.
 *
 * The window roll is deliberately conservative: it only fires when the day being
 * settled IS the tenant's live window end. Settling a back-dated square records
 * the money and leaves the window alone, so filling in payment history can never
 * rewrite the tenant's current term.
 *
 * UTC throughout, matching calendar-core.ts and billing-cycle.ts — operator days
 * are written as `${yyyy-mm-dd}T00:00:00.000Z`.
 *
 * Client-safe and side-effect free (no DB, no Next runtime), so the drawer can
 * preview the next due date live and the rules stay deterministically testable
 * (npm run test:calendar-paid).
 */

import {
  BILLING_CYCLE_MONTHS,
  addBillingCycle,
  isBillingCycle,
  type BillingCycle,
} from "@/lib/subscription/billing-cycle";
import { parsePaymentAmountCents } from "@/lib/subscription/payments";
import { settlementKey, utcDayIso, type CalendarEvent } from "./calendar-core";

/** Re-exported from calendar-core so the suppression set and this index are
 *  keyed by one function — see the note on settlementKey there. */
export { settlementKey };

/**
 * Stamped on every payment the calendar creates. It is what tells a
 * calendar-marked payment apart from one the tenant filed themselves — only the
 * former may be undone from here, because only the former rolled a window we
 * know how to roll back.
 */
export const CALENDAR_SETTLEMENT_NOTE = "Marked paid on the operator calendar";

/** Default method for a payment the operator recorded on the tenant's behalf. */
const DEFAULT_METHOD = "Other";

/** Cycle used when neither the form nor the tenant names one. */
const FALLBACK_CYCLE: BillingCycle = "monthly";

/** "YYYY-MM-DD", the same shape <input type="date"> emits. */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A SubscriptionPayment row as read from the DB. `status` is untrusted. */
export type SettlementRow = {
  id: string;
  tenantId: string;
  amountCents: number;
  status: string;
  method?: string | null;
  periodStart?: Date | string | null;
  periodEnd?: Date | string | null;
  paidAt?: Date | string | null;
  submittedAt?: Date | string | null;
  reviewNote?: string | null;
};

/** A confirmed payment, projected onto the day it settles. */
export type Settlement = {
  id: string;
  tenantId: string;
  /** UTC day of the due date this payment covers — where the chip renders. */
  day: string;
  /** UTC day the money actually landed — what the income month keys on. */
  paidDay: string;
  amountCents: number;
  method: string;
  /** True when the calendar created it, so undo can roll the window back. */
  fromCalendar: boolean;
  periodStartIso: string | null;
  periodEndIso: string | null;
};

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Parse a "YYYY-MM-DD" day to UTC midnight, rejecting impossible dates
 *  (2026-02-30 would otherwise roll silently into March). */
function parseDay(raw: string | null | undefined): Date | null {
  const day = (raw ?? "").trim();
  if (!DAY_RE.test(day)) return null;
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || utcDayIso(date) !== day) return null;
  return date;
}

/**
 * Index the confirmed half of a payment ledger by the due date each payment
 * covers. Only "confirmed" counts as paid — a pending proof the operator hasn't
 * reviewed must keep reading as due. A row with no usable date is dropped rather
 * than bucketed onto the epoch, and when two payments land on one due date the
 * later one wins (the operator's correction beats the original).
 */
export function buildSettlementIndex(rows: readonly SettlementRow[]): Map<string, Settlement> {
  const index = new Map<string, Settlement>();

  for (const row of rows) {
    if (row.status !== "confirmed") continue;

    const paid = toValidDate(row.paidAt) ?? toValidDate(row.submittedAt);
    const periodEnd = toValidDate(row.periodEnd);
    const settles = periodEnd ?? paid;
    if (!settles) continue;

    const periodStart = toValidDate(row.periodStart);
    const settlement: Settlement = {
      id: row.id,
      tenantId: row.tenantId,
      day: utcDayIso(settles),
      paidDay: utcDayIso(paid ?? settles),
      amountCents: row.amountCents,
      method: (row.method ?? "").trim() || DEFAULT_METHOD,
      fromCalendar: (row.reviewNote ?? "").trim() === CALENDAR_SETTLEMENT_NOTE,
      periodStartIso: periodStart ? periodStart.toISOString() : null,
      periodEndIso: periodEnd ? periodEnd.toISOString() : null,
    };

    const key = settlementKey(settlement.tenantId, settlement.day);
    const existing = index.get(key);
    if (existing && existing.paidDay > settlement.paidDay) continue;
    index.set(key, settlement);
  }

  return index;
}

/**
 * Paid chips for the visible grid. Day keys are ISO, so a lexicographic compare
 * against the range's first and last day is the same as a date compare — and it
 * filters on the day the payment SETTLES, which can differ from the day it was
 * queried by (a payment filed in July can settle an August due date).
 */
export function settlementEvents(
  settlements: Iterable<Settlement>,
  tenantNameById: Readonly<Record<string, string>>,
  range: { start: Date; end: Date },
): CalendarEvent[] {
  const firstDay = utcDayIso(range.start);
  const lastDay = utcDayIso(range.end);
  const events: CalendarEvent[] = [];

  for (const settlement of settlements) {
    if (settlement.day < firstDay || settlement.day > lastDay) continue;
    events.push({
      id: `paid:${settlement.id}`,
      kind: "payment",
      day: settlement.day,
      at: `${settlement.day}T00:00:00.000Z`,
      title: tenantNameById[settlement.tenantId] ?? "Tenant",
      subtitle: `Paid · ${settlement.method}`,
      tenantId: settlement.tenantId,
      urgency: "scheduled",
      projected: false,
      paid: true,
      amountCents: settlement.amountCents,
      settlementId: settlement.id,
      paidDay: settlement.paidDay,
    });
  }

  return events;
}

/** Narrow a form/DB cycle, falling back to monthly rather than throwing. */
function toCycle(value: unknown): BillingCycle {
  return isBillingCycle(value) ? value : FALLBACK_CYCLE;
}

/**
 * The due date one term after `dueDay` on the given cycle — what the drawer
 * pre-fills as "next due". End-of-month clamping comes from addBillingCycle, so
 * Jan 31 + monthly lands on Feb 28, not Mar 3.
 */
export function defaultNextDueDay(cycle: string | null | undefined, dueDay: string): string {
  const start = parseDay(dueDay);
  if (!start) return dueDay;
  return utcDayIso(addBillingCycle(start, toCycle(cycle)));
}

export type SettlementPlanInput = {
  tenant: {
    id: string;
    status: string;
    subscriptionStartsAt?: Date | string | null;
    subscriptionEndsAt?: Date | string | null;
    subscriptionCycle?: string | null;
  };
  /** The due date being settled, "YYYY-MM-DD". */
  dueDay: string;
  /** Raw peso amount received, as typed (e.g. "₱1,499.50"). */
  amount: string;
  /** When the money landed; defaults to the due date. */
  paidDay?: string | null;
  /** How they paid; free text, defaults to "Other". */
  method?: string | null;
  /** Cycle going forward. Wins over the tenant's stored cycle when given. */
  cycle?: string | null;
  /** Raw peso amount to charge for the NEXT term. Omit to leave pricing alone. */
  billAmount?: string | null;
  /** Overrides the cycle-derived next due date. */
  nextDueDay?: string | null;
  now: Date;
};

export type SettlementPlan = {
  payment: {
    tenantId: string;
    amountCents: number;
    cycle: BillingCycle;
    periodStart: Date | null;
    periodEnd: Date;
    paidAt: Date;
    method: string;
    status: "confirmed";
    reviewNote: string;
  };
  /** Null when the settled day isn't the tenant's live window end. */
  nextWindow: { startsAt: Date; endsAt: Date } | null;
  /** Null when the operator didn't re-price the next term. */
  nextBilling: { termCents: number; monthlyCents: number } | null;
};

export type SettlementResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Validate a mark-paid at the boundary and work out its three consequences.
 * Returns a friendly message rather than throwing, matching the
 * `{ ok } | { error }` contract the platform actions use.
 */
export function planSettlement(input: SettlementPlanInput): SettlementResult<SettlementPlan> {
  const { tenant } = input;

  if (tenant.status === "trial") {
    return { ok: false, error: "This tenant is still on trial — convert them to a paid plan first." };
  }

  const periodEnd = parseDay(input.dueDay);
  if (!periodEnd) return { ok: false, error: "Pick a valid due date to settle." };

  const amountCents = parsePaymentAmountCents(input.amount ?? "");
  if (amountCents == null) return { ok: false, error: "Enter a valid amount received." };

  const paidAt = input.paidDay ? parseDay(input.paidDay) : periodEnd;
  if (!paidAt) return { ok: false, error: "That payment date isn't valid." };

  // An explicit cycle from the form wins; otherwise inherit the tenant's, and
  // fall back to monthly for a tenant that never had one.
  if (input.cycle != null && input.cycle !== "" && !isBillingCycle(input.cycle)) {
    return { ok: false, error: "Choose a valid billing cycle." };
  }
  const cycle = toCycle(input.cycle ?? tenant.subscriptionCycle);

  let nextBilling: SettlementPlan["nextBilling"] = null;
  const rawBill = (input.billAmount ?? "").trim();
  if (rawBill !== "") {
    const termCents = parsePaymentAmountCents(rawBill);
    if (termCents == null) {
      return { ok: false, error: "Enter a valid amount to charge, or leave it blank." };
    }
    // Normalize to a monthly rate so MRR reads per-month for every cycle.
    nextBilling = { termCents, monthlyCents: Math.round(termCents / BILLING_CYCLE_MONTHS[cycle]) };
  }

  // The window only moves when the day being settled IS the live window end.
  // Settling a historical square is bookkeeping, not a renewal.
  const windowEnd = toValidDate(tenant.subscriptionEndsAt);
  const windowStart = toValidDate(tenant.subscriptionStartsAt);
  const isLiveDueDate = windowEnd != null && utcDayIso(windowEnd) === input.dueDay;

  let nextWindow: SettlementPlan["nextWindow"] = null;
  if (isLiveDueDate) {
    const nextEnd = input.nextDueDay ? parseDay(input.nextDueDay) : addBillingCycle(periodEnd, cycle);
    if (!nextEnd) return { ok: false, error: "That next due date isn't valid." };
    if (nextEnd.getTime() <= periodEnd.getTime()) {
      return { ok: false, error: "The next due date has to come after the one being paid." };
    }
    nextWindow = { startsAt: periodEnd, endsAt: nextEnd };
  }

  return {
    ok: true,
    value: {
      payment: {
        tenantId: tenant.id,
        amountCents,
        cycle,
        periodStart: isLiveDueDate ? windowStart : null,
        periodEnd,
        paidAt,
        method: (input.method ?? "").trim() || DEFAULT_METHOD,
        status: "confirmed",
        reviewNote: CALENDAR_SETTLEMENT_NOTE,
      },
      nextWindow,
      nextBilling,
    },
  };
}

/** What the month's header figures are computed over. */
export type MonthMoney = {
  /** Everything billable landing in this month, settled or not. */
  expectedCents: number;
  /** What actually came in during this month. */
  collectedCents: number;
};

/**
 * The two numbers at the top of the calendar, for one month.
 *
 * EXPECTED counts every event on a day of this month that carries an amount —
 * tenant subscription dues AND the operator's own billings for clients who
 * aren't platform tenants. An entry with no amount is a plain reminder and
 * moves nothing. The 6x7 grid's leading/trailing cells belong to the
 * neighbouring months, so the day-prefix test excludes them.
 *
 * COLLECTED is measured on when money LANDED, not on the term it settles: a
 * subscription counts on its `paidDay` (so a payment taken in August against
 * September's term still counts in August), and an operator billing counts once
 * it's ticked off. Settled subscriptions come in through `settlements` rather
 * than through their paid chips, because the chip sits on the day the term ends
 * while the money may have arrived in a different month entirely.
 */
export function monthMoney(
  events: readonly CalendarEvent[],
  settlements: readonly { paidDay: string; amountCents: number }[],
  monthPrefix: string,
): MonthMoney {
  let expectedCents = 0;
  let collectedCents = 0;

  for (const event of events) {
    if (!event.day.startsWith(monthPrefix)) continue;
    const amount = event.amountCents ?? 0;
    if (amount === 0) continue;

    expectedCents += amount;
    // Only operator entries settle here — a subscription's money is counted
    // from the ledger below, on the day it actually arrived.
    if (event.kind === "manual" && event.done) collectedCents += amount;
  }

  for (const settlement of settlements) {
    if (settlement.paidDay.startsWith(monthPrefix)) collectedCents += settlement.amountCents;
  }

  return { expectedCents, collectedCents };
}

export type SettlementReversalInput = {
  settlement: {
    periodStartIso: string | null;
    periodEndIso: string | null;
    fromCalendar: boolean;
  };
  tenant: {
    subscriptionStartsAt?: Date | string | null;
    subscriptionEndsAt?: Date | string | null;
  };
};

export type SettlementReversal = {
  /** The window to restore, or null when it can't be restored safely. */
  restore: { startsAt: Date; endsAt: Date } | null;
};

/**
 * Undo a calendar mark-paid. The payment is always removable; the window is only
 * rolled back when the current window still STARTS where this payment's term
 * ended — the fingerprint of the roll this settlement performed. If the operator
 * has since edited the window by hand, we delete the payment and leave their
 * edit standing rather than silently reverting it.
 */
export function planSettlementReversal(
  input: SettlementReversalInput,
): SettlementResult<SettlementReversal> {
  if (!input.settlement.fromCalendar) {
    return {
      ok: false,
      error: "The tenant filed this payment — review it on their Billing tab instead.",
    };
  }

  const periodStart = toValidDate(input.settlement.periodStartIso);
  const periodEnd = toValidDate(input.settlement.periodEndIso);
  const currentStart = toValidDate(input.tenant.subscriptionStartsAt);

  const rolledByUs =
    periodStart != null &&
    periodEnd != null &&
    currentStart != null &&
    currentStart.getTime() === periodEnd.getTime();

  return {
    ok: true,
    value: { restore: rolledByUs ? { startsAt: periodStart, endsAt: periodEnd } : null },
  };
}
