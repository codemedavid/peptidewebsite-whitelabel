/**
 * Self-contained test for the Super Admin calendar's SETTLEMENT core — the
 * "this tenant paid" half of /admin/calendar (no DB, no Next runtime).
 *
 * The operator clicks a tenant's due date on the calendar and marks it paid.
 * Three things must follow, and this file pins all three:
 *
 *   1. a CONFIRMED SubscriptionPayment is planned, dated in the month the money
 *      actually landed — which is what My Income rolls up (income-analytics.ts
 *      counts confirmed rows by paidAt ?? submittedAt);
 *   2. the tenant's subscription WINDOW rolls forward one cycle, which is the
 *      only thing that clears the near-due countdown (near-due.ts reads the
 *      window, not the ledger) — so paying stops the banner by construction;
 *   3. the settled due date renders as a PAID chip instead of an unpaid renewal,
 *      and the derived renewal for that day is suppressed so the square never
 *      shows "due" and "paid" side by side.
 *
 * Dates are UTC throughout, for the same reason calendar-core.ts is: operator
 * dates are written as `${yyyy-mm-dd}T00:00:00.000Z` and the cycle math in
 * billing-cycle.ts is UTC. Bucketing anywhere else shifts every due date a day.
 *
 *   - src/lib/admin/calendar-settlement.ts
 *       settlementKey(tenantId, day)          — the tenant+day index key
 *       buildSettlementIndex(rows)            — confirmed ledger rows -> index
 *       settlementEvents(index, names, range) — paid chips for the grid
 *       defaultNextDueDay(cycle, dueDay)      — the pre-filled next due date
 *       planSettlement(input)                 — validate + payment + next window
 *       planSettlementReversal(input)         — undo, restoring the old window
 *   - src/lib/admin/calendar-core.ts
 *       deriveTenantEvents(..., { settled })  — settled renewals are suppressed
 *
 *   npm run test:calendar-paid
 */

import assert from "node:assert";

import {
  deriveTenantEvents,
  gridRange,
  type CalendarEvent,
  type CalendarTenantInput,
} from "../src/lib/admin/calendar-core";
import {
  CALENDAR_SETTLEMENT_NOTE,
  buildSettlementIndex,
  defaultNextDueDay,
  monthMoney,
  planSettlement,
  planSettlementReversal,
  settlementEvents,
  settlementKey,
  type SettlementPlanInput,
  type SettlementRow,
} from "../src/lib/admin/calendar-settlement";

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

/** A paid tenant whose current window ends 2026-08-21. */
function tenant(over: Partial<SettlementPlanInput["tenant"]> = {}): SettlementPlanInput["tenant"] {
  return {
    id: "t1",
    status: "active",
    subscriptionStartsAt: "2026-07-21T00:00:00.000Z",
    subscriptionEndsAt: "2026-08-21T00:00:00.000Z",
    subscriptionCycle: "monthly",
    ...over,
  };
}

function plan(over: Partial<SettlementPlanInput> = {}) {
  return planSettlement({
    tenant: tenant(),
    dueDay: "2026-08-21",
    amount: "1499",
    now: NOW,
    ...over,
  });
}

/** Unwrap an expected-ok plan, failing loudly with the error otherwise. */
function ok<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  assert.ok(result.ok, `expected ok, got error: ${result.ok ? "" : result.error}`);
  return result.value;
}

function errorOf(result: { ok: true; value: unknown } | { ok: false; error: string }): string {
  assert.ok(!result.ok, "expected an error, got ok");
  return result.error;
}

/** A confirmed ledger row settling 2026-08-21 for tenant t1. */
function row(over: Partial<SettlementRow> = {}): SettlementRow {
  return {
    id: "p1",
    tenantId: "t1",
    amountCents: 149_900,
    status: "confirmed",
    method: "GCash",
    periodStart: "2026-07-21T00:00:00.000Z",
    periodEnd: "2026-08-21T00:00:00.000Z",
    paidAt: "2026-08-18T00:00:00.000Z",
    submittedAt: "2026-08-18T00:00:00.000Z",
    reviewNote: CALENDAR_SETTLEMENT_NOTE,
    ...over,
  };
}

const AUG = gridRange(2026, 7);

console.log("\nSuper Admin calendar — settlement core\n");

// ─────────────────────────────── the index key ──────────────────────────────
console.log("settlement index");

check("settlementKey pairs a tenant with a UTC day", () => {
  assert.strictEqual(settlementKey("t1", "2026-08-21"), "t1:2026-08-21");
});

check("a confirmed row indexes under the due date it covers", () => {
  const index = buildSettlementIndex([row()]);
  const found = index.get(settlementKey("t1", "2026-08-21"));
  assert.ok(found, "expected the row to be indexed on its periodEnd day");
  assert.strictEqual(found.amountCents, 149_900);
  assert.strictEqual(found.method, "GCash");
});

check("the paid day is tracked separately from the day settled", () => {
  // Paid on the 18th, covering the term that ends on the 21st: the chip belongs
  // on the 21st, but My Income counts the money on the 18th.
  const found = buildSettlementIndex([row()]).get(settlementKey("t1", "2026-08-21"));
  assert.strictEqual(found?.day, "2026-08-21");
  assert.strictEqual(found?.paidDay, "2026-08-18");
});

check("a pending row is not a settlement", () => {
  assert.strictEqual(buildSettlementIndex([row({ status: "pending" })]).size, 0);
});

check("a failed row is not a settlement", () => {
  assert.strictEqual(buildSettlementIndex([row({ status: "failed" })]).size, 0);
});

check("an unknown status is not trusted as paid", () => {
  assert.strictEqual(buildSettlementIndex([row({ status: "CONFIRMED " })]).size, 0);
});

check("a row with no period falls back to the day it was paid", () => {
  const index = buildSettlementIndex([row({ periodStart: null, periodEnd: null })]);
  assert.ok(index.get(settlementKey("t1", "2026-08-18")), "expected it to land on paidAt");
});

check("a row with no period and no paidAt falls back to submittedAt", () => {
  const index = buildSettlementIndex([
    row({ periodStart: null, periodEnd: null, paidAt: null, submittedAt: "2026-08-05T00:00:00.000Z" }),
  ]);
  assert.ok(index.get(settlementKey("t1", "2026-08-05")), "expected it to land on submittedAt");
});

check("a row with no usable date at all is dropped, not crashed on", () => {
  const index = buildSettlementIndex([
    row({ periodStart: null, periodEnd: null, paidAt: null, submittedAt: null }),
  ]);
  assert.strictEqual(index.size, 0);
});

check("two payments on one due date keep the later one", () => {
  const index = buildSettlementIndex([
    row({ id: "old", amountCents: 100, paidAt: "2026-08-10T00:00:00.000Z" }),
    row({ id: "new", amountCents: 200, paidAt: "2026-08-19T00:00:00.000Z" }),
  ]);
  assert.strictEqual(index.get(settlementKey("t1", "2026-08-21"))?.id, "new");
});

check("two tenants paying the same day do not collide", () => {
  const index = buildSettlementIndex([row(), row({ id: "p2", tenantId: "t2" })]);
  assert.strictEqual(index.size, 2);
});

check("a calendar-marked payment is flagged undoable", () => {
  assert.strictEqual(buildSettlementIndex([row()]).get(settlementKey("t1", "2026-08-21"))?.fromCalendar, true);
});

check("a tenant-filed payment is not flagged undoable", () => {
  const index = buildSettlementIndex([row({ reviewNote: "" })]);
  assert.strictEqual(index.get(settlementKey("t1", "2026-08-21"))?.fromCalendar, false);
});

// ────────────────────────────── the paid chips ──────────────────────────────
console.log("\npaid chips on the grid");

const NAMES = { t1: "HP GLOW" };

check("a settlement renders as a paid event on its due day", () => {
  const events = settlementEvents(buildSettlementIndex([row()]).values(), NAMES, AUG);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].day, "2026-08-21");
  assert.strictEqual(events[0].kind, "payment");
  assert.strictEqual(events[0].title, "HP GLOW");
  assert.strictEqual(events[0].paid, true);
});

check("a paid event carries the amount received", () => {
  const [event] = settlementEvents(buildSettlementIndex([row()]).values(), NAMES, AUG);
  assert.strictEqual(event.amountCents, 149_900);
});

check("a paid event is never urgent", () => {
  const [event] = settlementEvents(buildSettlementIndex([row()]).values(), NAMES, AUG);
  assert.strictEqual(event.urgency, "scheduled");
});

check("a paid event carries the payment id so it can be undone", () => {
  const [event] = settlementEvents(buildSettlementIndex([row()]).values(), NAMES, AUG);
  assert.strictEqual(event.settlementId, "p1");
});

check("an unnamed tenant still renders rather than blanking the chip", () => {
  const [event] = settlementEvents(buildSettlementIndex([row()]).values(), {}, AUG);
  assert.ok(event.title.length > 0, "expected a fallback title");
});

check("a settlement outside the visible grid is not plotted", () => {
  const far = row({ periodEnd: "2027-03-21T00:00:00.000Z" });
  assert.strictEqual(settlementEvents(buildSettlementIndex([far]).values(), NAMES, AUG).length, 0);
});

// ───────────────────── settled renewals leave the grid ──────────────────────
console.log("\nsettled renewals are suppressed");

const CAL_TENANT: CalendarTenantInput = {
  id: "t1",
  name: "HP GLOW",
  slug: "hpglow",
  status: "active",
  subscriptionStartsAt: "2026-07-21T00:00:00.000Z",
  subscriptionEndsAt: "2026-08-21T00:00:00.000Z",
  subscriptionCycle: "monthly",
  monthlyCents: 149_900,
};

check("an unsettled due date is still derived", () => {
  const events = deriveTenantEvents([CAL_TENANT], {
    now: NOW,
    rangeStart: AUG.start,
    rangeEnd: AUG.end,
  });
  assert.ok(
    events.some((e) => e.kind === "renewal" && e.day === "2026-08-21" && !e.projected),
    "expected the real due date to be on the grid",
  );
});

check("a settled due date drops out of the derived renewals", () => {
  const events = deriveTenantEvents([CAL_TENANT], {
    now: NOW,
    rangeStart: AUG.start,
    rangeEnd: AUG.end,
    settled: new Set([settlementKey("t1", "2026-08-21")]),
  });
  assert.ok(
    !events.some((e) => e.kind === "renewal" && e.day === "2026-08-21"),
    "a paid due date must not also read as due",
  );
});

check("settling one tenant does not hide another's due date", () => {
  const other: CalendarTenantInput = { ...CAL_TENANT, id: "t2", name: "K Glow", slug: "kglow" };
  const events = deriveTenantEvents([CAL_TENANT, other], {
    now: NOW,
    rangeStart: AUG.start,
    rangeEnd: AUG.end,
    settled: new Set([settlementKey("t1", "2026-08-21")]),
  });
  assert.strictEqual(events.filter((e) => e.kind === "renewal" && e.day === "2026-08-21").length, 1);
});

check("a settled projection is suppressed too", () => {
  const events = deriveTenantEvents([CAL_TENANT], {
    now: NOW,
    rangeStart: AUG.start,
    rangeEnd: AUG.end,
    settled: new Set([settlementKey("t1", "2026-09-21")]),
  });
  assert.ok(
    !events.some((e) => e.day === "2026-09-21"),
    "a paid projected cycle must not read as upcoming",
  );
});

// ──────────────────────────── the next due date ─────────────────────────────
console.log("\nnext due date");

check("monthly rolls one calendar month", () => {
  assert.strictEqual(defaultNextDueDay("monthly", "2026-08-21"), "2026-09-21");
});

check("quarterly rolls three months", () => {
  assert.strictEqual(defaultNextDueDay("quarterly", "2026-08-21"), "2026-11-21");
});

check("yearly rolls twelve months", () => {
  assert.strictEqual(defaultNextDueDay("yearly", "2026-08-21"), "2027-08-21");
});

check("a short target month clamps rather than overflowing", () => {
  assert.strictEqual(defaultNextDueDay("monthly", "2026-01-31"), "2026-02-28");
});

check("a missing cycle falls back to monthly", () => {
  assert.strictEqual(defaultNextDueDay(null, "2026-08-21"), "2026-09-21");
});

check("a junk cycle falls back to monthly rather than throwing", () => {
  assert.strictEqual(defaultNextDueDay("weekly", "2026-08-21"), "2026-09-21");
});

// ───────────────────────── planning the settlement ──────────────────────────
console.log("\nplanSettlement — validation");

check("a blank amount is refused", () => {
  assert.match(errorOf(plan({ amount: "" })), /amount/i);
});

check("a zero amount is refused", () => {
  assert.match(errorOf(plan({ amount: "0" })), /amount/i);
});

check("a negative amount is refused", () => {
  assert.match(errorOf(plan({ amount: "-500" })), /amount/i);
});

check("a non-numeric amount is refused", () => {
  assert.match(errorOf(plan({ amount: "paid na" })), /amount/i);
});

check("a peso-formatted amount is accepted", () => {
  assert.strictEqual(ok(plan({ amount: "₱1,499.50" })).payment.amountCents, 149_950);
});

check("a malformed due day is refused", () => {
  assert.ok(!plan({ dueDay: "2026-8-21" }).ok);
});

check("a date that does not exist is refused", () => {
  assert.ok(!plan({ dueDay: "2026-02-30" }).ok);
});

check("a trial tenant cannot be settled", () => {
  const result = plan({ tenant: tenant({ status: "trial" }) });
  assert.match(errorOf(result), /trial/i);
});

console.log("\nplanSettlement — the payment");

check("the payment is confirmed, so it counts as income immediately", () => {
  assert.strictEqual(ok(plan()).payment.status, "confirmed");
});

check("the payment is stamped with the calendar note, so it can be undone", () => {
  assert.strictEqual(ok(plan()).payment.reviewNote, CALENDAR_SETTLEMENT_NOTE);
});

check("the payment covers the term ending on the due date", () => {
  const { payment } = ok(plan());
  assert.strictEqual(payment.periodEnd.toISOString(), "2026-08-21T00:00:00.000Z");
  assert.strictEqual(payment.periodStart?.toISOString(), "2026-07-21T00:00:00.000Z");
});

check("the payment snapshots the tenant's cycle", () => {
  assert.strictEqual(ok(plan()).payment.cycle, "monthly");
});

check("with no paid date given, the money is dated on the due date", () => {
  assert.strictEqual(ok(plan()).payment.paidAt.toISOString(), "2026-08-21T00:00:00.000Z");
});

check("an explicit paid date is what the income month keys on", () => {
  const { payment } = ok(plan({ paidDay: "2026-08-05" }));
  assert.strictEqual(payment.paidAt.toISOString(), "2026-08-05T00:00:00.000Z");
});

check("a malformed paid date is refused rather than silently ignored", () => {
  assert.ok(!plan({ paidDay: "05/08/2026" }).ok);
});

check("the recorded method defaults to something legible", () => {
  assert.ok(ok(plan()).payment.method.length > 0);
});

check("a chosen method is kept", () => {
  assert.strictEqual(ok(plan({ method: "GCash" })).payment.method, "GCash");
});

console.log("\nplanSettlement — the window roll");

check("paying the live due date rolls the window forward one cycle", () => {
  const { nextWindow } = ok(plan());
  assert.ok(nextWindow, "expected the window to advance");
  assert.strictEqual(nextWindow.startsAt.toISOString(), "2026-08-21T00:00:00.000Z");
  assert.strictEqual(nextWindow.endsAt.toISOString(), "2026-09-21T00:00:00.000Z");
});

check("the rolled window clears near-due, which is the whole point", () => {
  // NEAR_DUE_DAYS is 7 and the old date was 4 days out; the new one is ~35.
  const { nextWindow } = ok(plan());
  const daysLeft = Math.round((nextWindow!.endsAt.getTime() - NOW.getTime()) / 86_400_000);
  assert.ok(daysLeft > 7, `expected the countdown to clear, ${daysLeft} days left`);
});

check("a yearly tenant rolls a year, not a month", () => {
  const yearly = tenant({ subscriptionCycle: "yearly" });
  assert.strictEqual(ok(plan({ tenant: yearly })).nextWindow?.endsAt.toISOString(), "2027-08-21T00:00:00.000Z");
});

check("an operator-typed next due date wins over the cycle default", () => {
  const { nextWindow } = ok(plan({ nextDueDay: "2026-10-01" }));
  assert.strictEqual(nextWindow?.endsAt.toISOString(), "2026-10-01T00:00:00.000Z");
});

check("a next due date on or before the one being paid is refused", () => {
  assert.ok(!plan({ nextDueDay: "2026-08-21" }).ok);
  assert.ok(!plan({ nextDueDay: "2026-08-01" }).ok);
});

check("paying a date that is not the live due date records money but moves nothing", () => {
  // A back-dated square (last term) — rewriting the window from it would undo
  // the operator's real current term.
  const result = ok(plan({ dueDay: "2026-07-21" }));
  assert.strictEqual(result.nextWindow, null);
  assert.strictEqual(result.payment.amountCents, 149_900);
});

check("a tenant with no window records money but moves nothing", () => {
  const noWindow = tenant({ subscriptionStartsAt: null, subscriptionEndsAt: null, subscriptionCycle: null });
  assert.strictEqual(ok(plan({ tenant: noWindow })).nextWindow, null);
});

check("a cycle-less tenant on their live due date still rolls, monthly by default", () => {
  const noCycle = tenant({ subscriptionCycle: null });
  assert.strictEqual(ok(plan({ tenant: noCycle })).nextWindow?.endsAt.toISOString(), "2026-09-21T00:00:00.000Z");
});

console.log("\nplanSettlement — what the tenant is billed next (singil)");

check("the cycle chosen on the form wins over the tenant's stored one", () => {
  const { nextWindow, payment } = ok(plan({ cycle: "yearly" }));
  assert.strictEqual(nextWindow?.endsAt.toISOString(), "2027-08-21T00:00:00.000Z");
  assert.strictEqual(payment.cycle, "yearly");
});

check("choosing monthly on a yearly tenant rolls a month", () => {
  const yearly = tenant({ subscriptionCycle: "yearly" });
  const { nextWindow } = ok(plan({ tenant: yearly, cycle: "monthly" }));
  assert.strictEqual(nextWindow?.endsAt.toISOString(), "2026-09-21T00:00:00.000Z");
});

check("an unknown cycle from the form is refused, not guessed at", () => {
  assert.ok(!plan({ cycle: "weekly" }).ok);
});

check("no billing amount typed leaves the tenant's pricing alone", () => {
  assert.strictEqual(ok(plan()).nextBilling, null);
});

check("a monthly billing amount is recorded as both term and monthly rate", () => {
  const { nextBilling } = ok(plan({ billAmount: "1,590", cycle: "monthly" }));
  assert.strictEqual(nextBilling?.termCents, 159_000);
  assert.strictEqual(nextBilling?.monthlyCents, 159_000);
});

check("a yearly billing amount is normalized to a monthly rate for MRR", () => {
  // ₱15,899 a year is ₱1,324.92 a month — MRR must not read ₱15,899.
  const { nextBilling } = ok(plan({ billAmount: "15899", cycle: "yearly" }));
  assert.strictEqual(nextBilling?.termCents, 1_589_900);
  assert.strictEqual(nextBilling?.monthlyCents, Math.round(1_589_900 / 12));
});

check("a peso-formatted billing amount is accepted", () => {
  assert.strictEqual(ok(plan({ billAmount: "₱1,499.00" })).nextBilling?.termCents, 149_900);
});

check("a junk billing amount is refused rather than silently dropped", () => {
  assert.match(errorOf(plan({ billAmount: "wala pa" })), /charge|bill/i);
});

check("a zero billing amount is refused", () => {
  assert.match(errorOf(plan({ billAmount: "0" })), /charge|bill/i);
});

check("billing the next term does not change what was received this time", () => {
  const { payment, nextBilling } = ok(plan({ amount: "1499", billAmount: "1590" }));
  assert.strictEqual(payment.amountCents, 149_900);
  assert.strictEqual(nextBilling?.termCents, 159_000);
});

// ──────────────────────────────── undoing it ────────────────────────────────
console.log("\nplanSettlementReversal");

/** The window as it stands after a mark-paid rolled it forward. */
const ROLLED = { subscriptionStartsAt: "2026-08-21T00:00:00.000Z", subscriptionEndsAt: "2026-09-21T00:00:00.000Z" };

function reversal(over: { settlement?: Record<string, unknown>; tenant?: Record<string, unknown> } = {}) {
  return planSettlementReversal({
    settlement: {
      periodStartIso: "2026-07-21T00:00:00.000Z",
      periodEndIso: "2026-08-21T00:00:00.000Z",
      fromCalendar: true,
      ...over.settlement,
    },
    tenant: { ...ROLLED, ...over.tenant },
  });
}

check("undoing restores the term the payment covered", () => {
  const { restore } = ok(reversal());
  assert.ok(restore, "expected the window to roll back");
  assert.strictEqual(restore.startsAt.toISOString(), "2026-07-21T00:00:00.000Z");
  assert.strictEqual(restore.endsAt.toISOString(), "2026-08-21T00:00:00.000Z");
});

check("a tenant-filed payment cannot be undone from the calendar", () => {
  assert.match(errorOf(reversal({ settlement: { fromCalendar: false } })), /tenant/i);
});

check("a window the operator has since moved is left alone", () => {
  // The current window no longer starts where this payment's term ended, so
  // something else set it — rolling back would clobber the operator's edit.
  const moved = { subscriptionStartsAt: "2026-10-01T00:00:00.000Z", subscriptionEndsAt: "2026-11-01T00:00:00.000Z" };
  assert.strictEqual(ok(reversal({ tenant: moved })).restore, null);
});

check("a payment with no recorded term start cannot restore one", () => {
  assert.strictEqual(ok(reversal({ settlement: { periodStartIso: null } })).restore, null);
});

check("a payment with no recorded term end cannot restore one", () => {
  assert.strictEqual(ok(reversal({ settlement: { periodEndIso: null } })).restore, null);
});

// ───────────────────── the month's expected vs received ─────────────────────
console.log("\nmonthMoney — the header figures");

/** A due date on the grid, unpaid. */
function dueEvent(day: string, amountCents: number): CalendarEvent {
  return {
    id: `renewal:${day}`,
    kind: "renewal",
    day,
    at: `${day}T00:00:00.000Z`,
    title: "BeautyStack",
    urgency: "due_soon",
    projected: false,
    amountCents,
  };
}

/** An operator-authored billing for an off-platform client. */
function entryEvent(day: string, amountCents: number | undefined, done: boolean): CalendarEvent {
  return {
    id: `entry:${day}`,
    kind: "manual",
    day,
    at: `${day}T00:00:00.000Z`,
    title: "bbg",
    urgency: "scheduled",
    projected: false,
    amountCents,
    done,
    paid: done,
  };
}

const AUG_PREFIX = "2026-08";

check("a tenant due date counts toward what the month should bring in", () => {
  const money = monthMoney([dueEvent("2026-08-21", 149_900)], [], AUG_PREFIX);
  assert.strictEqual(money.expectedCents, 149_900);
  assert.strictEqual(money.collectedCents, 0);
});

check("an operator entry with an amount counts too — this is the gap being closed", () => {
  // "bbg", "diamond glow", "slimdose": billings that aren't platform tenants.
  const money = monthMoney([entryEvent("2026-08-08", 150_000, false)], [], AUG_PREFIX);
  assert.strictEqual(money.expectedCents, 150_000);
});

check("an entry with no amount is a reminder, and moves no money", () => {
  const money = monthMoney([entryEvent("2026-08-08", undefined, false)], [], AUG_PREFIX);
  assert.strictEqual(money.expectedCents, 0);
  assert.strictEqual(money.collectedCents, 0);
});

check("ticking an entry off collects its amount", () => {
  const money = monthMoney([entryEvent("2026-08-08", 150_000, true)], [], AUG_PREFIX);
  assert.strictEqual(money.expectedCents, 150_000);
  assert.strictEqual(money.collectedCents, 150_000);
});

check("a settled subscription counts as received on the day the money landed", () => {
  const money = monthMoney([], [{ paidDay: "2026-08-18", amountCents: 159_000 }], AUG_PREFIX);
  assert.strictEqual(money.collectedCents, 159_000);
});

check("money received this month for another month's term still counts this month", () => {
  const money = monthMoney([], [{ paidDay: "2026-08-30", amountCents: 50_000 }], AUG_PREFIX);
  assert.strictEqual(money.collectedCents, 50_000);
});

check("a payment received in another month does not count in this one", () => {
  const money = monthMoney([], [{ paidDay: "2026-07-30", amountCents: 50_000 }], AUG_PREFIX);
  assert.strictEqual(money.collectedCents, 0);
});

check("the grid's neighbouring-month cells are excluded from both figures", () => {
  // The 6x7 grid shows late July and early September; neither is this month.
  const money = monthMoney(
    [dueEvent("2026-07-30", 100_000), entryEvent("2026-09-01", 200_000, true)],
    [],
    AUG_PREFIX,
  );
  assert.strictEqual(money.expectedCents, 0);
  assert.strictEqual(money.collectedCents, 0);
});

check("tenant dues and operator billings add up together", () => {
  const money = monthMoney(
    [
      dueEvent("2026-08-21", 149_900),
      entryEvent("2026-08-08", 150_000, true),
      entryEvent("2026-08-30", 90_000, false),
    ],
    [{ paidDay: "2026-08-18", amountCents: 159_000 }],
    AUG_PREFIX,
  );
  assert.strictEqual(money.expectedCents, 149_900 + 150_000 + 90_000);
  assert.strictEqual(money.collectedCents, 150_000 + 159_000);
});

check("a settled due date is not double-counted as expected", () => {
  // The paid chip replaces the renewal it settled; only one of them is on the grid.
  const paid = settlementEvents(buildSettlementIndex([row()]).values(), NAMES, AUG);
  const money = monthMoney(paid, [{ paidDay: "2026-08-18", amountCents: 149_900 }], AUG_PREFIX);
  assert.strictEqual(money.expectedCents, 149_900);
  assert.strictEqual(money.collectedCents, 149_900);
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
