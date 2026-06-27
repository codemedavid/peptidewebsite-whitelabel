# TDD Evidence — Super-Admin Tenant Plan & Status Editor

**Feature:** A "Plan & status" card on `/admin/tenants/[slug]/settings` that lets a platform operator reassign a tenant's package plan (Starter / Business / Automated) and lifecycle status (Active / Trial / Suspended).

**Source plan:** Derived during the `/ecc:plan` → `/ecc:tdd-workflow` run (no `*.plan.md` file). Scope confirmed by the user via AskUserQuestion: **Plan + status**, rendered as a **card on the Settings page**.

**Branch:** `feat/tenant-plan-status-editor`

## Domain facts that shaped the design

- `Tenant.planId` (`prisma/schema.prisma:22`) is a required FK to a `Plan` row keyed by `key` (`starter | pro | enterprise`). Display labels: `starter→Starter`, `pro→Business`, `enterprise→Automated` (`src/lib/admin/plans.ts:23-27`). So **"Business" = the `pro` plan**.
- `Tenant.status` (`schema.prisma:21`) is a separate field (`active | suspended | trial`). The UI already renders **"Trial"** from it. So **"Trial" = a status, not a plan**.
- Changing `planId` automatically re-gates features (entitlements derive from the plan's feature set) and updates MRR/plan distribution (`src/lib/admin/data.ts`).

## User journeys

1. As a platform operator, I want to switch a tenant's package plan from the tenant settings page, so I can upgrade/downgrade them without touching the database.
2. As a platform operator, I want to set a tenant's status to Trial / Active / Suspended, so I can run trials and use the kill-switch from one place.
3. As the system, I must reject any plan key or status the editor wouldn't legitimately emit, so a malformed request can't write a bad value.

## Task report

### Task 1 — Pure options/validation module (`src/lib/admin/plan-options.ts`)

- **Summary:** Client-safe option lists + validators derived from `PLAN_META`, plus an alias→canonical normalizer. The editor `<select>`s and the server action both consume this single source of truth.
- **Validation command:** `npm run test:plan-status` (`tsx scripts/test-plan-options.ts`).
- **RED evidence** (before the module existed):
  ```
  Error: Cannot find module '../src/lib/admin/plan-options'
  code: 'MODULE_NOT_FOUND'
  ```
  Compile-time RED — the new test references the not-yet-implemented module; failure caused by the missing implementation, not unrelated errors. (commit `bf1746f`)
- **GREEN evidence** (after implementing the module):
  ```
  PASS — 12 passed, 0 failed.
  ```
  (commit `e79528e`)
- **Guaranteed:** exactly three canonical plan options in tier order with labels Starter/Business/Automated; three statuses Active/Trial/Suspended; `isValidPlanKey` accepts only canonical keys and rejects aliases/labels/empty; `isValidStatus` accepts only known statuses; `canonicalPlanKey` maps aliases (`business→pro`, `growth→enterprise`) and falls back to `starter` without throwing.

### Task 2 — `setTenantPlanAction` (`src/actions/admin.ts`)

- **Summary:** Auth-gated server action mirroring `suspendTenantAction`: validates plan/status via `plan-options`, no-ops in demo mode, resolves the plan **key → `Plan.id`**, writes `Tenant.planId` + `status`, then `revalidateTag("admin:data")` + path revalidation.
- **Validation:** `npx tsc --noEmit` (0 errors) and `npm run build` (exit 0). Not unit-tested in isolation (touches Prisma + Next request scope); its pure validation core is covered by Task 1.
- **Guaranteed:** unknown plan/status rejected with a friendly error; missing `Plan` row reported (not a 500); demo tenants never mutated.

### Task 3 — `getTenantPlanStatus` (`src/lib/admin/data.ts`)

- **Summary:** Demo-aware getter returning `{ planKey, status }` for the settings page, mirroring `getTenantOrderFormat`.
- **Validation:** `npx tsc --noEmit` (0 errors); `npm run build` (exit 0).

### Task 4 — `PlanStatusManager` card + wiring (`src/components/admin/PlanStatusManager.tsx`, `TenantSettingsView.tsx`, `settings/page.tsx`)

- **Summary:** Self-contained card (mirrors `DomainManager`): two `<select>`s, dirty tracking, Save → `setTenantPlanAction` → `router.refresh()` so the tenant header badge and MRR reflect the change. Injected first into the settings sections via a new `planStatus` prop.
- **Validation:** `npx tsc --noEmit` (0 errors — after widening the `baseline` state type from the narrow `PlanKey` union to `string`); `npm run build` (exit 0).

## Test specification

| # | What is guaranteed | Test file / command | Type | Result | Evidence |
|---|--------------------|---------------------|------|--------|----------|
| 1 | Plan options are exactly Starter/Business/Automated (pro→Business) in tier order | `scripts/test-plan-options.ts` · `npm run test:plan-status` | unit | PASS | `12 passed, 0 failed` |
| 2 | Statuses are Active/Trial/Suspended and Trial is selectable | same | unit | PASS | same |
| 3 | `isValidPlanKey` accepts only canonical keys; rejects aliases/empty/`PRO` | same | unit | PASS | same |
| 4 | `isValidStatus` accepts only known statuses; rejects `deleted`/empty/`Active` | same | unit | PASS | same |
| 5 | `canonicalPlanKey` normalizes aliases and falls back to `starter` without throwing | same | unit | PASS | same |
| 6 | Whole program typechecks with the new action/getter/component/page | `npx tsc --noEmit` | type | PASS | `0 errors` |
| 7 | Production build succeeds with the new route wiring | `npm run build` | build | PASS | `BUILD EXIT: 0` · `✓ Compiled successfully` |

## Coverage & known gaps

- The **pure core** (options + validators that guard the action) is unit-tested (12 assertions). This project has no Jest/Vitest harness; tests are standalone `tsx` scripts (`test:posthog`, `test:isolation`, …), and this follows that convention.
- The **server action**, **data getter**, and **React card** are verified by typecheck + production build, not isolated unit tests — they depend on Prisma and the Next request scope, which the `tsx` harness doesn't provide. Their validation logic is the Task-1 module, which is fully tested.
- **Not automated:** the browser interaction (open settings → change plan → save → header badge/MRR refresh). Manual check path: `slug.lvh.me:3100/admin/tenants/<slug>/settings`.
- **Operational dependency:** the live DB must contain `Plan` rows for `starter`/`pro`/`enterprise`. If one is missing the action returns a clear error; remediation is `npm run db:seed`.

## Merge evidence (for squash)

RED `bf1746f` → GREEN `e79528e` → feature `b7edfd8`. Pure-core gate: `npm run test:plan-status` = 12/12. Whole-program gates: `npx tsc --noEmit` = 0 errors; `npm run build` = exit 0.
