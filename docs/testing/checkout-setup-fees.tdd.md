# TDD Evidence — Setup fees in checkout totals

**Source plan:** follow-up from `docs/testing/pepweb-landing.tdd.md` (known gap), user request
"wire the setup fees into checkout totals" (2026-07-16).
**Checkpoints:** RED `b9a7fb7` → GREEN `90452dd`

## User journeys

1. As a Starter buyer, my checkout total is first month + setup fee (+ extra features), e.g.
   ₱799 + ₱499 = ₱1,298 — shown as itemized lines, not a bare number.
2. As a Business buyer, the waived fee shows as "FREE ~~₱999~~" and never inflates the total.
3. As a trial buyer, setup is always FREE (the intro offer's promise), even if the operator
   un-waives the plan's fee.
4. As the operator, changing fees/waived on /admin/plans flows straight into the wizard totals.

## RED → GREEN

- **RED:** `npm run test:checkout-total` failed — `Cannot find module '../src/lib/onboarding/pricing'`
  (compile-time RED: the test newly exercises the missing implementation; commit `b9a7fb7`).
- **GREEN:** 8/8 pass (commit `90452dd`); `test:pepweb-landing` still 14/14; `tsc --noEmit` clean;
  `npm run build` succeeds.

## What is guaranteed (`scripts/test-checkout-total.ts`)

| # | Guarantee | Result |
|---|---|---|
| 1 | Starter: ₱799 + ₱499 setup = ₱1,298 | PASS |
| 2 | Starter extras add 2 × ₱1,500 on top | PASS |
| 3 | Business default: ₱699 first month, waived fee charges ₱0 (flag kept for display) | PASS |
| 4 | Trial: setup forced FREE regardless of the waived flag | PASS |
| 5 | Un-waived, promo-less Business: ₱1,499 + ₱999 = ₱2,498 | PASS |
| 6 | Automated: ₱2,999 + ₱1,999 = ₱4,998 | PASS |
| 7 | Zero fee → no charge, no waived display | PASS |
| 8 | Negative extra-feature counts clamp to 0 | PASS |

## Implementation

- `src/lib/onboarding/pricing.ts` — pure `checkoutQuote(pkg, {trial, extraFeatureCount})`.
- `CheckoutStep` (steps/index.tsx) renders the itemized paybox (base / extras / setup / total)
  from the quote; `PackageStep` cards show "/month" + the setup-fee note ("FREE setup (₱999
  waived)" or "+ ₱499 one-time setup").

## Known gaps

- The submission still stores no amount server-side (unchanged behavior — payment is manual
  proof-upload; the operator verifies the receipt against the same plan config).
