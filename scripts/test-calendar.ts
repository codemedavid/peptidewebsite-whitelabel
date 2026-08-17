/**
 * Self-contained test for the pure Super Admin calendar core (no DB, no Next
 * runtime). This is the month-grid + event-derivation layer the operator's
 * Calendar page renders from: every tenant's subscription due date plotted on
 * its own day, projected forward one cycle at a time, merged with the
 * operator's own hand-added schedule entries.
 *
 * Day bucketing is UTC on purpose. Operator-set dates are written by parseDay()
 * (src/actions/admin.ts) as `${yyyy-mm-dd}T00:00:00.000Z`, and the cycle math in
 * billing-cycle.ts is UTC too — so bucketing in UTC puts a due date on the same
 * calendar square the operator typed. Bucketing in a local zone would shift
 * every one of them backwards a cell.
 *
 *   - src/lib/admin/calendar-core.ts
 *       utcDayIso(value)                     — "YYYY-MM-DD" for a Date/ISO string
 *       daysInUtcMonth(year, month)          — calendar length, leap-year aware
 *       shiftMonth(year, month, delta)       — month nav with year rollover
 *       buildMonthGrid(year, month, todayIso)— fixed 6x7 = 42 cells
 *       gridRange(year, month)               — the instant span the grid covers
 *       deriveTenantEvents(tenants, opts)    — renewals + projections + trial ends
 *       toManualEvent(row, tenantNameById)   — operator-authored row -> event
 *       bucketByDay(events)                  — Map<"YYYY-MM-DD", CalendarEvent[]>
 *
 *   npm run test:calendar
 */

import assert from "node:assert";

import {
  utcDayIso,
  daysInUtcMonth,
  shiftMonth,
  buildMonthGrid,
  gridRange,
  deriveTenantEvents,
  toManualEvent,
  bucketByDay,
  MONTH_GRID_CELLS,
  type CalendarEvent,
  type CalendarTenantInput,
} from "../src/lib/admin/calendar-core";

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

const NOW = new Date("2026-08-17T09:00:00.000Z");

/** A tenant with an operator-set window ending on `subscriptionEndsAt`. */
function tenant(over: Partial<CalendarTenantInput> = {}): CalendarTenantInput {
  return {
    id: "t1",
    name: "HP Glow",
    slug: "hpglow",
    status: "active",
    subscriptionStartsAt: "2026-07-20T00:00:00.000Z",
    subscriptionEndsAt: "2026-08-20T00:00:00.000Z",
    subscriptionCycle: "monthly",
    monthlyCents: 189_900,
    ...over,
  };
}

/** The grid window for the month containing NOW (August 2026). */
const AUG = gridRange(2026, 7);

function derive(tenants: CalendarTenantInput[], range = AUG): CalendarEvent[] {
  return deriveTenantEvents(tenants, { now: NOW, rangeStart: range.start, rangeEnd: range.end });
}

console.log("\nSuper Admin calendar — pure core\n");

// ───────────────────────────── day bucketing (UTC) ──────────────────────────
console.log("day bucketing");

check("utcDayIso formats a Date as YYYY-MM-DD", () => {
  assert.strictEqual(utcDayIso(new Date("2026-08-17T09:00:00.000Z")), "2026-08-17");
});

check("utcDayIso accepts an ISO string", () => {
  assert.strictEqual(utcDayIso("2026-01-05T00:00:00.000Z"), "2026-01-05");
});

check("utcDayIso pads single-digit months and days", () => {
  assert.strictEqual(utcDayIso("2026-03-07T00:00:00.000Z"), "2026-03-07");
});

check("a late-evening UTC instant stays on its own UTC day", () => {
  // The trap this guards: bucketing in Asia/Manila (UTC+8) would roll this to
  // the 18th and shift every operator-typed due date one square.
  assert.strictEqual(utcDayIso("2026-08-17T22:30:00.000Z"), "2026-08-17");
});

check("an off-midnight legacy row still buckets to its calendar day", () => {
  assert.strictEqual(utcDayIso("2026-08-17T00:00:01.000Z"), "2026-08-17");
});

// ───────────────────────────── month arithmetic ─────────────────────────────
console.log("\nmonth arithmetic");

check("daysInUtcMonth knows a 31-day month", () => {
  assert.strictEqual(daysInUtcMonth(2026, 0), 31); // January
});

check("daysInUtcMonth knows a 30-day month", () => {
  assert.strictEqual(daysInUtcMonth(2026, 3), 30); // April
});

check("daysInUtcMonth knows a common-year February", () => {
  assert.strictEqual(daysInUtcMonth(2026, 1), 28);
});

check("daysInUtcMonth knows a leap-year February", () => {
  assert.strictEqual(daysInUtcMonth(2024, 1), 29);
});

check("shiftMonth advances within a year", () => {
  assert.deepStrictEqual(shiftMonth(2026, 7, 1), { year: 2026, month: 8 });
});

check("shiftMonth rolls forward over a year boundary", () => {
  assert.deepStrictEqual(shiftMonth(2026, 11, 1), { year: 2027, month: 0 });
});

check("shiftMonth rolls backward over a year boundary", () => {
  assert.deepStrictEqual(shiftMonth(2026, 0, -1), { year: 2025, month: 11 });
});

check("shiftMonth handles multi-month jumps", () => {
  assert.deepStrictEqual(shiftMonth(2026, 10, 3), { year: 2027, month: 1 });
});

// ──────────────────────────────── month grid ────────────────────────────────
console.log("\nmonth grid");

check("a grid is always 42 cells (6 stable rows)", () => {
  assert.strictEqual(MONTH_GRID_CELLS, 42);
  assert.strictEqual(buildMonthGrid(2026, 7, "2026-08-17").cells.length, 42);
});

check("every month of a year yields a full 42-cell grid", () => {
  for (let m = 0; m < 12; m++) {
    assert.strictEqual(buildMonthGrid(2026, m, "2026-08-17").cells.length, 42, `month ${m}`);
  }
});

check("the grid starts on a Sunday", () => {
  const grid = buildMonthGrid(2026, 7, "2026-08-17");
  assert.strictEqual(new Date(`${grid.cells[0].day}T00:00:00.000Z`).getUTCDay(), 0);
});

check("the grid contains every day of the target month", () => {
  const grid = buildMonthGrid(2026, 7, "2026-08-17");
  const inMonth = grid.cells.filter((c) => c.inMonth);
  assert.strictEqual(inMonth.length, 31);
  assert.strictEqual(inMonth[0].day, "2026-08-01");
  assert.strictEqual(inMonth[30].day, "2026-08-31");
});

check("leading cells are flagged out-of-month", () => {
  const grid = buildMonthGrid(2026, 7, "2026-08-17");
  const firstInMonth = grid.cells.findIndex((c) => c.inMonth);
  for (let i = 0; i < firstInMonth; i++) {
    assert.strictEqual(grid.cells[i].inMonth, false, `cell ${i} should be out-of-month`);
  }
});

check("cells are strictly consecutive days", () => {
  const grid = buildMonthGrid(2026, 1, "2026-08-17"); // February, a short month
  for (let i = 1; i < grid.cells.length; i++) {
    const prev = new Date(`${grid.cells[i - 1].day}T00:00:00.000Z`).getTime();
    const cur = new Date(`${grid.cells[i].day}T00:00:00.000Z`).getTime();
    assert.strictEqual(cur - prev, 86_400_000, `gap at cell ${i}`);
  }
});

check("today is marked when it falls in the visible grid", () => {
  const grid = buildMonthGrid(2026, 7, "2026-08-17");
  const today = grid.cells.filter((c) => c.isToday);
  assert.strictEqual(today.length, 1);
  assert.strictEqual(today[0].day, "2026-08-17");
});

check("no cell is marked today when viewing another month", () => {
  const grid = buildMonthGrid(2027, 2, "2026-08-17");
  assert.strictEqual(
    grid.cells.some((c) => c.isToday),
    false,
  );
});

check("the grid carries a human month label", () => {
  assert.strictEqual(buildMonthGrid(2026, 7, "2026-08-17").label, "August 2026");
});

check("a leap-year February grid still spans its 29 days", () => {
  const grid = buildMonthGrid(2024, 1, "2026-08-17");
  assert.strictEqual(grid.cells.filter((c) => c.inMonth).length, 29);
});

check("gridRange spans the first through last visible cell", () => {
  const grid = buildMonthGrid(2026, 7, "2026-08-17");
  const range = gridRange(2026, 7);
  assert.strictEqual(utcDayIso(range.start), grid.cells[0].day);
  assert.strictEqual(utcDayIso(range.end), grid.cells[41].day);
});

// ─────────────────────────── derived renewal events ─────────────────────────
console.log("\nderived renewals");

check("a tenant's due date lands on its own day", () => {
  const renewal = derive([tenant()]).find((e) => e.kind === "renewal");
  assert.ok(renewal, "expected a renewal event");
  assert.strictEqual(renewal.day, "2026-08-20");
});

check("a renewal carries the tenant identity for linking", () => {
  const renewal = derive([tenant()]).find((e) => e.kind === "renewal");
  assert.strictEqual(renewal?.tenantId, "t1");
  assert.strictEqual(renewal?.tenantSlug, "hpglow");
  assert.strictEqual(renewal?.title, "HP Glow");
});

check("a renewal carries the amount due", () => {
  const renewal = derive([tenant()]).find((e) => e.kind === "renewal");
  assert.strictEqual(renewal?.amountCents, 189_900);
});

check("a tenant with no window produces no renewal", () => {
  const events = derive([tenant({ subscriptionEndsAt: null, subscriptionCycle: null })]);
  assert.strictEqual(events.filter((e) => e.kind === "renewal").length, 0);
});

check("a due date three days out is flagged due_soon", () => {
  const renewal = derive([tenant({ subscriptionEndsAt: "2026-08-20T00:00:00.000Z" })]).find(
    (e) => e.kind === "renewal",
  );
  assert.strictEqual(renewal?.urgency, "due_soon");
});

check("a lapsed due date is flagged overdue", () => {
  const renewal = derive([tenant({ subscriptionEndsAt: "2026-08-10T00:00:00.000Z" })]).find(
    (e) => e.kind === "renewal",
  );
  assert.strictEqual(renewal?.urgency, "overdue");
});

check("a comfortably distant due date is merely scheduled", () => {
  const sept = gridRange(2026, 8);
  const renewal = derive([tenant({ subscriptionEndsAt: "2026-09-20T00:00:00.000Z" })], sept).find(
    (e) => e.kind === "renewal" && !e.projected,
  );
  assert.strictEqual(renewal?.urgency, "scheduled");
});

check("a suspended tenant still shows its due date", () => {
  // Deliberately unlike the Income page, which counts active tenants only — a
  // suspended tenant's unpaid due date is exactly what the operator chases.
  const events = derive([tenant({ status: "suspended" })]);
  assert.strictEqual(events.filter((e) => e.kind === "renewal").length, 1);
});

check("events outside the visible range are dropped", () => {
  const events = derive([tenant({ subscriptionEndsAt: "2027-05-04T00:00:00.000Z" })]);
  assert.strictEqual(events.length, 0);
});

check("several tenants due the same day all appear", () => {
  const events = derive([
    tenant({ id: "a", name: "A" }),
    tenant({ id: "b", name: "B" }),
    tenant({ id: "c", name: "C" }),
  ]);
  assert.strictEqual(events.filter((e) => e.day === "2026-08-20").length, 3);
});

// ──────────────────────────── projected renewals ────────────────────────────
console.log("\nprojected renewals");

check("a monthly cycle projects the next renewal into a later month", () => {
  const sept = gridRange(2026, 8);
  const projected = derive([tenant()], sept).filter((e) => e.projected);
  assert.strictEqual(projected.length, 1);
  assert.strictEqual(projected[0].day, "2026-09-20");
});

check("a projection is never flagged urgent", () => {
  const sept = gridRange(2026, 8);
  const projected = derive([tenant()], sept).find((e) => e.projected);
  assert.strictEqual(projected?.urgency, "scheduled");
});

check("the current window's own renewal is not marked projected", () => {
  const renewal = derive([tenant()]).find((e) => e.kind === "renewal");
  assert.strictEqual(renewal?.projected, false);
});

check("a tenant with no cycle projects nothing forward", () => {
  const sept = gridRange(2026, 8);
  const events = derive([tenant({ subscriptionCycle: null })], sept);
  assert.strictEqual(events.filter((e) => e.projected).length, 0);
});

check("a yearly cycle does not project into next month", () => {
  const sept = gridRange(2026, 8);
  const events = derive([tenant({ subscriptionCycle: "yearly" })], sept);
  assert.strictEqual(events.filter((e) => e.projected).length, 0);
});

check("projection clamps to the end of a short month", () => {
  // Jan 31 + 1 month must land on Feb 28, not overflow into March.
  const feb = gridRange(2026, 1);
  const projected = derive(
    [
      tenant({
        subscriptionStartsAt: "2025-12-31T00:00:00.000Z",
        subscriptionEndsAt: "2026-01-31T00:00:00.000Z",
      }),
    ],
    feb,
  ).filter((e) => e.projected);
  assert.strictEqual(projected[0]?.day, "2026-02-28");
});

check("projection never runs past the visible range", () => {
  const sept = gridRange(2026, 8);
  for (const e of derive([tenant()], sept)) {
    assert.ok(new Date(e.at).getTime() <= sept.end.getTime(), `event ${e.day} escaped the range`);
  }
});

// ────────────────────────────── trial expiries ──────────────────────────────
console.log("\ntrial expiries");

check("a trial tenant's expiry lands on its day", () => {
  const events = derive([
    tenant({ status: "trial", subscriptionEndsAt: null, trialEndsAt: "2026-08-22T00:00:00.000Z" }),
  ]);
  const trial = events.find((e) => e.kind === "trial_end");
  assert.strictEqual(trial?.day, "2026-08-22");
});

check("a trial tenant does not also emit a renewal", () => {
  const events = derive([tenant({ status: "trial", trialEndsAt: "2026-08-22T00:00:00.000Z" })]);
  assert.strictEqual(events.filter((e) => e.kind === "renewal").length, 0);
});

check("a paid tenant emits no trial event", () => {
  const events = derive([tenant({ trialEndsAt: "2026-08-22T00:00:00.000Z" })]);
  assert.strictEqual(events.filter((e) => e.kind === "trial_end").length, 0);
});

// ─────────────────────────── operator-added events ──────────────────────────
console.log("\noperator-added schedules");

check("a manual event keeps its title and day", () => {
  const e = toManualEvent(
    {
      id: "m1",
      tenantId: null,
      clientLabel: null,
      title: "Quarterly review call",
      notes: "Zoom",
      startsAt: "2026-08-19T00:00:00.000Z",
      kind: "meeting",
      doneAt: null,
    },
    {},
  );
  assert.strictEqual(e.kind, "manual");
  assert.strictEqual(e.title, "Quarterly review call");
  assert.strictEqual(e.day, "2026-08-19");
  assert.strictEqual(e.notes, "Zoom");
});

check("a manual event for a platform tenant resolves that tenant's name", () => {
  const e = toManualEvent(
    {
      id: "m2",
      tenantId: "t1",
      clientLabel: null,
      title: "Send invoice",
      notes: null,
      startsAt: "2026-08-19T00:00:00.000Z",
      kind: "follow_up",
      doneAt: null,
    },
    { t1: "HP Glow" },
  );
  assert.strictEqual(e.tenantId, "t1");
  assert.strictEqual(e.subtitle, "HP Glow");
});

check("a manual event for an off-platform client uses its free-text label", () => {
  const e = toManualEvent(
    {
      id: "m3",
      tenantId: null,
      clientLabel: "Walk-in client — Cebu",
      title: "Deposit follow-up",
      notes: null,
      startsAt: "2026-08-19T00:00:00.000Z",
      kind: "follow_up",
      doneAt: null,
    },
    {},
  );
  assert.strictEqual(e.tenantId, undefined);
  assert.strictEqual(e.subtitle, "Walk-in client — Cebu");
});

check("a completed manual event is marked done", () => {
  const e = toManualEvent(
    {
      id: "m4",
      tenantId: null,
      clientLabel: null,
      title: "Renew domain",
      notes: null,
      startsAt: "2026-08-19T00:00:00.000Z",
      kind: "note",
      doneAt: "2026-08-19T10:00:00.000Z",
    },
    {},
  );
  assert.strictEqual(e.done, true);
});

check("an open manual event is not marked done", () => {
  const e = toManualEvent(
    {
      id: "m5",
      tenantId: null,
      clientLabel: null,
      title: "Renew domain",
      notes: null,
      startsAt: "2026-08-19T00:00:00.000Z",
      kind: "note",
      doneAt: null,
    },
    {},
  );
  assert.strictEqual(e.done, false);
});

// ──────────────────────────────── bucketing ─────────────────────────────────
console.log("\nbucketing");

check("events are grouped under their day key", () => {
  const buckets = bucketByDay(derive([tenant()]));
  assert.strictEqual(buckets.get("2026-08-20")?.length, 1);
});

check("a day with no events has no bucket", () => {
  const buckets = bucketByDay(derive([tenant()]));
  assert.strictEqual(buckets.get("2026-08-03"), undefined);
});

check("multiple events on one day share a bucket", () => {
  const buckets = bucketByDay(
    derive([tenant({ id: "a", name: "A" }), tenant({ id: "b", name: "B" })]),
  );
  assert.strictEqual(buckets.get("2026-08-20")?.length, 2);
});

check("bucketing an empty list yields an empty map", () => {
  assert.strictEqual(bucketByDay([]).size, 0);
});

check("overdue events sort ahead of scheduled ones on the same day", () => {
  const buckets = bucketByDay([
    ...derive([tenant({ id: "a", name: "Scheduled", subscriptionEndsAt: "2026-08-20T00:00:00.000Z" })]),
    ...derive([tenant({ id: "b", name: "Overdue", subscriptionEndsAt: "2026-08-10T00:00:00.000Z" })]),
  ]);
  assert.strictEqual(buckets.get("2026-08-20")?.[0].title, "Scheduled");
  assert.strictEqual(buckets.get("2026-08-10")?.[0].title, "Overdue");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
