/**
 * Self-contained test for the pure "My Income" analytics core (no DB, no Next
 * runtime). Guards the platform-operator income page (/admin/income): MRR,
 * collected-vs-expected, actual-vs-projected income series, upcoming renewals,
 * per-plan MRR share, and at-risk (overdue) income excluded from projections.
 *
 *   - src/lib/admin/income-analytics.ts
 *       buildIncomeAnalytics({ tenants, payments, planConfig }, now)
 *
 * Consumed by:
 *   - getIncomeAnalytics() (src/lib/admin/income-data.ts)
 *   - the /admin/income page (IncomeView.tsx)
 *
 *   npm run test:income
 */

import assert from "node:assert";

import {
  buildIncomeAnalytics,
  type IncomeTenantInput,
  type IncomePaymentInput,
} from "../src/lib/admin/income-analytics";
import { defaultPlanConfig } from "../src/lib/platform/plan-config";

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

// ──────────────────────────────── fixtures ──────────────────────────────────
// "Now" is fixed mid-month so month/week bucketing is deterministic.
const NOW = new Date("2026-07-23T10:00:00.000Z");

const D = (iso: string) => new Date(iso);

function tenant(over: Partial<IncomeTenantInput> & { id: string; name: string }): IncomeTenantInput {
  return {
    planKey: "pro",
    status: "active",
    subscriptionPriceCents: null,
    subscriptionStartsAt: null,
    subscriptionEndsAt: null,
    subscriptionCycle: null,
    ...over,
  };
}

function payment(over: Partial<IncomePaymentInput> & { tenantId: string }): IncomePaymentInput {
  return {
    amountCents: 100_000,
    status: "confirmed",
    paidAt: null,
    submittedAt: null,
    ...over,
  };
}

const PLAN = defaultPlanConfig();
// Canonical list prices from the shipped plan config (peso cents).
const PRO = PLAN.plans.find((p) => p.key === "pro")!.priceCents;
const STARTER = PLAN.plans.find((p) => p.key === "starter")!.priceCents;

// ──────────────────────────────── MRR + KPIs ────────────────────────────────
console.log("\nMRR + KPI roll-up");

check("MRR sums active tenants only, honoring the per-tenant override (incl. a comped 0)", () => {
  const out = buildIncomeAnalytics(
    {
      tenants: [
        tenant({ id: "a", name: "Alpha" }), // plan-config pro price
        tenant({ id: "b", name: "Bravo", subscriptionPriceCents: 250_000 }), // override
        tenant({ id: "c", name: "Comped", subscriptionPriceCents: 0 }), // deliberate 0
        tenant({ id: "d", name: "Trial", status: "trial" }), // excluded
        tenant({ id: "e", name: "Suspended", status: "suspended" }), // excluded
      ],
      payments: [],
      planConfig: PLAN,
    },
    NOW,
  );
  assert.strictEqual(out.mrrCents, PRO + 250_000 + 0);
  assert.strictEqual(out.activeBilledCount, 3);
  assert.strictEqual(out.expectedThisMonthCents, out.mrrCents);
});

check("collected this month counts confirmed payments in the current UTC month only", () => {
  const out = buildIncomeAnalytics(
    {
      tenants: [tenant({ id: "a", name: "Alpha" })],
      payments: [
        payment({ tenantId: "a", amountCents: 150_000, paidAt: D("2026-07-05T00:00:00Z") }),
        payment({ tenantId: "a", amountCents: 40_000, paidAt: D("2026-06-28T00:00:00Z") }), // last month
        payment({ tenantId: "a", amountCents: 999_999, status: "pending", paidAt: D("2026-07-10T00:00:00Z") }),
        payment({ tenantId: "a", amountCents: 999_999, status: "failed", paidAt: D("2026-07-11T00:00:00Z") }),
      ],
      planConfig: PLAN,
    },
    NOW,
  );
  assert.strictEqual(out.collectedThisMonthCents, 150_000);
  assert.strictEqual(out.paidTenantCountThisMonth, 1);
});

check("collectedPct is collected/expected, 0 when nothing is expected (no NaN)", () => {
  const some = buildIncomeAnalytics(
    {
      tenants: [tenant({ id: "a", name: "Alpha", subscriptionPriceCents: 200_000 })],
      payments: [payment({ tenantId: "a", amountCents: 100_000, paidAt: D("2026-07-05T00:00:00Z") })],
      planConfig: PLAN,
    },
    NOW,
  );
  assert.strictEqual(some.collectedPct, 50);
  const empty = buildIncomeAnalytics({ tenants: [], payments: [], planConfig: PLAN }, NOW);
  assert.strictEqual(empty.collectedPct, 0);
  assert.ok(Number.isFinite(empty.collectedPct));
});

// ─────────────────────────── income series (chart) ──────────────────────────
console.log("\nActual income series");

check("monthly series buckets confirmed payments by UTC month, paidAt falling back to submittedAt", () => {
  const out = buildIncomeAnalytics(
    {
      tenants: [],
      payments: [
        payment({ tenantId: "a", amountCents: 10_000, paidAt: D("2026-02-10T00:00:00Z") }),
        payment({ tenantId: "a", amountCents: 20_000, paidAt: null, submittedAt: D("2026-02-20T00:00:00Z") }),
        payment({ tenantId: "a", amountCents: 30_000, paidAt: D("2026-07-01T00:00:00Z") }),
        payment({ tenantId: "a", amountCents: 5_000, status: "pending", paidAt: D("2026-07-02T00:00:00Z") }), // not income
        payment({ tenantId: "a", amountCents: 7_000, paidAt: D("2025-12-01T00:00:00Z") }), // before window
      ],
      planConfig: PLAN,
    },
    NOW,
  );
  // Last 6 UTC months ending at the current month: Feb..Jul 2026.
  assert.deepStrictEqual(out.monthly.labels, ["Feb", "Mar", "Apr", "May", "Jun", "Jul"]);
  assert.deepStrictEqual(out.monthly.actualCents, [30_000, 0, 0, 0, 0, 30_000]);
});

check("weekly series uses six 7-day buckets ending today, oldest first", () => {
  const out = buildIncomeAnalytics(
    {
      tenants: [],
      payments: [
        // Now is Jul 23; buckets span Jun 11 → Jul 23. A payment 3 days ago is
        // in the last bucket; Jun 1 falls before the first bucket.
        payment({ tenantId: "a", amountCents: 11_000, paidAt: D("2026-07-20T00:00:00Z") }),
        payment({ tenantId: "a", amountCents: 22_000, paidAt: D("2026-06-13T00:00:00Z") }),
        payment({ tenantId: "a", amountCents: 33_000, paidAt: D("2026-06-01T00:00:00Z") }), // too old
      ],
      planConfig: PLAN,
    },
    NOW,
  );
  assert.strictEqual(out.weekly.labels.length, 6);
  assert.strictEqual(out.weekly.actualCents.length, 6);
  assert.strictEqual(out.weekly.actualCents[5], 11_000);
  assert.strictEqual(out.weekly.actualCents[0], 22_000);
  assert.strictEqual(out.weekly.actualCents.reduce((a, b) => a + b, 0), 33_000);
});

check("projections are flat MRR minus at-risk, monthly and weekly-ized, never negative", () => {
  const out = buildIncomeAnalytics(
    {
      tenants: [
        tenant({ id: "a", name: "Alpha", subscriptionPriceCents: 300_000 }),
        // Overdue window → at-risk; excluded from projections.
        tenant({
          id: "b",
          name: "Bravo",
          subscriptionPriceCents: 100_000,
          subscriptionStartsAt: D("2026-06-01T00:00:00Z"),
          subscriptionEndsAt: D("2026-07-01T00:00:00Z"),
        }),
      ],
      payments: [],
      planConfig: PLAN,
    },
    NOW,
  );
  assert.strictEqual(out.atRiskMonthlyCents, 100_000);
  assert.strictEqual(out.projectedMonthlyCents, 300_000);
  assert.deepStrictEqual(out.monthly.projectedCents, [300_000, 300_000, 300_000]);
  assert.strictEqual(out.projectedNext3moCents, 900_000);
  assert.strictEqual(out.weekly.projectedCents.length, 4);
  assert.strictEqual(out.weekly.projectedCents[0], Math.round((300_000 * 12) / 52));
});

check("month-over-month delta compares the last two FULL months; null when there is no base", () => {
  const out = buildIncomeAnalytics(
    {
      tenants: [],
      payments: [
        payment({ tenantId: "a", amountCents: 110_000, paidAt: D("2026-06-15T00:00:00Z") }),
        payment({ tenantId: "a", amountCents: 100_000, paidAt: D("2026-05-15T00:00:00Z") }),
      ],
      planConfig: PLAN,
    },
    NOW,
  );
  assert.strictEqual(out.momDeltaPct, 10);
  const bare = buildIncomeAnalytics({ tenants: [], payments: [], planConfig: PLAN }, NOW);
  assert.strictEqual(bare.momDeltaPct, null);
});

// ───────────────────────────── upcoming renewals ────────────────────────────
console.log("\nUpcoming renewals");

check("upcoming renewals are windowed tenants sorted soonest-first with urgency statuses", () => {
  const out = buildIncomeAnalytics(
    {
      tenants: [
        tenant({
          id: "late",
          name: "Late Store",
          subscriptionEndsAt: D("2026-07-20T00:00:00Z"), // 3 days overdue
        }),
        tenant({
          id: "soon",
          name: "Soon Store",
          subscriptionEndsAt: D("2026-07-26T00:00:00Z"), // due in 3 days
        }),
        tenant({
          id: "later",
          name: "Later Store",
          subscriptionEndsAt: D("2026-09-15T00:00:00Z"), // beyond 30 days
        }),
        tenant({ id: "none", name: "No Window" }), // no endsAt → not listed
      ],
      payments: [],
      planConfig: PLAN,
    },
    NOW,
  );
  assert.deepStrictEqual(
    out.upcoming.map((u) => u.tenantId),
    ["late", "soon", "later"],
  );
  assert.strictEqual(out.upcoming[0].urgency, "overdue");
  assert.strictEqual(out.upcoming[1].urgency, "due_soon");
  assert.strictEqual(out.upcoming[2].urgency, "scheduled");
  assert.strictEqual(out.upcoming[1].initials, "SS");
  assert.strictEqual(out.upcoming[1].planLabel, "Pro");
  assert.strictEqual(out.upcoming[1].monthlyCents, PRO);
  // 30-day roll-up excludes the September renewal.
  assert.strictEqual(out.upcoming30dCount, 2);
  assert.strictEqual(out.upcoming30dTotalCents, PRO * 2);
});

check("expected this week counts renewals due within 7 days (not overdue, not later)", () => {
  const out = buildIncomeAnalytics(
    {
      tenants: [
        tenant({ id: "soon", name: "Soon", subscriptionPriceCents: 120_000, subscriptionEndsAt: D("2026-07-26T00:00:00Z") }),
        tenant({ id: "late", name: "Late", subscriptionEndsAt: D("2026-07-20T00:00:00Z") }),
        tenant({ id: "far", name: "Far", subscriptionEndsAt: D("2026-08-20T00:00:00Z") }),
      ],
      payments: [],
      planConfig: PLAN,
    },
    NOW,
  );
  assert.strictEqual(out.expectedThisWeekCents, 120_000);
  assert.strictEqual(out.renewalsThisWeekCount, 1);
});

// ───────────────────────── plan breakdown + at-risk ─────────────────────────
console.log("\nPlan breakdown + at-risk");

check("plan breakdown splits MRR across canonical tiers with pct of MRR and bar pct of max", () => {
  const out = buildIncomeAnalytics(
    {
      tenants: [
        tenant({ id: "a", name: "A", planKey: "pro" }),
        tenant({ id: "b", name: "B", planKey: "pro" }),
        tenant({ id: "c", name: "C", planKey: "starter" }),
        tenant({ id: "t", name: "T", planKey: "pro", status: "trial" }), // excluded
      ],
      payments: [],
      planConfig: PLAN,
    },
    NOW,
  );
  const pro = out.planBreakdown.find((p) => p.key === "pro")!;
  const starter = out.planBreakdown.find((p) => p.key === "starter")!;
  assert.strictEqual(pro.tenantCount, 2);
  assert.strictEqual(pro.mrrCents, PRO * 2);
  assert.strictEqual(starter.mrrCents, STARTER);
  assert.strictEqual(pro.barPct, 100); // largest tier fills its bar
  const total = PRO * 2 + STARTER;
  assert.strictEqual(pro.pctOfMrr, Math.round(((PRO * 2) / total) * 100));
  // Zero-MRR tiers are dropped rather than rendering empty bars.
  assert.ok(!out.planBreakdown.some((p) => p.mrrCents === 0));
});

check("at-risk lists overdue tenants with days-overdue note and their monthly fee", () => {
  const out = buildIncomeAnalytics(
    {
      tenants: [
        tenant({
          id: "late",
          name: "Late Store",
          subscriptionPriceCents: 90_000,
          subscriptionEndsAt: D("2026-07-17T00:00:00Z"), // 6 days overdue
        }),
        tenant({ id: "ok", name: "Fine Store", subscriptionEndsAt: D("2026-08-30T00:00:00Z") }),
      ],
      payments: [],
      planConfig: PLAN,
    },
    NOW,
  );
  assert.strictEqual(out.atRisk.length, 1);
  assert.strictEqual(out.atRisk[0].name, "Late Store");
  assert.strictEqual(out.atRisk[0].monthlyCents, 90_000);
  assert.ok(out.atRisk[0].note.includes("6 day"));
  assert.strictEqual(out.atRiskMonthlyCents, 90_000);
});

check("empty inputs produce an all-zero, JSON-safe result (no NaN, no crash)", () => {
  const out = buildIncomeAnalytics({ tenants: [], payments: [], planConfig: PLAN }, NOW);
  assert.strictEqual(out.mrrCents, 0);
  assert.strictEqual(out.projectedNext3moCents, 0);
  assert.deepStrictEqual(out.upcoming, []);
  assert.deepStrictEqual(out.atRisk, []);
  assert.deepStrictEqual(out.planBreakdown, []);
  assert.strictEqual(out.monthly.actualCents.length, 6);
  assert.ok(out.monthly.actualCents.every((v) => v === 0));
  // Everything must survive the server→client JSON boundary.
  const json = JSON.parse(JSON.stringify(out));
  assert.deepStrictEqual(json, out);
});

// ────────────────────────────────── result ──────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
