// Pure aggregation for the Super Admin "My Income" page (/admin/income).
// No fs/prisma/Next imports — testable in isolation (npm run test:income).
//
// The page shows the OPERATOR's subscription earnings from tenant billing:
//   - MRR           = Σ effectivePlanFeeCents over ACTIVE tenants (same rule as
//                     the dashboard MRR, so the two figures agree by construction)
//   - actual income = confirmed SubscriptionPayment amounts (the proof-of-payment
//                     ledger), bucketed by UTC month or 7-day week
//   - projections   = flat (MRR − at-risk MRR) per future period; at-risk =
//                     tenants whose subscription window has lapsed (overdue), so
//                     projections exclude income that may not materialize
//   - upcoming      = tenants with an operator-set window, soonest renewal first,
//                     classified through subscriptionUrgency (overdue/due_soon/ok)
//
// Everything returned is JSON-safe (ISO strings, integers) so it can cross the
// server→client boundary into the IncomeView client component untouched.

import { planMeta } from "@/lib/admin/plans";
import { planConfigPriceCents, type PlanConfig } from "@/lib/platform/plan-config";
import { effectivePlanFeeCents } from "@/lib/subscription/plan-fee";
import { subscriptionUrgency, NEAR_DUE_DAYS } from "@/lib/subscription/near-due";

const DAY_MS = 86_400_000;
const MONTHS_SHOWN = 6; // historical months on the chart
const WEEKS_SHOWN = 6; // historical 7-day buckets on the chart
const PROJECTED_MONTHS = 3;
const PROJECTED_WEEKS = 4;
const UPCOMING_HORIZON_DAYS = 30;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Tenant fields the income page needs (subset of the Tenant row / demo tenant). */
export type IncomeTenantInput = {
  id: string;
  name: string;
  planKey: string;
  status: string;
  /** Operator-set per-tenant monthly price override, centavos (0 = comped). */
  subscriptionPriceCents?: number | null;
  subscriptionStartsAt?: Date | string | null;
  subscriptionEndsAt?: Date | string | null;
  subscriptionCycle?: string | null;
};

/** SubscriptionPayment ledger row (untrusted status — narrowed here). */
export type IncomePaymentInput = {
  tenantId: string;
  amountCents: number;
  status: string;
  paidAt?: Date | string | null;
  submittedAt?: Date | string | null;
};

export type IncomeSeries = {
  /** Historical bucket labels, oldest first (e.g. "Feb" or "Jun 13"). */
  labels: string[];
  /** Confirmed income per historical bucket, centavos. */
  actualCents: number[];
  /** Future bucket labels continuing the axis. */
  projectedLabels: string[];
  /** Flat projection per future bucket, centavos. */
  projectedCents: number[];
};

export type UpcomingRenewal = {
  tenantId: string;
  name: string;
  slug?: string;
  initials: string;
  planLabel: string;
  /** Effective monthly fee, centavos (per-tenant override or plan list price). */
  monthlyCents: number;
  cycle: string | null;
  /** Window end (renewal due date), ISO. */
  renewsIso: string;
  urgency: "overdue" | "due_soon" | "scheduled";
};

export type PlanIncomeRow = {
  key: string;
  label: string;
  tenantCount: number;
  mrrCents: number;
  /** Share of total MRR, whole percent. */
  pctOfMrr: number;
  /** Bar width relative to the largest tier (largest = 100). */
  barPct: number;
};

export type AtRiskRow = {
  tenantId: string;
  name: string;
  monthlyCents: number;
  /** Human note, e.g. "Payment overdue 6 days". */
  note: string;
};

export type IncomeAnalytics = {
  mrrCents: number;
  activeBilledCount: number;
  expectedThisMonthCents: number;
  expectedThisWeekCents: number;
  renewalsThisWeekCount: number;
  collectedThisMonthCents: number;
  /** Distinct tenants with a confirmed payment this month. */
  paidTenantCountThisMonth: number;
  /** collected ÷ expected, whole percent (0 when nothing expected). */
  collectedPct: number;
  /** Last full month's confirmed income vs the month before, whole percent
   *  (null when there's no non-zero base month to compare against). */
  momDeltaPct: number | null;
  projectedMonthlyCents: number;
  projectedNext3moCents: number;
  atRiskMonthlyCents: number;
  monthly: IncomeSeries;
  weekly: IncomeSeries;
  upcoming: UpcomingRenewal[];
  upcoming30dCount: number;
  upcoming30dTotalCents: number;
  planBreakdown: PlanIncomeRow[];
  atRisk: AtRiskRow[];
};

export type IncomeAnalyticsInput = {
  tenants: readonly IncomeTenantInput[];
  payments: readonly IncomePaymentInput[];
  planConfig: PlanConfig;
};

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The date a payment counts on: paidAt, falling back to submittedAt. */
function paymentDate(p: IncomePaymentInput): Date | null {
  return toValidDate(p.paidAt) ?? toValidDate(p.submittedAt);
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]!.toUpperCase());
  return letters.join("") || "?";
}

function monthlyFeeOf(t: IncomeTenantInput, planConfig: PlanConfig): number {
  return effectivePlanFeeCents(t.subscriptionPriceCents, planConfigPriceCents(planConfig, t.planKey));
}

/** Confirmed income summed per UTC calendar month, oldest first, ending at the
 *  current month. Returns labels + values (parallel arrays). */
function monthlyActuals(
  payments: readonly IncomePaymentInput[],
  now: Date,
): { labels: string[]; values: number[] } {
  const labels: string[] = [];
  const keys: string[] = [];
  for (let i = MONTHS_SHOWN - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    labels.push(MONTH_SHORT[d.getUTCMonth()]);
    keys.push(`${d.getUTCFullYear()}-${d.getUTCMonth()}`);
  }
  const sums = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const p of payments) {
    if (p.status !== "confirmed") continue;
    const date = paymentDate(p);
    if (!date) continue;
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    const cur = sums.get(key);
    if (cur !== undefined) sums.set(key, cur + p.amountCents);
  }
  return { labels, values: keys.map((k) => sums.get(k) ?? 0) };
}

/** Confirmed income summed per trailing 7-day bucket ending at `now`, oldest
 *  first. Labels are the bucket-start day ("Jun 13"). */
function weeklyActuals(
  payments: readonly IncomePaymentInput[],
  now: Date,
): { labels: string[]; values: number[] } {
  const end = now.getTime();
  const start = end - WEEKS_SHOWN * 7 * DAY_MS;
  const values = new Array<number>(WEEKS_SHOWN).fill(0);
  const labels: string[] = [];
  for (let i = 0; i < WEEKS_SHOWN; i++) {
    const bucketStart = new Date(start + i * 7 * DAY_MS);
    labels.push(`${MONTH_SHORT[bucketStart.getUTCMonth()]} ${bucketStart.getUTCDate()}`);
  }
  for (const p of payments) {
    if (p.status !== "confirmed") continue;
    const date = paymentDate(p);
    if (!date) continue;
    const t = date.getTime();
    if (t < start || t > end) continue;
    const idx = Math.min(WEEKS_SHOWN - 1, Math.floor((t - start) / (7 * DAY_MS)));
    values[idx] += p.amountCents;
  }
  return { labels, values };
}

/** Future-period labels continuing the monthly axis ("Aug", "Sep", …). */
function futureMonthLabels(now: Date): string[] {
  const labels: string[] = [];
  for (let i = 1; i <= PROJECTED_MONTHS; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    labels.push(MONTH_SHORT[d.getUTCMonth()]);
  }
  return labels;
}

/** Future-period labels continuing the weekly axis ("Jul 30", "Aug 6", …). */
function futureWeekLabels(now: Date): string[] {
  const labels: string[] = [];
  for (let i = 1; i <= PROJECTED_WEEKS; i++) {
    const d = new Date(now.getTime() + i * 7 * DAY_MS);
    labels.push(`${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`);
  }
  return labels;
}

/** Roll the operator's income analytics up from tenants + the payment ledger.
 *  Pure: caller supplies `now`, so results are deterministic and testable. */
export function buildIncomeAnalytics(input: IncomeAnalyticsInput, now: Date): IncomeAnalytics {
  const { tenants, payments, planConfig } = input;

  // ── MRR over active tenants (per-tenant override wins; 0 = comped) ─────────
  const active = tenants.filter((t) => t.status === "active");
  const mrrCents = active.reduce((s, t) => s + monthlyFeeOf(t, planConfig), 0);

  // ── upcoming renewals + urgency (windowed tenants only, soonest first) ─────
  const windowed = active
    .map((t) => {
      const endsAt = toValidDate(t.subscriptionEndsAt);
      if (!endsAt) return null;
      const u = subscriptionUrgency(
        {
          status: t.status,
          subscriptionStartsAt: t.subscriptionStartsAt ?? null,
          subscriptionEndsAt: t.subscriptionEndsAt ?? null,
        },
        now,
      );
      const urgency: UpcomingRenewal["urgency"] =
        u.level === "ok" ? "scheduled" : u.level === "overdue" ? "overdue" : "due_soon";
      return {
        tenantId: t.id,
        name: t.name,
        initials: initialsOf(t.name),
        planLabel: planMeta(t.planKey).label,
        monthlyCents: monthlyFeeOf(t, planConfig),
        cycle: t.subscriptionCycle ?? null,
        renewsIso: endsAt.toISOString(),
        urgency,
      } satisfies UpcomingRenewal;
    })
    .filter((u): u is UpcomingRenewal => u !== null)
    .sort((a, b) => a.renewsIso.localeCompare(b.renewsIso));

  const horizonMs = now.getTime() + UPCOMING_HORIZON_DAYS * DAY_MS;
  const within30d = windowed.filter((u) => new Date(u.renewsIso).getTime() <= horizonMs);
  const weekMs = now.getTime() + NEAR_DUE_DAYS * DAY_MS;
  const dueThisWeek = windowed.filter((u) => {
    const t = new Date(u.renewsIso).getTime();
    return t > now.getTime() && t <= weekMs;
  });

  // ── at-risk: overdue windows, excluded from projections ────────────────────
  const atRisk: AtRiskRow[] = windowed
    .filter((u) => u.urgency === "overdue")
    .map((u) => {
      const daysOver = Math.max(1, Math.floor((now.getTime() - new Date(u.renewsIso).getTime()) / DAY_MS));
      return {
        tenantId: u.tenantId,
        name: u.name,
        monthlyCents: u.monthlyCents,
        note: `Payment overdue ${daysOver} day${daysOver === 1 ? "" : "s"}`,
      };
    });
  const atRiskMonthlyCents = atRisk.reduce((s, r) => s + r.monthlyCents, 0);
  const projectedMonthlyCents = Math.max(0, mrrCents - atRiskMonthlyCents);
  const projectedWeeklyCents = Math.round((projectedMonthlyCents * 12) / 52);

  // ── collected vs expected (current UTC month) ──────────────────────────────
  const monthKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}`;
  let collectedThisMonthCents = 0;
  const paidTenants = new Set<string>();
  for (const p of payments) {
    if (p.status !== "confirmed") continue;
    const date = paymentDate(p);
    if (!date || `${date.getUTCFullYear()}-${date.getUTCMonth()}` !== monthKey) continue;
    collectedThisMonthCents += p.amountCents;
    paidTenants.add(p.tenantId);
  }
  const collectedPct =
    mrrCents > 0 ? Math.round((collectedThisMonthCents / mrrCents) * 100) : 0;

  // ── chart series ───────────────────────────────────────────────────────────
  const monthlyHist = monthlyActuals(payments, now);
  const weeklyHist = weeklyActuals(payments, now);
  const monthly: IncomeSeries = {
    labels: monthlyHist.labels,
    actualCents: monthlyHist.values,
    projectedLabels: futureMonthLabels(now),
    projectedCents: new Array<number>(PROJECTED_MONTHS).fill(projectedMonthlyCents),
  };
  const weekly: IncomeSeries = {
    labels: weeklyHist.labels,
    actualCents: weeklyHist.values,
    projectedLabels: futureWeekLabels(now),
    projectedCents: new Array<number>(PROJECTED_WEEKS).fill(projectedWeeklyCents),
  };

  // ── month-over-month delta from the last two FULL months ──────────────────
  const lastFull = monthlyHist.values[monthlyHist.values.length - 2] ?? 0;
  const priorFull = monthlyHist.values[monthlyHist.values.length - 3] ?? 0;
  const momDeltaPct = priorFull > 0 ? Math.round(((lastFull - priorFull) / priorFull) * 100) : null;

  // ── MRR share per canonical plan tier (zero-MRR tiers dropped) ─────────────
  const byPlan = new Map<string, { label: string; tenantCount: number; mrrCents: number }>();
  for (const t of active) {
    const pm = planMeta(t.planKey);
    const cur = byPlan.get(pm.key) ?? { label: pm.label, tenantCount: 0, mrrCents: 0 };
    byPlan.set(pm.key, {
      label: cur.label,
      tenantCount: cur.tenantCount + 1,
      mrrCents: cur.mrrCents + monthlyFeeOf(t, planConfig),
    });
  }
  const nonZero = [...byPlan.entries()].filter(([, v]) => v.mrrCents > 0);
  const maxPlanMrr = nonZero.reduce((m, [, v]) => Math.max(m, v.mrrCents), 0);
  const planBreakdown: PlanIncomeRow[] = nonZero
    .map(([key, v]) => ({
      key,
      label: v.label,
      tenantCount: v.tenantCount,
      mrrCents: v.mrrCents,
      pctOfMrr: mrrCents > 0 ? Math.round((v.mrrCents / mrrCents) * 100) : 0,
      barPct: maxPlanMrr > 0 ? Math.round((v.mrrCents / maxPlanMrr) * 100) : 0,
    }))
    .sort((a, b) => b.mrrCents - a.mrrCents);

  return {
    mrrCents,
    activeBilledCount: active.length,
    expectedThisMonthCents: mrrCents,
    expectedThisWeekCents: dueThisWeek.reduce((s, u) => s + u.monthlyCents, 0),
    renewalsThisWeekCount: dueThisWeek.length,
    collectedThisMonthCents,
    paidTenantCountThisMonth: paidTenants.size,
    collectedPct,
    momDeltaPct,
    projectedMonthlyCents,
    projectedNext3moCents: projectedMonthlyCents * PROJECTED_MONTHS,
    atRiskMonthlyCents,
    monthly,
    weekly,
    upcoming: windowed,
    upcoming30dCount: within30d.length,
    upcoming30dTotalCents: within30d.reduce((s, u) => s + u.monthlyCents, 0),
    planBreakdown,
    atRisk,
  };
}
