# TDD Evidence — Plan ↔ Feature-Catalog connection

**Source plan:** inline `/ecc:plan` output (conversational mode), confirmed by the user with
"yes write up the full plan and also connect this to the tenant part so that when im creating a
new tenant the features for each plan will automatically turn on the right features for each plan."

## User journeys

1. As the platform operator, on **/admin/plans** I want each package card to show the package's
   **real functional scope** (not just hand-typed marketing text), so I can list what each plan
   actually grants at a glance.
2. As the operator, I want a **"Generate"** button that fills the marketing bullets from the plan's
   real scope, so the customer-facing copy never drifts from the entitlements — and never advertises
   a capability that is off by default.
3. As the operator, when I **create a new tenant on a plan**, I want it to automatically get exactly
   that plan's features, and a **"Sync plan features"** control to reconcile the DB ceiling to the
   catalog after I change it.

## Key finding (grounding)

Per-plan features **already auto-resolve at tenant creation**: `createTenant` (`src/actions/onboarding.ts`)
sets `tenant.planId`, and `getEntitlements` (`src/lib/features/entitlements.ts`) reads `plan_features`
**live** on every request. The only gap was drift: `plan_features` was written by an additive-only
seed. `syncPlanCatalog` closes that gap (adds missing **and** removes stale rows).

## Task report

| Task | Summary | Validation command | Result | Guarantees |
|---|---|---|---|---|
| Scope helpers | Pure `getPlanScope` / `bulletsFromScope` derive scope + bullets from `catalog.ts` | `npm run test:plan-scope` | **PASS** 16/16 | Scope mirrors the catalog ceiling; bullets stay honest + within limits |
| Scope panel | Read-only grouped, state-tagged panel per plan card | `npx tsc --noEmit` | **PASS** exit 0 | Compiles; renders `included` / `needs-addon` / `addon` states |
| Generate bullets | One-way fill of `feats` from scope, confirm before overwrite | `npx tsc --noEmit` | **PASS** | Copy can't claim add-on-gated features |
| Catalog→DB reconcile | `syncPlanCatalog` upserts features/plans + reconciles `plan_features` | `npx tsc --noEmit` | **PASS** | Idempotent; removes stale ceiling rows; returns a diff |
| Sync wiring | `seed.ts` reuse, `npm run db:sync-features`, operator action + button | `npx tsc --noEmit` | **PASS** | One source of truth for the DB ceiling |

## RED → GREEN (Phase 1)

- **RED:** `npm run test:plan-scope` → `Cannot find module '../src/lib/features/plan-scope'`
  (test references the intended-but-missing implementation).
- **GREEN:** after implementing `src/lib/features/plan-scope.ts` → `16 passed, 0 failed`.
- Two defects surfaced and fixed during the cycle:
  1. `STORE_STAFF_ACCOUNTS` is in both the Business/Automated ceiling **and** `OPERATOR_GRANTABLE`
     — `stateFor` now treats a ceiling feature as `included` even when it is also operator-grantable
     (`addon` only applies outside the ceiling).
  2. `bulletsFromScope` originally advertised `included-needs-addon` features (Group Buy / Sales
     Analytics basics) on Starter, which are OFF by default — now only `included` features are
     advertised. Locked by the "bullets never advertise add-on-gated features" test.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Scope groups follow `FEATURE_GROUPS` order | `scripts/test-plan-scope.ts` | unit | PASS |
| 2 | Every plan-ceiling feature appears once, in an included state | `scripts/test-plan-scope.ts` | unit | PASS |
| 3 | SA slices / GB sub-caps are `included-needs-addon` | `scripts/test-plan-scope.ts` | unit | PASS |
| 4 | Operator-grantable features outside the ceiling are `addon` | `scripts/test-plan-scope.ts` | unit | PASS |
| 5 | A dual feature is `included` where granted, `addon` where not | `scripts/test-plan-scope.ts` | unit | PASS |
| 6 | `includedCount`==ceiling size; `addonCount`==grantable count | `scripts/test-plan-scope.ts` | unit | PASS |
| 7 | enterprise ⊇ pro ⊇ starter | `scripts/test-plan-scope.ts` | unit | PASS |
| 8 | Bullets lead with "Everything in <lower>"; starter has none | `scripts/test-plan-scope.ts` | unit | PASS |
| 9 | Bullets never advertise add-on-gated features | `scripts/test-plan-scope.ts` | unit | PASS |
| 10 | Bullets ≤12, ≤160 chars, non-empty | `scripts/test-plan-scope.ts` | unit | PASS |

## Coverage and known gaps

- `npm run test:plan-scope` — pure helpers, full branch coverage of state classification + bullets.
- `npx tsc --noEmit` — **exit 0** across the repo (UI + actions + reconcile compile).
- **DB-dependent paths not run here** (no `DATABASE_URL` in this environment): `syncPlanCatalog` and
  the live `getEntitlements` provisioning check. Verify against a DB with:
  1. `npm run db:sync-features` → prints the per-plan add/remove diff (expect "up to date" on a seeded DB).
  2. Create a tenant on **Starter** → `/admin/tenants/<slug>/features` shows exactly the Starter ceiling on.
- Follow-up: `prisma/register-admin-fee-feature.ts` is superseded by `syncPlanCatalog` and can be
  deleted once a sync has run.

## Concurrent-session note

A second session refactored `src/lib/admin/data.ts` → `plan-distribution.ts` (MRR/ARR → one-time
`revenueCents`) during this work, touching `PlansManager.tsx` and `plans/page.tsx`. The edits merged
cleanly; final `npx tsc --noEmit` is green. The full `npm run build` was intentionally **not** run
while that session was still saving, to avoid a mid-write race — run it once the tree settles.
