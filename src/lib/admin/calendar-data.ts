import "server-only";

/**
 * Server reads for the Super Admin calendar. Pairs the live tenant windows
 * (due dates, derived — never stored) with the operator's own stored entries,
 * and hands the page a single month payload.
 *
 * Mirrors income-data.ts: a narrow select with a two-tier fallback, so a column
 * that hasn't been pushed yet degrades to a thinner read instead of 500-ing the
 * page. The stored-entry read is fail-open for the same reason — until
 * `npm run db:push` creates platform_calendar_events, the calendar still shows
 * every tenant due date and simply has no operator entries on it.
 *
 * Deliberately uncached: unstable_cache returns Date fields as strings on a
 * cache hit (the bug behind digest 1778715061), and a calendar that silently
 * flips a due date to the wrong day is worse than one that costs a query.
 * loadTenantSubscriptionSignals in data.ts skips the cache for the same
 * day-boundary reason.
 */

import { prisma } from "@/lib/db/prisma";
import { isDemoMode } from "@/lib/demo/fixtures";
import { getPlanConfig } from "@/lib/platform/plan-config-server";
import { planConfigPriceCents } from "@/lib/platform/plan-config";
import { effectivePlanFeeCents } from "@/lib/subscription/plan-fee";
import {
  buildMonthGrid,
  bucketByDay,
  deriveTenantEvents,
  gridRange,
  toManualEvent,
  utcDayIso,
  type CalendarEvent,
  type CalendarTenantInput,
  type ManualEventRow,
  type MonthGrid,
} from "./calendar-core";
import {
  buildSettlementIndex,
  monthMoney,
  settlementEvents,
  type SettlementRow,
} from "./calendar-settlement";

/** A tenant offered in the "file this against…" picker. */
export type CalendarTenantOption = { id: string; name: string };

export type CalendarMonthData = {
  grid: MonthGrid;
  /** Day key -> events, already ordered most-urgent-first. */
  eventsByDay: Record<string, CalendarEvent[]>;
  tenantOptions: CalendarTenantOption[];
  /** False when platform_calendar_events isn't in the DB yet. */
  entriesAvailable: boolean;
  /** False when subscription_payments isn't readable — mark-paid is then hidden. */
  paidAvailable: boolean;
  /** Subscription money received in THIS month, centavos (keyed on paidDay). */
  collectedCents: number;
  /** What THIS month should bring in: every due date on it, paid or not. */
  expectedCents: number;
  todayIso: string;
};

async function loadCalendarTenants(): Promise<CalendarTenantInput[]> {
  const baseSelect = {
    id: true,
    name: true,
    slug: true,
    status: true,
    plan: { select: { key: true } },
  } as const;

  const planConfig = await getPlanConfig();

  try {
    const rows = await prisma.tenant.findMany({
      select: {
        ...baseSelect,
        subscriptionStartsAt: true,
        subscriptionEndsAt: true,
        subscriptionCycle: true,
        subscriptionPriceCents: true,
        onboardingSubmissions: {
          where: { trial: true },
          select: { trialEndsAt: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      subscriptionStartsAt: t.subscriptionStartsAt,
      subscriptionEndsAt: t.subscriptionEndsAt,
      subscriptionCycle: t.subscriptionCycle,
      monthlyCents: effectivePlanFeeCents(
        t.subscriptionPriceCents,
        planConfigPriceCents(planConfig, t.plan.key),
      ),
      trialEndsAt: t.onboardingSubmissions[0]?.trialEndsAt ?? null,
    }));
  } catch {
    // A column or relation isn't pushed yet — fall back to the identity fields
    // so the grid still renders (it just has no due dates to place).
    try {
      const rows = await prisma.tenant.findMany({ select: baseSelect });
      return rows.map((t) => ({ id: t.id, name: t.name, slug: t.slug, status: t.status }));
    } catch {
      return [];
    }
  }
}

async function loadManualEvents(
  start: Date,
  end: Date,
): Promise<{ rows: ManualEventRow[]; available: boolean }> {
  try {
    const rows = await prisma.platformCalendarEvent.findMany({
      where: { startsAt: { gte: start, lte: end } },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        tenantId: true,
        clientLabel: true,
        title: true,
        notes: true,
        startsAt: true,
        kind: true,
        doneAt: true,
        amountCents: true,
      },
    });
    return { rows, available: true };
  } catch {
    // Table not pushed yet — show the derived half rather than failing.
    return { rows: [], available: false };
  }
}

/**
 * Confirmed subscription payments this month's page needs, which is two
 * overlapping-but-different sets — hence the OR rather than one range:
 *
 *   • CHIPS   — a payment settles the day its `periodEnd` falls on, so anything
 *     whose term ends inside the visible grid gets plotted, however long ago it
 *     was actually paid.
 *   • MONEY   — "received this month" is keyed on when the money landed, so a
 *     payment taken this month against NEXT month's term still counts here.
 *     Rows with no paidAt fall back to submittedAt, matching the index.
 *
 * Fail-open like every other admin loader — a missing subscription_payments
 * table degrades to "nothing settled" rather than taking the calendar down.
 */
async function loadSettlementRows(
  grid: { start: Date; end: Date },
  month: { start: Date; end: Date },
): Promise<{ rows: SettlementRow[]; available: boolean }> {
  try {
    const rows = await prisma.subscriptionPayment.findMany({
      where: {
        status: "confirmed",
        OR: [
          { periodEnd: { gte: grid.start, lte: grid.end } },
          { paidAt: { gte: month.start, lte: month.end } },
          { paidAt: null, submittedAt: { gte: month.start, lte: month.end } },
        ],
      },
      select: {
        id: true,
        tenantId: true,
        amountCents: true,
        status: true,
        method: true,
        periodStart: true,
        periodEnd: true,
        paidAt: true,
        submittedAt: true,
        reviewNote: true,
      },
    });
    return { rows, available: true };
  } catch {
    return { rows: [], available: false };
  }
}

/**
 * Everything the Calendar page renders for one month. `now` is injectable so
 * the page (and any future test) controls "today" rather than the clock.
 */
export async function getCalendarMonth(
  year: number,
  month: number,
  now: Date = new Date(),
): Promise<CalendarMonthData> {
  const { start, end } = gridRange(year, month);
  const todayIso = utcDayIso(now);

  if (isDemoMode()) {
    return {
      grid: buildMonthGrid(year, month, todayIso),
      eventsByDay: {},
      tenantOptions: [],
      entriesAvailable: false,
      paidAvailable: false,
      collectedCents: 0,
      expectedCents: 0,
      todayIso,
    };
  }

  // The month proper (not the 6x7 grid, whose edge cells belong to the
  // neighbouring months) — what "received this month" is measured over.
  const monthRange = {
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 1) - 1),
  };

  const [tenants, manual, settled] = await Promise.all([
    loadCalendarTenants(),
    loadManualEvents(start, end),
    loadSettlementRows({ start, end }, monthRange),
  ]);

  const tenantNameById: Record<string, string> = {};
  for (const tenant of tenants) tenantNameById[tenant.id] = tenant.name;

  const settlements = buildSettlementIndex(settled.rows);
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;

  const events: CalendarEvent[] = [
    ...deriveTenantEvents(tenants, {
      now,
      rangeStart: start,
      rangeEnd: end,
      settled: new Set(settlements.keys()),
    }),
    ...settlementEvents(settlements.values(), tenantNameById, { start, end }),
    ...manual.rows.map((row) => toManualEvent(row, tenantNameById)),
  ];

  // Map -> plain object so the payload crosses the server/client boundary.
  const eventsByDay: Record<string, CalendarEvent[]> = {};
  for (const [day, dayEvents] of bucketByDay(events)) eventsByDay[day] = dayEvents;

  // Expected vs received for the month — tenant dues AND the operator's own
  // billings. Pure, so the rules stay testable (npm run test:calendar-paid).
  const { expectedCents, collectedCents } = monthMoney(
    events,
    [...settlements.values()],
    monthPrefix,
  );

  return {
    grid: buildMonthGrid(year, month, todayIso),
    eventsByDay,
    tenantOptions: tenants
      .map((t) => ({ id: t.id, name: t.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    entriesAvailable: manual.available,
    paidAvailable: settled.available,
    collectedCents,
    expectedCents,
    todayIso,
  };
}
