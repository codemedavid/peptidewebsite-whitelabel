# TDD Evidence — Per-tenant subscription price ("Monthly price due")

## Source plan

No `*.plan.md`. Journeys derived from the user's request: extend the tenant-detail
**Subscription window** so the operator can set a per-tenant recurring price ("how
much is their monthly payment due") in addition to the existing Amount paid. Per
the clarifying answers: the operator sets the value by hand (no auto-normalization),
blank by default, and **when set it overrides the plan-config price for the Plan
fee display and MRR**, falling back to the plan price when blank.

## User journeys

1. As an operator, I want to set a per-tenant monthly price in the Subscription
   window, so a tenant on a custom deal shows their real recurring fee.
2. As an operator, I want a blank price to fall back to the plan's list price, so
   tenants I never customize keep the standard fee with no extra work.
3. As an operator, I want to set a price of ₱0 for a comped tenant and have it
   honored (not treated as "unset"), so free tenants read as free.
4. As the platform, MRR should sum each active tenant's effective fee (custom
   price when set, else plan price), so revenue reflects real deals.

## Task report

### Core override rule (`effectivePlanFeeCents`)
- Extracted the shared rule into `src/lib/subscription/plan-fee.ts` because it is
  used in two places (MRR sum + Plan-fee tile) and has a subtle 0-is-valid
  requirement.
- RED: `npm run test:plan-fee` →
  `Error: Cannot find module '../src/lib/subscription/plan-fee'` (test references
  the not-yet-written implementation — intended compile-time RED).
- GREEN: after adding the helper → `6 passed, 0 failed`.
- Guaranteed: per-tenant price wins when finite and ≥ 0 (including 0); null /
  undefined / negative / non-finite fall back to the plan price.

### Wiring (integration, verified by `tsc --noEmit` + manual trace)
- `prisma/schema.prisma`: added nullable `Tenant.subscriptionPriceCents`.
- `src/actions/admin.ts`: `setSubscriptionWindowAction` accepts `priceCents`,
  validates (finite, ≥ 0; 0 allowed), stores it, and nulls it when the window is
  cleared.
- `src/lib/subscription/subscription-info.ts`: `getSubscriptionMeta` now returns
  `priceCents` (fail-open to null on read error / pending db:push).
- `src/lib/admin/data.ts`: `AdminTenantRow` + `TenantDetail` carry
  `subscriptionPriceCents`; a fail-open loader (`loadTenantSubscriptionSignals`,
  replacing `loadTenantUrgencies`) merges per-tenant prices into the list; MRR sum
  uses `effectivePlanFeeCents(...)`.
- `src/components/admin/pages/TenantDetailView.tsx`: Plan-fee tile uses
  `effectivePlanFeeCents(tenant.subscriptionPriceCents, tenant.planPriceCents)`;
  `SubscriptionWindowCard` gains a "Monthly price due (₱)" input with 0-or-more
  validation, wired into save and reset.

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | Blank per-tenant price → plan fallback used | `scripts/test-plan-fee.ts` (undefined + null cases) | unit | PASS | `npm run test:plan-fee` |
| 2 | Set per-tenant price overrides the plan price | `scripts/test-plan-fee.ts` (99900 case) | unit | PASS | `npm run test:plan-fee` |
| 3 | A deliberate ₱0 overrides, never falls back | `scripts/test-plan-fee.ts` (0 case) | unit | PASS | `npm run test:plan-fee` |
| 4 | Negative / non-finite price ignored → fallback | `scripts/test-plan-fee.ts` (-500, NaN, Infinity) | unit | PASS | `npm run test:plan-fee` |
| 5 | Whole change compiles against the generated Prisma client | `npx tsc --noEmit` | typecheck | PASS (exit 0, 0 diagnostics) | `tsc --noEmit --pretty false` |
| 6 | No regression in sibling subscription cores | `test:subscription-state/-payments/billing-cycle/near-due` | unit | PASS (14/21/20/10) | `npm run test:<name>` |

## RED → GREEN → refactor summary

- RED: `npm run test:plan-fee` failed on the missing module (compile-time RED).
- GREEN: implemented `effectivePlanFeeCents`; 6/6 pass.
- Refactor: replaced `loadTenantUrgencies` with `loadTenantSubscriptionSignals`
  (one fail-open query now yields both urgency badges and price overrides),
  extracted the shared `NO_SUBSCRIPTION_META` constant; all tests remain green,
  `tsc` clean.

## Coverage and known gaps

- The pure override rule is fully unit-covered. The server action validation,
  DB round-trip, and React input are verified by `tsc` + code trace, not an
  automated integration test (the repo's convention for these admin surfaces is
  pure-core unit scripts run via `tsx`, not a DB-backed test harness).
- **Deploy note:** `Tenant.subscriptionPriceCents` is a new column. Per
  `live-db-state`, run `npm run db:push` (or `prisma db push`) against the live DB
  before this ships, or reads fail-open to "no override" and writes will error.

## Code-review fix round (2026-07-22)

A high-effort review flagged 6 findings; addressed as follows.

- **Unit ambiguity → MRR overstatement (findings #1/#2):** the field is the
  tenant's **monthly** rate (user intent), so monthly MRR is correct as-is. Removed
  the ambiguity that caused the finding — schema comment now states "recurring
  MONTHLY price … NOT the per-term total", and the UI label dropped "per term"
  ("the tenant's recurring monthly fee"). No logic change.
- **Fail-open blast radius (findings #3/#4):** `loadSubscriptionWindow`
  (subscription-info) and `loadTenantSubscriptionSignals` (admin/data) now
  **retry with the pre-price column set** if the full select throws, so a
  not-yet-migrated `subscriptionPriceCents` can no longer take down the existing
  storefront banner/countdown or the tenants-list urgency badges. Happy path is
  still a single query; the fallback fires only on error.
- **No price clamp (finding #6):** validation centralized into the tested
  `resolvePriceCentsInput`, which clamps to `MAX_SUBSCRIPTION_PRICE_CENTS`
  (₱1M/mo, matching the plan-config guardrail) so an oversized entry can't exceed
  the 32-bit Int column. RED: 7 new cases failed on the missing function; GREEN:
  `npm run test:plan-fee` → **13 passed, 0 failed**.
- **Plan-fee tile dropped `subscriptionAmountCents` fallback (finding #5):** left
  as `effectivePlanFeeCents(price, planPrice)` **by design** — `subscriptionAmountCents`
  is a per-term lump payment, not a monthly rate, and must not feed a monthly Plan
  fee tile. Intentional, documented here.

### Fix-round test spec

| # | What is guaranteed | Test | Result | Evidence |
|---|--------------------|------|--------|----------|
| 7 | null/undefined price input clears the field | `test-plan-fee.ts` | PASS | `npm run test:plan-fee` |
| 8 | 0 is accepted (comped), fractional cent rounded | `test-plan-fee.ts` | PASS | `npm run test:plan-fee` |
| 9 | Over-guardrail price is clamped, not rejected | `test-plan-fee.ts` | PASS | `npm run test:plan-fee` |
| 10 | Negative / non-finite price returns an error | `test-plan-fee.ts` | PASS | `npm run test:plan-fee` |
| 11 | Whole change compiles | `npx tsc --noEmit` | PASS (exit 0) | 0 diagnostics |
| 12 | No regression in sibling subscription cores | `test:subscription-state/-payments/billing-cycle/near-due` | PASS (14/21/20/10) | `npm run test:<name>` |

### Fix-round known gap

The query fallback-retry for findings #3/#4 is verified by `tsc` + code trace, not
an automated DB test (the repo has no DB-backed harness for these admin reads).
The trigger — a missing column throwing on the full select — is a Prisma runtime
error path exercised only against a real un-migrated DB.
