# Subscription billing-cycle (Yearly & friends) — TDD evidence

**Branch:** `feat/trial-system` · **Date:** 2026-07-21

## Source / trigger

Feature request (via `/ecc:plan` → `/ecc:tdd-workflow`): *"Yearly Subscription Option for
Tenant Management"* — let the Super Admin assign a **billing cycle**
(`monthly | quarterly | semi_annual | yearly`) to a tenant, auto-calculate the due
date one term after the start date, allow a manual override, and surface
Type / Start / Due / Status / Days-remaining in the tenant details.

This is the operator-setter chunk that `subscription-duration.tdd.md` flagged as its
open follow-up #2 ("nothing WRITES the window yet"). The display machinery, the pure
countdown core, the cached resolver, and both UI surfaces already existed and are
window-driven (cycle-agnostic) — a yearly window simply yields `totalDays ≈ 365`.

## User journeys

1. As the operator, I pick **Yearly** + a start date on a tenant's detail page and the
   **Due date auto-fills to exactly one year later**, which I can then adjust by hand.
2. As the operator, I can also choose Monthly / Quarterly / Semi-annual, or **Clear** the
   window entirely (tenant returns to the byte-identical no-banner state).
3. As the operator, I see the tenant's **Type / Start / Due / Status / Days remaining** in
   the Subscription card.
4. Edge cases: due ≤ start is rejected (client + server); month-overflow and leap days
   clamp cleanly (Jan 31 → Feb 28/29, Feb 29 + 1yr → Feb 28); trial tenants keep the trial
   banner and are told the window activates on a paid plan.

## RED / GREEN

| Gate | Command | Result |
|------|---------|--------|
| RED | `npm run test:billing-cycle` | FAIL — `Cannot find module '../src/lib/subscription/billing-cycle'` (compile-time RED; the test exercises the not-yet-existing core) |
| GREEN | `npm run test:billing-cycle` | **20 passed, 0 failed** |
| Regression | `npm run test:subscription-state` / `test:trial-state` / `test:trial-gating` | 14 / 13 / 18 passed |
| Types | `npx tsc --noEmit --pretty false` | **0 errors** |
| Schema | `npx prisma validate` | valid 🚀 |

## What each layer guarantees

| # | Layer | File |
|---|-------|------|
| 1 | Pure cycle→due math (RED/GREEN core) | `src/lib/subscription/billing-cycle.ts` — `BILLING_CYCLES`, `BILLING_CYCLE_LABELS`, `BILLING_CYCLE_MONTHS`, `addBillingCycle` (calendar-month arithmetic w/ end-of-month clamping, immutable), `isBillingCycle` guard |
| 2 | Schema | `Tenant.subscriptionCycle String?` (string-enum, operator-set) |
| 3 | Setter | `setSubscriptionWindowAction` in `src/actions/admin.ts` — mirrors `setTrialAction`: `requirePlatformUser` → demo guard → `isBillingCycle` → `parseDay` → auto-calc via `addBillingCycle` (explicit `endsAt` = manual override) → server re-validates `due > start` → `prisma.tenant.update` → revalidate `tenant:${id}` + `admin:data` |
| 4 | Resolver | `getSubscriptionMeta` in `subscription-info.ts` — reuses the same cached window read (one DB hit) to surface `{ cycle, startsAt }`, fail-open to nulls |
| 5 | Projection | `TenantDetail.subscriptionCycle` + `subscriptionStartsAt` in `src/lib/admin/data.ts` (attached outside the cache, fail-open) |
| 6 | Operator UI | `SubscriptionWindowCard` in `TenantDetailView.tsx` (cycle `<select>` + start/due `<input type=date>`, auto-recompute-unless-overridden, client `due > start` guard, Save/Clear) + Type/Start/Due/Days-remaining review rows |

The countdown core (`subscription-state.ts`) is **unchanged** — it already derived `totalDays`
from the concrete start/end window, so yearly terms work with no edit.

## Test specification

| # | Guarantee | Test | Type | Result |
|---|-----------|------|------|--------|
| 1 | `BILLING_CYCLES` lists all four cycles in expansion order | `test-billing-cycle.ts` | unit | PASS |
| 2 | Each cycle has a human label and a month count (1/3/6/12) | `test-billing-cycle.ts` | unit | PASS |
| 3 | Monthly/Quarterly/Semi-annual/Yearly land on the right calendar day | `test-billing-cycle.ts` | unit | PASS |
| 4 | Yearly = exactly one calendar year on | `test-billing-cycle.ts` | unit | PASS |
| 5 | Year rollover (Dec→Jan, Nov→Feb) is correct | `test-billing-cycle.ts` | unit | PASS |
| 6 | Month-overflow clamps (Jan 31→Feb 28, Nov 30→Feb 28) | `test-billing-cycle.ts` | unit | PASS |
| 7 | Leap-day clamps (2024-02-29 +1yr → 2025-02-28; Jan 31 +1mo → 2024-02-29) | `test-billing-cycle.ts` | unit | PASS |
| 8 | Time-of-day preserved; input Date never mutated | `test-billing-cycle.ts` | unit | PASS |
| 9 | Computed due is always strictly after the start | `test-billing-cycle.ts` | unit | PASS |
| 10 | `isBillingCycle` accepts the four cycles, rejects unknown/empty/non-string, narrows the type | `test-billing-cycle.ts` | unit | PASS |

## Known gaps / follow-ups

1. **⚠ Needs `db:push`** — the new `Tenant.subscriptionCycle` column (and the two existing
   `subscription*At` columns) aren't on the live DB yet (see `[[live-db-state]]`). Until
   pushed, the fail-open resolver yields "no cycle / no window" and the setter's write
   throws behind the action's guard. Prisma client regenerated locally (`npx prisma generate`).
2. The `setSubscriptionWindowAction` glue is covered by mirroring the already-tested
   `setTrialAction` pattern + `tsc`; its pure pieces (`addBillingCycle`, `isBillingCycle`,
   `due > start`) are unit-tested. No integration test harness exists for server actions in
   this repo.
3. Expiration/notification jobs: none exist today. Because the window is stored as concrete
   dates, any future job reading `subscriptionEndsAt` already respects the cycle.
4. Store-owner banner still renders "day X of Y" without the cycle label — optional polish,
   not built (kept scope tight).
5. No visual-regression screenshots for the new setter card (unit core only).
