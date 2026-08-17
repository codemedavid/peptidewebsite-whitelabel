/**
 * Pure Super Admin calendar core — the month grid plus the event stream the
 * operator's Calendar page renders. Two sources merge into one list:
 *
 *   DERIVED (never stored)                    STORED (operator-authored)
 *   ├── renewal   — Tenant.subscriptionEndsAt   PlatformCalendarEvent
 *   ├── renewal   — projected forward by cycle  → toManualEvent()
 *   └── trial_end — a trial tenant's expiry
 *
 * Derived events are recomputed per request rather than written to a table, so
 * moving a tenant's due date is reflected immediately with no sync job and no
 * drift between the calendar and the tenant's own countdown banner.
 *
 * ⚠️ DAY BUCKETING IS UTC, deliberately. Operator-set dates are written by
 * parseDay() (src/actions/admin.ts) as `${yyyy-mm-dd}T00:00:00.000Z`, and the
 * cycle math in billing-cycle.ts is UTC too. Bucketing in a local zone (e.g.
 * Asia/Manila, UTC+8) would pull every midnight-UTC due date back into the
 * previous square — the whole calendar would read one day early.
 *
 * Client-safe and side-effect free: callers pass `now` and the visible range,
 * so the grid is deterministic and testable (npm run test:calendar).
 */

import { addBillingCycle, daysInUtcMonth, isBillingCycle } from "@/lib/subscription/billing-cycle";
import { subscriptionUrgency } from "@/lib/subscription/near-due";
import { parsePaymentAmountCents } from "@/lib/subscription/payments";

export { daysInUtcMonth };

const DAY_MS = 86_400_000;

/** A month grid is always 6 rows of 7, so the page height never jumps. */
export const MONTH_GRID_CELLS = 42;

/** Stops a runaway projection if a tenant carries an ancient window. */
const MAX_PROJECTIONS = 240;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Abbreviated month names, January-first — the year strip's jump targets. */
export const MONTH_SHORT_LABELS = MONTH_NAMES.map((name) => name.slice(0, 3));

/** Weekday headers, Sunday-first — matches buildMonthGrid's row alignment. */
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type CalendarEventKind = "renewal" | "trial_end" | "manual" | "payment";

/** Same vocabulary the Income page uses, so badges read consistently. */
export type CalendarUrgency = "overdue" | "due_soon" | "scheduled";

export type CalendarEvent = {
  id: string;
  kind: CalendarEventKind;
  /** UTC day this event sits on, "YYYY-MM-DD" — the grid cell key. */
  day: string;
  /** The full instant, ISO, for tooltips and ordering. */
  at: string;
  title: string;
  /** Secondary line: the tenant's name, or an off-platform client label. */
  subtitle?: string;
  tenantId?: string;
  tenantSlug?: string;
  urgency: CalendarUrgency;
  /** True for a future cycle inferred from the window, not an actual due date. */
  projected: boolean;
  amountCents?: number;
  cycle?: string | null;
  notes?: string;
  /** Operator-chosen category for a manual entry (note | meeting | …). */
  entryKind?: string;
  /** Manual entries only — ticked off by the operator. */
  done?: boolean;
  /** True for a settled subscription term (kind "payment"). */
  paid?: boolean;
  /** The SubscriptionPayment behind a paid event — what undo targets. */
  settlementId?: string;
  /** UTC day the money landed, when it differs from the day settled. */
  paidDay?: string;
};

export type DayCell = {
  day: string;
  dayOfMonth: number;
  /** False for the leading/trailing days borrowed from adjacent months. */
  inMonth: boolean;
  isToday: boolean;
};

export type MonthGrid = {
  year: number;
  /** 0-based, matching Date.getUTCMonth(). */
  month: number;
  label: string;
  cells: DayCell[];
};

export type CalendarTenantInput = {
  id: string;
  name: string;
  slug?: string;
  /** Tenant.status — "trial" tenants are governed by their trial window. */
  status: string;
  subscriptionStartsAt?: Date | string | null;
  subscriptionEndsAt?: Date | string | null;
  subscriptionCycle?: string | null;
  /** Effective monthly fee, centavos — what the day chip shows. */
  monthlyCents?: number;
  trialEndsAt?: Date | string | null;
};

/** A stored PlatformCalendarEvent row, as read from the DB. */
export type ManualEventRow = {
  id: string;
  tenantId: string | null;
  clientLabel: string | null;
  title: string;
  notes: string | null;
  startsAt: Date | string;
  kind: string;
  doneAt: Date | string | null;
  /** What the operator is owed for this entry, centavos. Null = a reminder. */
  amountCents?: number | null;
};

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "YYYY-MM-DD" for the UTC day a moment falls on. */
export function utcDayIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/**
 * Index key pairing a tenant with one of its due days — `tenantId:YYYY-MM-DD`.
 * Lives here (rather than in calendar-settlement.ts, which re-exports it) so the
 * suppression set this module reads and the settlement index that fills it are
 * built by the same function and can never drift apart.
 */
export function settlementKey(tenantId: string, day: string): string {
  return `${tenantId}:${day}`;
}

/** Month navigation that rolls over year boundaries in both directions. */
export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const absolute = year * 12 + month + delta;
  return { year: Math.floor(absolute / 12), month: ((absolute % 12) + 12) % 12 };
}

/** UTC midnight of the Sunday that opens the grid for the given month. */
function gridStart(year: number, month: number): Date {
  const first = new Date(Date.UTC(year, month, 1));
  return new Date(first.getTime() - first.getUTCDay() * DAY_MS);
}

/**
 * The fixed 6x7 grid for a month, Sunday-first. Leading and trailing cells come
 * from the adjacent months and are flagged `inMonth: false` so the UI can dim
 * them. `todayIso` is passed in (not read from the clock) to keep this pure.
 */
export function buildMonthGrid(year: number, month: number, todayIso: string): MonthGrid {
  const start = gridStart(year, month).getTime();
  const cells: DayCell[] = Array.from({ length: MONTH_GRID_CELLS }, (_, index) => {
    const date = new Date(start + index * DAY_MS);
    const day = utcDayIso(date);
    return {
      day,
      dayOfMonth: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month && date.getUTCFullYear() === year,
      isToday: day === todayIso,
    };
  });

  return { year, month, label: `${MONTH_NAMES[month]} ${year}`, cells };
}

/**
 * The instant span the grid covers — the first cell's midnight through the last
 * cell's final millisecond, so an event anywhere on the closing day is inside
 * the range. This is what the data layer queries stored events by.
 */
export function gridRange(year: number, month: number): { start: Date; end: Date } {
  const start = gridStart(year, month);
  const end = new Date(start.getTime() + (MONTH_GRID_CELLS - 1) * DAY_MS + (DAY_MS - 1));
  return { start, end };
}

function inRange(date: Date, start: Date, end: Date): boolean {
  const time = date.getTime();
  return time >= start.getTime() && time <= end.getTime();
}

function renewalEvent(
  tenant: CalendarTenantInput,
  at: Date,
  urgency: CalendarUrgency,
  projected: boolean,
): CalendarEvent {
  const day = utcDayIso(at);
  return {
    id: `renewal:${tenant.id}:${day}${projected ? ":projected" : ""}`,
    kind: "renewal",
    day,
    at: at.toISOString(),
    title: tenant.name,
    subtitle: projected ? "Projected renewal" : "Subscription due",
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    urgency,
    projected,
    amountCents: tenant.monthlyCents,
    cycle: tenant.subscriptionCycle ?? null,
  };
}

/**
 * Every due date a set of tenants puts on the visible grid: the current
 * window's renewal, the trial expiry for tenants still on trial, and the future
 * cycles projected forward from the window so next month isn't blank.
 *
 * Suspended tenants are deliberately included — unlike the Income page, which
 * counts active tenants only. A suspended tenant's unpaid due date is exactly
 * the one the operator needs to chase.
 *
 * `settled` carries the tenant+day keys the operator has already marked paid
 * (settlementKey in calendar-settlement.ts). Those due dates are skipped here
 * because the settlement renders its own paid chip — without the skip a square
 * would read "due" and "paid" at once.
 */
export function deriveTenantEvents(
  tenants: readonly CalendarTenantInput[],
  opts: { now: Date; rangeStart: Date; rangeEnd: Date; settled?: ReadonlySet<string> },
): CalendarEvent[] {
  const { now, rangeStart, rangeEnd, settled } = opts;
  const isSettled = (tenantId: string, day: string) => settled?.has(settlementKey(tenantId, day)) ?? false;
  const events: CalendarEvent[] = [];

  for (const tenant of tenants) {
    // Trial tenants are governed by the trial window, never a renewal — the
    // same split computeSubscriptionState draws.
    if (tenant.status === "trial") {
      const trialEndsAt = toValidDate(tenant.trialEndsAt);
      if (trialEndsAt && inRange(trialEndsAt, rangeStart, rangeEnd)) {
        events.push({
          id: `trial:${tenant.id}`,
          kind: "trial_end",
          day: utcDayIso(trialEndsAt),
          at: trialEndsAt.toISOString(),
          title: tenant.name,
          subtitle: "Trial ends",
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          urgency: trialEndsAt.getTime() <= now.getTime() ? "overdue" : "due_soon",
          projected: false,
        });
      }
      continue;
    }

    const endsAt = toValidDate(tenant.subscriptionEndsAt);
    if (!endsAt) continue;

    if (inRange(endsAt, rangeStart, rangeEnd) && !isSettled(tenant.id, utcDayIso(endsAt))) {
      const { level } = subscriptionUrgency(
        {
          status: tenant.status,
          subscriptionStartsAt: tenant.subscriptionStartsAt,
          subscriptionEndsAt: tenant.subscriptionEndsAt,
        },
        now,
      );
      events.push(renewalEvent(tenant, endsAt, level === "ok" ? "scheduled" : level, false));
    }

    // Walk the cycle forward from the real due date. Anything landing inside
    // the visible grid is shown as a projection; the walk stops at the range.
    const cycle = tenant.subscriptionCycle;
    if (!isBillingCycle(cycle)) continue;

    let cursor = addBillingCycle(endsAt, cycle);
    for (let i = 0; i < MAX_PROJECTIONS && cursor.getTime() <= rangeEnd.getTime(); i++) {
      if (cursor.getTime() >= rangeStart.getTime() && !isSettled(tenant.id, utcDayIso(cursor))) {
        events.push(renewalEvent(tenant, cursor, "scheduled", true));
      }
      cursor = addBillingCycle(cursor, cycle);
    }
  }

  return events;
}

/**
 * Project a stored operator entry onto the calendar. The subtitle resolves to
 * the platform tenant's name when the entry is linked to one, and otherwise to
 * the free-text label used for clients who aren't on the whitelabel at all.
 *
 * An entry carrying an amount is a billing, not just a reminder, so `done`
 * doubles as `paid`: ticking it off is how the operator says the money for an
 * off-platform client actually came in.
 */
export function toManualEvent(
  row: ManualEventRow,
  tenantNameById: Readonly<Record<string, string>>,
): CalendarEvent {
  const startsAt = toValidDate(row.startsAt) ?? new Date(0);
  const linkedName = row.tenantId ? tenantNameById[row.tenantId] : undefined;
  const subtitle = linkedName ?? row.clientLabel ?? undefined;
  const done = row.doneAt != null;

  return {
    id: row.id,
    kind: "manual",
    day: utcDayIso(startsAt),
    at: startsAt.toISOString(),
    title: row.title,
    subtitle: subtitle || undefined,
    tenantId: row.tenantId ?? undefined,
    urgency: "scheduled",
    projected: false,
    notes: row.notes ?? undefined,
    entryKind: row.kind,
    done,
    paid: done,
    amountCents: row.amountCents ?? undefined,
  };
}

/** Categories an operator can file an entry under. */
export const CALENDAR_ENTRY_KINDS = ["note", "meeting", "follow_up", "payment"] as const;

export type CalendarEntryKind = (typeof CALENDAR_ENTRY_KINDS)[number];

export const CALENDAR_ENTRY_KIND_LABELS: Record<CalendarEntryKind, string> = {
  note: "Note",
  meeting: "Meeting",
  follow_up: "Follow-up",
  payment: "Payment",
};

const TITLE_MAX = 120;
const NOTES_MAX = 2000;
const CLIENT_LABEL_MAX = 80;

/** Same shape actions/admin.ts parseDay accepts, for the same reason. */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type CalendarEventInput = {
  tenantId?: string | null;
  clientLabel?: string | null;
  title?: string | null;
  notes?: string | null;
  /** "YYYY-MM-DD" straight from an <input type="date">. */
  day?: string | null;
  kind?: string | null;
  /** Raw peso amount owed, as typed ("1500", "₱2,499.50"). Blank = none. */
  amount?: string | null;
};

export type NormalizedCalendarEvent = {
  tenantId: string | null;
  clientLabel: string | null;
  title: string;
  notes: string | null;
  startsAt: Date;
  kind: CalendarEntryKind;
  /** Centavos owed, or null for a reminder with no money attached. */
  amountCents: number | null;
};

export type CalendarNormalizeResult =
  | { ok: true; value: NormalizedCalendarEvent }
  | { ok: false; error: string };

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Validate an operator-submitted entry at the boundary. Returns a friendly
 * message rather than throwing, matching the `{ ok } | { error }` contract the
 * platform actions use.
 *
 * The date is anchored to midnight UTC exactly like parseDay in
 * actions/admin.ts, so a typed day lands on the square the operator picked. A
 * syntactically valid but non-existent date (2026-02-30) is rejected rather
 * than silently rolling into the next month.
 */
export function normalizeCalendarEventInput(raw: CalendarEventInput): CalendarNormalizeResult {
  const title = trimmedOrNull(raw.title);
  if (!title) return { ok: false, error: "Give the entry a title." };
  if (title.length > TITLE_MAX) {
    return { ok: false, error: `Keep the title under ${TITLE_MAX} characters.` };
  }

  const day = trimmedOrNull(raw.day);
  if (!day || !DAY_RE.test(day)) {
    return { ok: false, error: "Pick a date for the entry." };
  }
  const startsAt = new Date(`${day}T00:00:00.000Z`);
  // Round-trip guards against a well-formed but impossible date (Feb 30),
  // which Date would otherwise roll forward into the next month.
  if (Number.isNaN(startsAt.getTime()) || utcDayIso(startsAt) !== day) {
    return { ok: false, error: "That date doesn't exist — pick another." };
  }

  const kindRaw = trimmedOrNull(raw.kind) ?? "note";
  if (!(CALENDAR_ENTRY_KINDS as readonly string[]).includes(kindRaw)) {
    return { ok: false, error: "Choose a valid entry kind." };
  }

  const notes = trimmedOrNull(raw.notes);
  if (notes && notes.length > NOTES_MAX) {
    return { ok: false, error: `Keep the note under ${NOTES_MAX} characters.` };
  }

  // An amount is optional — most entries are reminders. But a typo must not
  // silently become "no amount", or the operator's billing quietly vanishes
  // from the month's expected total.
  let amountCents: number | null = null;
  const rawAmount = trimmedOrNull(raw.amount);
  if (rawAmount !== null) {
    amountCents = parsePaymentAmountCents(rawAmount);
    if (amountCents == null) {
      return { ok: false, error: "Enter a valid amount, or leave it blank." };
    }
  }

  const tenantId = trimmedOrNull(raw.tenantId);
  // A tenant link and a free-text client label would name two different owners
  // for one entry; the concrete tenant wins.
  const clientLabel = tenantId ? null : trimmedOrNull(raw.clientLabel);
  if (clientLabel && clientLabel.length > CLIENT_LABEL_MAX) {
    return { ok: false, error: `Keep the client name under ${CLIENT_LABEL_MAX} characters.` };
  }

  return {
    ok: true,
    value: {
      tenantId,
      clientLabel,
      title,
      notes,
      startsAt,
      kind: kindRaw as CalendarEntryKind,
      amountCents,
    },
  };
}

const URGENCY_RANK: Record<CalendarUrgency, number> = {
  overdue: 0,
  due_soon: 1,
  scheduled: 2,
};

/** Most urgent first, then real due dates ahead of projections, then by name. */
function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  const byUrgency = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
  if (byUrgency !== 0) return byUrgency;
  if (a.projected !== b.projected) return a.projected ? 1 : -1;
  return a.title.localeCompare(b.title);
}

/**
 * Group events under their day key so each grid cell is a single Map lookup.
 * Days with nothing on them are simply absent rather than empty arrays.
 */
export function bucketByDay(events: readonly CalendarEvent[]): Map<string, CalendarEvent[]> {
  const buckets = new Map<string, CalendarEvent[]>();

  for (const event of events) {
    const bucket = buckets.get(event.day);
    if (bucket) bucket.push(event);
    else buckets.set(event.day, [event]);
  }

  for (const bucket of buckets.values()) bucket.sort(compareEvents);

  return buckets;
}
