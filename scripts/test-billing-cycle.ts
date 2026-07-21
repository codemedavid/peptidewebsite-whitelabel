/**
 * Self-contained test for the pure billing-cycle core (no DB, no Next runtime).
 * Guards the calendar arithmetic that turns an operator-chosen subscription type
 * (monthly | quarterly | semi_annual | yearly) + a start date into an
 * auto-calculated due date — the value the Super Admin tenant-detail setter
 * pre-fills and the operator may then override.
 *
 * Sibling of test:subscription-state. Where subscription-state computes the
 * countdown FROM a concrete start/end window, this computes the DEFAULT end
 * (due) date from a cycle so the window can be created in the first place.
 *
 *   - src/lib/subscription/billing-cycle.ts
 *       addBillingCycle(start, cycle) — start + N calendar months (12 for
 *       yearly), with end-of-month/leap-day clamping. Immutable: never mutates
 *       the input Date. BILLING_CYCLES / BILLING_CYCLE_LABELS / isBillingCycle.
 *
 *   npm run test:billing-cycle
 */

import assert from "node:assert";

import {
  addBillingCycle,
  BILLING_CYCLES,
  BILLING_CYCLE_LABELS,
  BILLING_CYCLE_MONTHS,
  isBillingCycle,
  type BillingCycle,
} from "../src/lib/subscription/billing-cycle";

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

/** UTC "YYYY-MM-DD" of a Date, for legible assertions on the due date. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

console.log("\nBilling cycle — pure core\n");

// ─────────────────────────── cycle catalogue ────────────────────────────────
check("BILLING_CYCLES lists all four cycles in expansion order", () => {
  assert.deepStrictEqual(BILLING_CYCLES, ["monthly", "quarterly", "semi_annual", "yearly"]);
});

check("every cycle has a human label", () => {
  assert.strictEqual(BILLING_CYCLE_LABELS.monthly, "Monthly");
  assert.strictEqual(BILLING_CYCLE_LABELS.quarterly, "Quarterly");
  assert.strictEqual(BILLING_CYCLE_LABELS.semi_annual, "Semi-annual");
  assert.strictEqual(BILLING_CYCLE_LABELS.yearly, "Yearly");
});

check("every cycle maps to its month count (not hardcoded day math)", () => {
  assert.strictEqual(BILLING_CYCLE_MONTHS.monthly, 1);
  assert.strictEqual(BILLING_CYCLE_MONTHS.quarterly, 3);
  assert.strictEqual(BILLING_CYCLE_MONTHS.semi_annual, 6);
  assert.strictEqual(BILLING_CYCLE_MONTHS.yearly, 12);
});

// ─────────────────────────── straightforward terms ──────────────────────────
check("monthly: 2026-01-15 → 2026-02-15", () => {
  assert.strictEqual(ymd(addBillingCycle(new Date("2026-01-15T00:00:00.000Z"), "monthly")), "2026-02-15");
});

check("quarterly: 2026-01-15 → 2026-04-15", () => {
  assert.strictEqual(ymd(addBillingCycle(new Date("2026-01-15T00:00:00.000Z"), "quarterly")), "2026-04-15");
});

check("semi_annual: 2026-01-15 → 2026-07-15", () => {
  assert.strictEqual(ymd(addBillingCycle(new Date("2026-01-15T00:00:00.000Z"), "semi_annual")), "2026-07-15");
});

check("yearly: 2026-01-15 → 2027-01-15 (exactly one calendar year)", () => {
  assert.strictEqual(ymd(addBillingCycle(new Date("2026-01-15T00:00:00.000Z"), "yearly")), "2027-01-15");
});

// ─────────────────────────── year rollover ──────────────────────────────────
check("monthly across December: 2026-12-15 → 2027-01-15", () => {
  assert.strictEqual(ymd(addBillingCycle(new Date("2026-12-15T00:00:00.000Z"), "monthly")), "2027-01-15");
});

check("quarterly across year end: 2026-11-15 → 2027-02-15", () => {
  assert.strictEqual(ymd(addBillingCycle(new Date("2026-11-15T00:00:00.000Z"), "quarterly")), "2027-02-15");
});

// ─────────────────────────── month-overflow clamping ────────────────────────
check("monthly from Jan 31 clamps into February (2026-01-31 → 2026-02-28)", () => {
  assert.strictEqual(ymd(addBillingCycle(new Date("2026-01-31T00:00:00.000Z"), "monthly")), "2026-02-28");
});

check("quarterly Nov 30 → Feb 28 (target month has fewer days)", () => {
  assert.strictEqual(ymd(addBillingCycle(new Date("2026-11-30T00:00:00.000Z"), "quarterly")), "2027-02-28");
});

check("yearly from a leap day clamps to Feb 28 (2024-02-29 → 2025-02-28)", () => {
  assert.strictEqual(ymd(addBillingCycle(new Date("2024-02-29T00:00:00.000Z"), "yearly")), "2025-02-28");
});

check("yearly into a leap year keeps the day (2023-02-28 → 2024-02-28)", () => {
  assert.strictEqual(ymd(addBillingCycle(new Date("2023-02-28T00:00:00.000Z"), "yearly")), "2024-02-28");
});

check("monthly from Jan 31 into a leap February (2024-01-31 → 2024-02-29)", () => {
  assert.strictEqual(ymd(addBillingCycle(new Date("2024-01-31T00:00:00.000Z"), "monthly")), "2024-02-29");
});

// ─────────────────────────── time-of-day + immutability ─────────────────────
check("preserves the time-of-day of the start instant", () => {
  const due = addBillingCycle(new Date("2026-01-15T09:30:00.000Z"), "yearly");
  assert.strictEqual(due.toISOString(), "2027-01-15T09:30:00.000Z");
});

check("does not mutate the input Date (immutable)", () => {
  const start = new Date("2026-01-15T00:00:00.000Z");
  const before = start.getTime();
  addBillingCycle(start, "yearly");
  assert.strictEqual(start.getTime(), before, "start Date must be untouched");
});

check("the computed due date is always strictly after the start", () => {
  for (const cycle of BILLING_CYCLES) {
    const start = new Date("2026-02-28T00:00:00.000Z");
    assert.ok(
      addBillingCycle(start, cycle).getTime() > start.getTime(),
      `${cycle}: due must be after start`,
    );
  }
});

// ─────────────────────────── input guard ────────────────────────────────────
check("isBillingCycle accepts the four known cycles", () => {
  for (const cycle of BILLING_CYCLES) assert.strictEqual(isBillingCycle(cycle), true);
});

check("isBillingCycle rejects unknown / empty / non-string values", () => {
  const rejected: unknown[] = ["annual", "weekly", "", "Yearly", null, undefined, 12];
  for (const value of rejected) {
    assert.strictEqual(isBillingCycle(value), false, `expected ${String(value)} rejected`);
  }
});

check("isBillingCycle narrows an unknown to BillingCycle for safe use", () => {
  const raw: unknown = "yearly";
  if (isBillingCycle(raw)) {
    const cycle: BillingCycle = raw; // must compile — proves the type guard narrows
    assert.strictEqual(BILLING_CYCLE_MONTHS[cycle], 12);
  } else {
    assert.fail("expected 'yearly' to be recognised");
  }
});

// ──────────────────────────────────── summary ───────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
