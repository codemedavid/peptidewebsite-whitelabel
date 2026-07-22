# TDD Evidence — "My Income" analytics page (/admin/income)

**Source plan:** no `*.plan.md` — journeys derived during this TDD run from the
Claude Design import (`Income Analytics.dc.html`, project
`2168418a-142c-4eb0-9282-d3af8a77d3bc`) mapped onto the platform's real billing
features.

## User journeys

1. Operator sees MRR, expected, collected and projected income KPIs from real tenant billing.
2. Operator toggles the income chart between weekly and monthly actual-vs-projected.
3. Operator sees upcoming renewals (plan, monthly amount, renewal date, urgency) plus a 30-day roll-up.
4. Operator sees MRR share per plan tier.
5. Operator sees at-risk (overdue) income, excluded from projections.
6. Operator exports upcoming renewals as CSV.

## Design → data mapping

| Design element | Real source |
|---|---|
| MRR KPI | Σ `effectivePlanFeeCents` over active tenants (agrees with dashboard MRR by construction) |
| Expected this month / week | MRR / renewals due ≤ `NEAR_DUE_DAYS` |
| Collected this month | confirmed `SubscriptionPayment` rows in the current UTC month |
| Actual income chart | confirmed ledger bucketed by UTC month / trailing 7-day weeks (`paidAt` → `submittedAt` fallback) |
| Projections | flat (MRR − at-risk MRR) per future period — at-risk excluded |
| Upcoming payments table | tenants with `subscriptionEndsAt`, soonest first, `subscriptionUrgency` badges |
| Income by plan | MRR share per canonical plan tier (zero-MRR tiers dropped) |
| At-risk income | overdue subscription windows with days-overdue note |

## RED / GREEN cycle

- **RED** (commit `3558c8e`): `npm run test:income` → `MODULE_NOT_FOUND` on
  `src/lib/admin/income-analytics.ts` — the intended missing implementation
  (compile-time RED; the reproducer executed and failed for the intended reason).
- **GREEN** (commit `0c2255c`): after implementing the pure core,
  `npm run test:income` → `12 passed, 0 failed`. One test expectation was
  corrected mid-cycle: the canonical label for plan key `pro` is **"Business"**
  (`src/lib/admin/plans.ts:25`), not "Pro" — a wrong test expectation about repo
  reality, not an implementation change (11/12 → 12/12).
- **UI wiring** (commit `41d0b79`): loader + page + client view + nav entry;
  `npx tsc --noEmit` shows **zero** errors in the new files (the only errors are
  3 pre-existing ones in unrelated one-off scripts:
  `fix-pepstack-reseller.ts`, `rebrand-fit-n-glow-peptibesties.ts`,
  `remove-reseller-data.ts`).

## Test specification

| # | What is guaranteed | Test (scripts/test-income-analytics.ts) | Type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | MRR sums active tenants only; per-tenant override wins incl. a comped ₱0 | "MRR sums active tenants only…" | unit | PASS | `npm run test:income` |
| 2 | Collected-this-month counts confirmed payments in the current UTC month only | "collected this month counts confirmed…" | unit | PASS | same |
| 3 | collectedPct = collected/expected; 0 (not NaN) when nothing expected | "collectedPct is collected/expected…" | unit | PASS | same |
| 4 | Monthly series buckets confirmed payments by UTC month, paidAt→submittedAt fallback | "monthly series buckets…" | unit | PASS | same |
| 5 | Weekly series = six 7-day buckets ending today, oldest first | "weekly series uses six 7-day buckets…" | unit | PASS | same |
| 6 | Projections = flat (MRR − at-risk), monthly + weekly-ized, never negative | "projections are flat MRR minus at-risk…" | unit | PASS | same |
| 7 | MoM delta compares last two FULL months; null with no base | "month-over-month delta…" | unit | PASS | same |
| 8 | Upcoming renewals sorted soonest-first with overdue/due_soon/scheduled statuses, initials, plan label, fee; 30-day roll-up excludes later renewals | "upcoming renewals are windowed tenants…" | unit | PASS | same |
| 9 | Expected-this-week counts renewals due within 7 days only | "expected this week counts renewals…" | unit | PASS | same |
| 10 | Plan breakdown: per-tier count/MRR/pctOfMrr/barPct; zero-MRR tiers dropped | "plan breakdown splits MRR…" | unit | PASS | same |
| 11 | At-risk rows carry days-overdue note + monthly fee; total feeds projections | "at-risk lists overdue tenants…" | unit | PASS | same |
| 12 | Empty inputs → all-zero, JSON-round-trip-safe result | "empty inputs produce an all-zero…" | unit | PASS | same |

## Coverage and known gaps

- The pure core (`income-analytics.ts`) is fully covered by the 12 checks above
  (every exported branch: MRR, series, projections, upcoming, plan, at-risk,
  empty-state).
- `income-data.ts` (DB loader) follows the established fail-open pattern
  (`loadTenantSubscriptionSignals`) and is exercised at runtime, not unit-tested
  — consistent with the repo's other server loaders.
- `IncomeView.tsx` is presentation-only over the tested payload; visual
  verification in the browser is the remaining step (operator login required).
- Demo mode: deterministic synthetic inputs (index-derived, no randomness).

## Merge evidence

Checkpoints on `main`: `3558c8e` (RED) → `0c2255c` (GREEN, 12/12) → `41d0b79`
(UI wiring, typecheck clean). No squash planned.
