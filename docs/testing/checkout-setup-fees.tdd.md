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

- ~~The submission stores no amount server-side~~ — resolved 2026-07-17 (see below).

## Follow-up: amountDueCents stamped onto OnboardingSubmission (2026-07-17)

**Checkpoints:** RED `0a42e82` (8/13 — `amountDueFromConfig is not a function`) → GREEN `db8b39c` (13/13).

- `amountDueFromConfig(config, {planKey, trial, extraFeatureCount})` in `pricing.ts`: the same
  `checkoutQuote`, fed from the operator-edited plan config — first-month promo as the effective
  price, config `trialPriceCents` for trials (operator-editable, unlike the wizard's display
  constant), legacy plan aliases resolved via `planMeta`.
- `submitOnboardingAction` computes it server-side (never trusts the client) and stamps
  `OnboardingSubmission.amountDueCents Int?` (schema pushed to the live DB; existing rows null;
  demo mode stays null).
- Admin Onboarding detail's Package stat now reads e.g. "Starter · ₱2,798" or
  "Business — Trial (₱699)" from the stamp, falling back to the old labels for pre-stamp rows.
- New guarantees (5): Starter+extra parity with the wizard quote, Business promo total, custom
  trialPriceCents honored, alias resolution, Automated ₱4,998. `tsc` clean, build passes,
  `test:pepweb-landing` 14/14 and `test:trial-upgrade` 9/9 still green; live column verified
  with a real query (`amountDueCents: null` on a pre-stamp row).
