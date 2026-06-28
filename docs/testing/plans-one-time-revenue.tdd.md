# TDD Evidence — Remove recurring-revenue framing (one-time payment model)

**Date:** 2026-06-28
**Branch:** main
**Source plan:** inline `/ecc:plan` output (full reframe), confirmed by the user via AskUserQuestion ("Full reframe (Recommended)").

## Context

The platform sells a **one-time website build** per plan, not a monthly subscription.
The admin therefore must not present recurring-revenue concepts (MRR/ARR, `/mo`,
"billed monthly", "Active subscriptions", "Monthly revenue").

## User journeys

1. As the operator, I open **Plans & Billing** and see **one-time revenue collected**
   and **active sites** — never MRR or ARR.
2. As the operator, I see plan prices labelled **one-time**, not **/mo**.
3. As the operator, the **dashboard / analytics / tenant detail** describe revenue
   and sites in one-time, non-subscription language.

## RED → GREEN cycle (testable core)

The recurring math (`arrCents = mrrCents × 12`) lived inline in
`getPlanDistribution`. It was extracted to a pure, DB-free module and TDD'd.

| Stage | Command | Result | Evidence |
|---|---|---|---|
| RED | `npx tsx scripts/test-plan-distribution.ts` | FAIL | `Error: Cannot find module '../src/lib/admin/plan-distribution'` — the test references the intended-missing implementation (compile-time RED). |
| GREEN | `npm run test:plan-distribution` | PASS | `9 passed, 0 failed` |
| Typecheck | `npx tsc --noEmit --pretty false` | PASS | exit 0 |

## Test specification — `scripts/test-plan-distribution.ts`

| # | What is guaranteed | Test name | Type | Result |
|---|--------------------|-----------|------|--------|
| 1 | Emits exactly starter/pro/enterprise rows in order | `emits exactly the three canonical plan rows, in order` | unit | PASS |
| 2 | Per-plan `count` includes every tenant regardless of status | `per-plan count includes every tenant regardless of status` | unit | PASS |
| 3 | Per-plan `revenueCents` counts only ACTIVE sites at plan price | `per-plan revenueCents counts only ACTIVE sites at the plan price` | unit | PASS |
| 4 | Total revenue = one-time sum of active plan prices (**not ×12**) | `total revenueCents is the one-time sum of active plan prices (NOT ×12)` | unit | PASS |
| 5 | `activeCount` equals number of active tenants | `activeCount equals the number of active tenants` | unit | PASS |
| 6 | No recurring/annualized field exposed (no `arrCents`/`mrrCents`) | `does NOT expose a recurring/annualized figure (no arrCents/mrrCents)` | unit | PASS |
| 7 | Each row carries catalog `priceCents` + `label` | `each row carries its catalog priceCents and label` | unit | PASS |
| 8 | Empty tenant list → zero revenue, zero active, 3 empty rows | `empty tenant list yields zero revenue, zero active, three empty rows` | unit | PASS |
| 9 | Unknown/legacy plan keys fold into a canonical plan | `unknown/legacy plan keys fold into a canonical plan (never vanish)` | unit | PASS |

## Implementation changes

| File | Change |
|---|---|
| `src/lib/admin/plan-distribution.ts` | **NEW** pure `aggregatePlanDistribution()` + `PlanRow`/`PlanDistribution` types (no recurring concept) |
| `src/lib/admin/data.ts` | `getPlanDistribution()` delegates to the pure aggregator; returns `{rows, revenueCents, activeCount}` (dropped `mrrCents`/`arrCents`); re-exports the types |
| `src/app/(platform)/admin/plans/page.tsx` | Pass `revenueCents` instead of `mrrCents`/`arrCents` |
| `src/components/admin/pages/PlansManager.tsx` | KPIs → "Total revenue" + "Active sites" (MRR/ARR removed, `grid-2-eq`); price suffix `/mo`→`one-time`; "Monthly price"→"Price"; per-plan "₱X MRR"→"₱X collected"; subtitle de-subscription-ified |
| `src/components/admin/pages/DashboardView.tsx` | "Active subscriptions"→"Active sites"; "Monthly revenue"→"Total revenue" (delta "MRR + 30d"→"Plans + 30d") |
| `src/app/(platform)/admin/analytics/page.tsx` | "Monthly revenue"→"Total revenue" (also fixed `$`→`₱`) |
| `src/components/admin/pages/TenantDetailView.tsx` | "MRR" tile→"Plan fee" (`… one-time`); active-status copy `/mo · billed monthly`→`· one-time` |
| `src/components/admin/shell/CreateTenantDrawer.tsx` | Plan card + review price suffix `/mo`→`one-time` |
| `src/components/admin/PlanStatusManager.tsx` | Comment "MRR tile"→"plan-fee tile" |
| `package.json` | Added `test:plan-distribution` script |

## Coverage & known gaps

- The pure aggregator (`plan-distribution.ts`) is fully branch-covered by the 9 tests.
- **UI label changes are not unit-tested** — the repo has no React test runner; these
  are verified by `tsc` (exit 0) and a repo-wide grep sweep confirming no residual
  `MRR|ARR|/mo|billed monthly|recurring|Active subscriptions|Monthly revenue` strings
  in `src/components/admin` or `src/app/(platform)/admin` (one false positive at
  `DashboardView.tsx:29` is an SVG path `M`/`L` + an `arr` array param, not a metric).
- The dashboard/analytics "Total revenue" still sums active plan fees + trailing-30d
  order revenue (`getPlatformOverview.monthlyRevenueCents`). Label is honest
  ("Plans + 30d"); a pure one-time-only total is a possible follow-up.

## Checkpoint commits

None created — the working tree already carried many unrelated modified files from
prior sessions, so per-stage checkpoint commits would have bundled unrelated work.
RED/GREEN evidence is preserved in this report instead (permitted by the workflow).
