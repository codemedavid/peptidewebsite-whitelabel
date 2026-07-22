# TDD Evidence — Tenant-visible subscription amount due (Billing page)

**Date:** 2026-07-22 · **Branch:** main · **Commits:** RED `0680995` → GREEN `baefc4f`

## Source plan

No `*.plan.md` — journey derived in this TDD run from the user's question: tenants
whose monthly payment is set up in the super admin could **not** see the amount
they owe on the store-admin Billing page (only the due date/days-left rendered).

## User journey

> As a store owner whose provider set my subscription (billing cycle + monthly
> price due) in the super admin, I want the Billing page to show the amount due
> for my term, so I know exactly how much to pay before filing proof of payment.

## Root cause

`brandSubscriptionFrom()` (`src/lib/subscription/subscription-state.ts`)
projected only window fields (daysLeft, endsAt, …) into `brand.subscription`.
The operator-set `subscriptionPriceCents` ("Monthly price due") and
`subscriptionCycle` never reached the tenant client.

## Change

| File | Change |
|---|---|
| `src/lib/subscription/subscription-state.ts` | `BrandSubscription` += optional `amountDueCents`/`cycle`; `brandSubscriptionFrom(state, billing?)` projects them (0 valid = comped; negative/NaN/null omitted; not-governed → still `undefined`) |
| `src/lib/subscription/subscription-info.ts` | New `getSubscriptionBilling(tenantId)`: `effectivePlanFeeCents(subscriptionPriceCents, planConfigPriceCents(planConfig, plan.key))` + cycle — same rule as the platform admin Plan-fee tile; fail-open to nulls; window read now selects `plan.key` |
| `src/app/(tenant)/(storefront)/page.tsx` | Passes the resolved billing terms into the projection |
| `src/storefront/admin/AdminBilling.tsx` | "Amount due ₱X · billed monthly" row in the 📅 Your subscription card; amount-input placeholder suggests the due figure |

## Task report (RED → GREEN)

- **RED** (`npm run test:subscription-state`, commit `0680995`): 6 new cases added;
  the 2 positive cases failed for the intended reason — the billing arg was
  ignored, `amountDueCents` came back `undefined`:
  ```
  ✗ billing terms project amountDueCents + cycle into brand.subscription — + undefined / - 149900
  ✗ a comped ₱0 price is a real amount and projects as 0 — undefined !== 0
  18 passed, 2 failed
  ```
- **GREEN** (same command, commit `baefc4f`): `20 passed, 0 failed`.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Billing terms project `amountDueCents` + `cycle` into `brand.subscription` | `test-subscription-state.ts` "billing terms project…" | unit | PASS |
| 2 | ₱0 (comped) is a real amount and projects as 0 | "a comped ₱0 price…" | unit | PASS |
| 3 | Null/unset terms are omitted (legacy brands byte-identical) | "null/unset billing terms…" | unit | PASS |
| 4 | Negative / non-finite amounts never reach the tenant | "negative or non-finite…" | unit | PASS |
| 5 | Call without billing arg is back-compatible (no new fields) | "calling without billing terms…" | unit | PASS |
| 6 | Not-governed state projects nothing even with billing terms | "billing terms on a not-governed state…" | unit | PASS |
| 7 | Price-override fallback rule (override → list price, 0 wins) | `npm run test:plan-fee` | unit | PASS (13/13, pre-existing) |

## Regression / verification

- `npm run test:subscription-state` 20/20 · `test:plan-fee` 13/13 ·
  `test:billing-cycle` 20/20 · `test:subscription-payments` 21/21
- `npx tsc --noEmit`: no errors in changed files (2 pre-existing errors in
  unrelated one-off scripts `fix-pepstack-reseller.ts` / `remove-reseller-data.ts`)
- Live smoke: hpglow/dragon-peptides storefront RSC (which now runs
  `getSubscriptionBilling`) renders 200; kglow 307 = its access-code gate.

## Known gaps

- The server resolver (`getSubscriptionBilling`) and the AdminBilling render are
  covered by typecheck + live smoke, not unit tests (DB/Next-runtime + RSC).
- Stale `unstable_cache` entries from before the `plan.key` select change lack
  `plan` for ≤5 min → resolver fails open (no figure) until revalidation.
- No browser E2E of the logged-in Billing page (needs owner credentials).
