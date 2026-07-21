/**
 * Pure billing-cycle math — turns an operator-chosen subscription type and a
 * start date into an auto-calculated due (end) date. This is the "create the
 * window" half of the subscription feature; subscription-state.ts is the "read
 * the window" half (the countdown rendered once start/end exist).
 *
 * The due date is start + N *calendar* months (12 for yearly) — never a
 * hardcoded 30-day increment — so a Yearly subscription lands on the same
 * calendar day one year on, and shorter months clamp cleanly (Jan 31 + 1 month
 * → Feb 28/29, Feb 29 + 1 year → Feb 28). The operator can still override the
 * result: this only supplies the default the setter pre-fills.
 *
 * Client-safe and side-effect free (never mutates its input Date), so the
 * tenant-detail setter can call it live as the operator changes the cycle or
 * start date, and it stays deterministically testable (npm run test:billing-cycle).
 */

/** Subscription billing cycles, in expansion order (shortest → longest). */
export const BILLING_CYCLES = ["monthly", "quarterly", "semi_annual", "yearly"] as const;

export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** Human-facing label for each cycle (tenant detail, banner, setter dropdown). */
export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  semi_annual: "Semi-annual",
  yearly: "Yearly",
};

/** Calendar-month length of each cycle — the increment `addBillingCycle` adds. */
export const BILLING_CYCLE_MONTHS: Record<BillingCycle, number> = {
  monthly: 1,
  quarterly: 3,
  semi_annual: 6,
  yearly: 12,
};

/** Narrow untrusted input (form value, brand JSON) to a known BillingCycle. */
export function isBillingCycle(value: unknown): value is BillingCycle {
  return typeof value === "string" && (BILLING_CYCLES as readonly string[]).includes(value);
}

/** Days in the given UTC month (0-based month, e.g. 1 = February). */
function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * `start` advanced by `months` calendar months, in UTC, with end-of-month
 * clamping: if the target month is shorter than the start day (Jan 31 + 1 →
 * Feb 28/29), the day is pulled back to the target month's last day rather than
 * overflowing into the following month. Time-of-day is preserved. Never mutates
 * the input.
 */
function addUtcMonths(start: Date, months: number): Date {
  const result = new Date(start.getTime());
  const startDay = result.getUTCDate();
  // Move to the 1st first so setUTCMonth can't overflow (e.g. Jan 31 → Mar 3).
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const cappedDay = Math.min(startDay, daysInUtcMonth(result.getUTCFullYear(), result.getUTCMonth()));
  result.setUTCDate(cappedDay);
  return result;
}

/**
 * The default due (end) date for a subscription starting at `start` on the
 * given `cycle` — one calendar term later. Returns a fresh Date; `start` is
 * untouched.
 */
export function addBillingCycle(start: Date, cycle: BillingCycle): Date {
  return addUtcMonths(start, BILLING_CYCLE_MONTHS[cycle]);
}
