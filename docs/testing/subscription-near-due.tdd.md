# Subscription near-due — Super Admin visibility — TDD evidence

**Branch:** `feat/trial-system` · **Date:** 2026-07-21

## Source / trigger

Operator question (via `/ecc:tdd-workflow`): *"is there already a banner in the storefront
admin that shows their subscription due and how many days, and is there a way to let the
super admin know whose tenant is near its due?"*

Findings:
- **Storefront-admin banner already existed** — `src/storefront/admin/SubscriptionBanner.tsx`
  shows the tenant their own "N days left / Day X of Y / Renews <date>" + an "ended" state.
- **No cross-tenant near-due signal existed for the operator** — `AdminTenantRow` carried no
  subscription window; the countdown only appeared on a single tenant's detail page. Nothing
  flagged at-risk tenants on the dashboard or tenants list.

Chosen resolution (operator-confirmed): **in-app** "Expiring soon" dashboard panel + tenants-list
badges; threshold **≤ 7 days** (email digest explicitly deferred).

## User journeys

1. As the operator, on the platform dashboard I see an **"Expiring soon"** panel listing tenants
   whose paid subscription is due within 7 days or already lapsed, most-urgent first.
2. As the operator, on the tenants list each at-risk tenant shows a **badge** ("2d left" amber /
   "Overdue" red) beside its name.
3. Edge cases: tenants with no window / on trial / with plenty of runway are never flagged;
   exactly 7 days left IS flagged (boundary inclusive); a lapsed window shows "overdue".
4. Safety: if the subscription columns aren't on the live DB yet, the whole tenants list must
   **not** break — the near-due read fails open to "no badges".

## RED / GREEN

| Gate | Command | Result |
|------|---------|--------|
| RED | `npm run test:near-due` | FAIL — `Cannot find module '../src/lib/subscription/near-due'` (compile-time RED) |
| GREEN | `npm run test:near-due` | **10 passed, 0 failed** |
| Regression | `test:billing-cycle` / `test:subscription-state` / `test:trial-state` / `test:trial-gating` | 20 / 14 / 13 / 18 passed |
| Types | `npx tsc --noEmit --pretty false` | **0 errors** |

## What each layer guarantees

| # | Layer | File |
|---|-------|------|
| 1 | Pure urgency core (RED/GREEN) | `src/lib/subscription/near-due.ts` — `NEAR_DUE_DAYS = 7`, `subscriptionUrgency(input, now, nearDueDays?)` → `ok` \| `due_soon` \| `overdue` (thin derivation over `computeSubscriptionState`), `FlaggedUrgency` type |
| 2 | Fail-open reader | `loadTenantUrgencies()` in `src/lib/admin/data.ts` — fresh (outside the 120s list cache) `try/catch` read → `Map<id, FlaggedUrgency>`; a pending-`db:push` column just yields no badges |
| 3 | Projection | `AdminTenantRow.subscriptionUrgency?`, attached in `listAdminTenants` (fresh); `OverviewData.expiringTenants` + `getExpiringTenants()`, sorted overdue → fewest-days → soonest-end (`compareUrgency`) |
| 4 | Dashboard UI | `ExpiringPanel` in `DashboardView.tsx` — renders only when non-empty; amber/red dot, days text, due date, links to the tenant |
| 5 | Tenants-list UI | `UrgencyBadge` in `TenantsTable.tsx` — inline chip beside the tenant name |

Reused: the storefront-admin `SubscriptionBanner` (already shipped) needed no change.

## Test specification

| # | Guarantee | Test | Type | Result |
|---|-----------|------|------|--------|
| 1 | `NEAR_DUE_DAYS` defaults to 7 | `test-near-due.ts` | unit | PASS |
| 2 | No window / trial / 20-days-out → `ok` (not flagged) | `test-near-due.ts` | unit | PASS |
| 3 | 8 days left is outside the window → `ok` | `test-near-due.ts` | unit | PASS |
| 4 | Exactly 7 days (boundary inclusive) → `due_soon` w/ daysLeft + ISO endsAt | `test-near-due.ts` | unit | PASS |
| 5 | 2 days left → `due_soon`; suspended-but-paid within window is flagged | `test-near-due.ts` | unit | PASS |
| 6 | Lapsed window → `overdue`, 0 days left | `test-near-due.ts` | unit | PASS |
| 7 | Configurable threshold (14 flags a 10-day-out tenant that 7 doesn't) | `test-near-due.ts` | unit | PASS |

## Known gaps / follow-ups

1. **⚠ Needs `db:push`** — near-due reads the same `subscription*At` columns; until pushed the
   fail-open reader yields no badges/panel (no crash). See `[[live-db-state]]`.
2. **Email digest not built** — operator chose in-app only for now; the pure core + `getExpiringTenants`
   are reusable if a scheduled digest is added later.
3. Near-due day-boundary precision is fresh-per-request but the underlying tenant list is 120s-cached;
   badge/panel membership can lag a tenant edit by ≤120s (edits bust `admin:data`, so usually instant).
4. UI wiring (panel + badge) covered by `tsc` + the tested pure core; no component/visual-regression test.
