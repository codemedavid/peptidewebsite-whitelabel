# TDD Evidence — Retire the ₱699 / 1-Month Trial Offer (New Tenants Only)

**Date:** 2026-07-18
**Branch:** `feat/trial-system`
**Source plan:** inline `/ecc:plan` output ("Retire the ₱699 / 1-Month Trial Offer (New Tenants Only)"), confirmed by the user with "yes proceed".

## Intent

Stop **new** tenants from ever starting the ₱699 / 1-month Business trial by
removing the offer from every customer-facing surface (marketing pricing site +
get-started onboarding funnel). **Every existing trial tenant and all trial
machinery stay untouched** (`src/lib/trial/*`, locks, upgrade flow,
`/admin/upgrades`, `OnboardingSubmission.trial` schema).

## User journeys

1. As a prospective customer on the pricing site, I no longer see a "₱699 / 1
   month trial" offer — Business shows a flat ₱1,499/month.
2. As a prospective customer in the onboarding wizard, there is no "start with
   the 1-month trial" toggle, and a stale `?trial=1` link does nothing.
3. As the platform, a submitted onboarding is **never** recorded as a trial,
   regardless of a crafted `?trial=1` payload (server-authoritative gate).
4. As an existing trial tenant, my storefront, locks, expiry, and upgrade flow
   keep working exactly as before.

## RED → GREEN

| Stage | Commit | Evidence |
|---|---|---|
| RED | `9687f8f` test: … (RED) | `test:pepweb-landing` **11 passed, 3 failed**; `test:checkout-total` **10 passed, 3 failed** — failures: pro `discountPriceCents` still `69900` (expected `undefined`), `INTRO_OFFER` still exported, Business quote still `69900` (expected `149900`). |
| GREEN | `e8c8c42` feat: … (GREEN) | `test:pepweb-landing` **14/14**; `test:checkout-total` **13/13**; `tsc --noEmit` **0 errors**. |

## Task report

| Task | Summary | Validation | Result |
|---|---|---|---|
| Server gate | `public-onboarding.ts` forces `const trial = false` — new tenants are never trial, even via `?trial=1`. | code review + `tsc --noEmit` | clean |
| Marketing offer | Removed `INTRO_OFFER` export + banner; pro CTA drops `&trial=1`; pro default `discountPriceCents` removed → flat ₱1,499. | `test:pepweb-landing` | 14/14 |
| Checkout math | Business non-trial now quotes ₱1,499 (was ₱699 first month). | `test:checkout-total` | 13/13 |
| Wizard funnel | `OnboardingWizard` ignores `?trial=1`; removed the trial toggle tile + dead `isTrial` branches in `CheckoutStep`; dropped unused `PRO_TRIAL_PRICE_CENTS` import. | `tsc --noEmit` | clean |
| Regression: existing trials | Trial machinery untouched. | `test:trial-state` 13/13, `test:trial-gating` 18/18, `test:trial-upgrade` 9/9, `test:trial-expiry` 8/8, `test:feature-spotlight` 6/6 | all green |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Default Business plan has no first-month promo (`discountPriceCents === undefined`) | `test:pepweb-landing` | unit | PASS |
| 2 | `packagesFrom` Business → `priceCents` ₱1,499, `discountLabel` undefined | `test:pepweb-landing` | unit | PASS |
| 3 | `marketing/config` no longer exports `INTRO_OFFER` | `test:pepweb-landing` | unit | PASS |
| 4 | Business non-trial checkout quote = ₱1,499 (site/wizard/server stamp) | `test:checkout-total` | unit | PASS |
| 5 | `checkoutQuote(trial:true)` still honors the trial price (machinery intact) | `test:checkout-total` | unit | PASS |
| 6 | Trial-state / gating / upgrade / expiry / spotlight unchanged | `test:trial-*` | unit | PASS |

## Coverage / known gaps

- The **server gate** (`trial = false`) and **wizard/steps UI** removals are not
  unit-tested directly (Next server action + client components); they are
  covered by `tsc --noEmit`, code review, and manual verification. The gate is a
  literal `false`, so its correctness is inspection-obvious.
- **Live DB follow-up (required, not code):** the stored `plan_config`
  PlatformSetting row still carries the pro `discountPriceCents` (set by
  `apply-pepweb-pricing.ts`), which overrides code defaults on live pricing
  surfaces. Clear it via **/admin/plans → Business → clear "First month" → Save**
  (then it syncs), or run `npx tsx scripts/clear-business-first-month-promo.ts`
  (prints a backup, strips only the pro promo). Until then the live site keeps
  quoting ₱699 first month.

## Merge evidence

RED `9687f8f` (suites flipped, failing for the intended reason) → GREEN
`e8c8c42` (implementation; both suites pass, trial machinery unchanged, tsc
clean). Existing trial tenants and machinery are intentionally out of scope and
verified untouched by the five `test:trial-*`/`test:feature-spotlight` suites.
