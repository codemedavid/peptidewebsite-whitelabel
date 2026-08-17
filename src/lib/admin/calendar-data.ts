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

/** A tenant offered in the "file this against…" picker. */
export type CalendarTenantOption = { id: string; name: string };

export type CalendarMonthData = {
  grid: MonthGrid;
  /** Day key -> events, already ordered most-urgent-first. */
  eventsByDay: Record<string, CalendarEvent[]>;
  tenantOptions: CalendarTenantOption[];
  /** False when platform_calendar_events isn't in the DB yet. */
  entriesAvailable: boolean;
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
      },
    });
    return { rows, available: true };
  } catch {
    // Table not pushed yet — show the derived half rather than failing.
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
      todayIso,
    };
  }

  const [tenants, manual] = await Promise.all([loadCalendarTenants(), loadManualEvents(start, end)]);

  const tenantNameById: Record<string, string> = {};
  for (const tenant of tenants) tenantNameById[tenant.id] = tenant.name;

  const events: CalendarEvent[] = [
    ...deriveTenantEvents(tenants, { now, rangeStart: start, rangeEnd: end }),
    ...manual.rows.map((row) => toManualEvent(row, tenantNameById)),
  ];

  // Map -> plain object so the payload crosses the server/client boundary.
  const eventsByDay: Record<string, CalendarEvent[]> = {};
  for (const [day, dayEvents] of bucketByDay(events)) eventsByDay[day] = dayEvents;

  return {
    grid: buildMonthGrid(year, month, todayIso),
    eventsByDay,
    tenantOptions: tenants
      .map((t) => ({ id: t.id, name: t.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    entriesAvailable: manual.available,
    todayIso,
  };
}
