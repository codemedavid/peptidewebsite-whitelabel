# Yearly subscription at get-started checkout — TDD evidence

**Branch:** `feat/gb-pricing-tab` · **Date:** 2026-07-28
**Source plan:** none — journeys were derived during this TDD run from the user's request.

> "add a yearly subscription when the user is fillup the get started monthly is the usual
> and our yearly is 5899 for starter, 9899 for business, 15899 for automated with set up
> fee as ussual"

Follow-up decision from the user, on how Starter's extra add-on features should behave on a
yearly term: *"when in starters if more than 2 convince them on getting the business package"* —
so extras stay a flat ₱1,500 each on either cycle, and a Starter who picks past the included
2 features now gets a Business upsell nudge instead of only a running extras total.

## User journeys

1. As a signing-up store owner, I want to choose Yearly instead of Monthly on the package
   step, so that I can prepay a discounted year.
2. As a signing-up store owner, I want the checkout box to quote the term I actually picked
   (a year, not a month), so that the amount I send matches what I owe.
3. As a Starter signing up who wants more than the 2 included add-on pages, I want to be told
   that Business already bundles them, so that I don't pay per-feature for something a tier
   up includes.
4. As the operator, I want the sign-up record to say whether the client prepaid a month or a
   year, so that I set the right subscription window and don't chase them for a renewal 11
   months early.
5. As the operator, I want to edit the yearly price per plan on /admin/plans, so that pricing
   is not a code change.

## Task report

| # | Task | Execution summary | Validation command | Result |
|---|------|-------------------|--------------------|--------|
| 1 | Reproducer first | Wrote `scripts/test-yearly-subscription.ts` pinning the prices, per-cycle quote math, payload plumbing, and wiring markers before any implementation existed. | `npm run test:yearly-subscription` | **RED** — `1 passed, 26 failed` |
| 2 | Yearly prices in config | `PLAN_CARDS.yearlyPriceCents` (589900 / 989900 / 1589900) + `EditablePlanCard.yearlyPriceCents`, normalized with fallback-on-garbage. | same | GREEN |
| 3 | Cycle-aware quote | `checkoutQuote()` / `amountDueFromConfig()` take `billingCycle`; only the subscription base swaps. | same | GREEN |
| 4 | Wizard UI | Monthly \| Yearly switch, per-card yearly price + saving, paybox "1 year (prepaid)", Billing row in the review. | same | GREEN |
| 5 | Starter → Business nudge | `.mk-upsell` block with a one-click switch to Business once picks exceed the included allotment. | same | GREEN |
| 6 | Server + operator surfaces | Cycle re-narrowed server-side, stamped on `OnboardingSubmission.billingCycle`, seeds `Tenant.subscriptionCycle`, shown on the sign-up detail, editable on /admin/plans. | same | GREEN |
| 7 | Regression | Existing monthly checkout math and the other plan-config consumers re-run. | see table below | GREEN |

RED excerpt (before implementation):

```
✗ default plan config prices the year: ₱5,899 / ₱9,899 / ₱15,899
✗ Starter yearly = ₱5,899 + ₱499 setup as usual = ₱6,398 — Expected values to be strictly equal: 129800 !== 639800
✗ normalizeOnboardingCycle narrows untrusted input to monthly — (0 , import_schema.normalizeOnboardingCycle) is not a function
✓ amountDueFromConfig: monthly totals are untouched by this change
1 passed, 26 failed
```

GREEN excerpt (after implementation):

```
✓ Starter yearly = ₱5,899 + ₱499 setup as usual = ₱6,398
✓ Business yearly = ₱9,899, setup still FREE (₱999 struck through)
✓ Automated yearly = ₱15,899 + ₱1,999 setup = ₱17,898
✓ Starter extras stay a flat ₱1,500 each on yearly (not ×12)
✓ the trial is a one-month offer — it overrides a yearly pick
27 passed, 0 failed
```

One RED→GREEN correction was to the *test*, not the implementation: the minimal payload
fixture had to gain a `whatsapp` value because a concurrent session made that field required
on `onboardingSchema` mid-run. The assertion it supports (billingCycle defaults to monthly)
is unchanged.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | The three yearly prices are ₱5,899 / ₱9,899 / ₱15,899 | `test-yearly-subscription.ts:default plan config prices the year` | unit | PASS |
| 2 | An operator-edited yearly price is kept; 0/negative/NaN/missing falls back to the plan default | `…:operator can edit the yearly price` / `…:garbage / zero / negative yearly prices` | unit | PASS |
| 3 | The wizard receives a formatted yearly price and saving per package | `…:packagesFrom exposes the yearly price + label` | unit | PASS |
| 4 | Monthly totals are unchanged, including when no cycle is passed | `…:monthly is unchanged` / `…:an omitted cycle still means monthly` / `…:monthly totals are untouched` | unit | PASS |
| 5 | Yearly charges the term price **plus** the usual one-time setup fee (Starter ₱6,398, Automated ₱17,898) | `…:Starter yearly` / `…:Automated yearly` | unit | PASS |
| 6 | Business yearly keeps FREE setup (₱999 shown struck through) | `…:Business yearly = ₱9,899, setup still FREE` | unit | PASS |
| 7 | Starter add-on extras stay ₱1,500 each on a yearly term, not ×12 | `…:Starter extras stay a flat ₱1,500 each on yearly` | unit | PASS |
| 8 | A first-month promo never discounts the yearly price | `…:a first-month promo never applies to the yearly price` | unit | PASS |
| 9 | Picking the ₱699 trial forces the cycle back to monthly | `…:the trial is a one-month offer` | unit | PASS |
| 10 | The "save N%" badge is right (Starter ₱3,689 / 38%) and never negative | `…:yearly savings vs 12 months` / `…:savings never go negative` | unit | PASS |
| 11 | The server-authoritative `amountDueCents` matches the paybox for the chosen cycle, incl. legacy plan aliases | `…:amountDueFromConfig: Starter yearly` / `…: Business yearly … legacy alias` | unit | PASS |
| 12 | `billingCycle` rides the payload, defaults to monthly, and rejects anything we don't sell | `…:the onboarding payload carries billingCycle` | unit | PASS |
| 13 | Untrusted cycle input (query string, hand-edited localStorage draft) degrades to monthly | `…:normalizeOnboardingCycle narrows untrusted input` | unit | PASS |
| 14 | The draft starts monthly and maps its cycle into the submit payload | `…:the wizard draft starts monthly` | unit | PASS |
| 15 | The package step renders the cycle toggle and a /year price | `…:the package step renders a monthly / yearly cycle toggle` | wiring | PASS |
| 16 | The paybox quotes the chosen cycle | `…:the checkout paybox quotes the chosen cycle` | wiring | PASS |
| 17 | A Starter past the included features is nudged to Business, with a switch | `…:a Starter picking beyond the included features is nudged` | wiring | PASS |
| 18 | The action narrows the cycle, stamps it, and seeds the tenant's subscriptionCycle | `…:the server action stamps the cycle` | wiring | PASS |
| 19 | `OnboardingSubmission` persists the cycle with a "monthly" default | `…:OnboardingSubmission persists the billing cycle` | wiring | PASS |
| 20 | The operator sees the cycle on the sign-up record and can edit yearly prices | `…:the operator sees the cycle` / `…:the operator can edit yearly prices` | wiring | PASS |

Regression suites re-run after the change (all previously green, still green):

| Command | Result |
|---------|--------|
| `npm run test:checkout-total` | 13 passed, 0 failed |
| `npm run test:pepweb-landing` | 14 passed, 0 failed |
| `npm run test:plan-distribution` | 9 passed, 0 failed |
| `npm run test:trial-upgrade` | 9 passed, 0 failed |
| `npm run test:income` | 12 passed, 0 failed |

## Coverage and known gaps

- This repo has **no coverage instrumentation** (no Jest/Vitest); the convention is one
  self-contained `tsx` script per feature. No percentage is claimed here — the 80% target
  from the global rules cannot be measured with the current toolchain.
- **Wiring assertions are source-marker greps**, not rendered-component tests. They prove the
  toggle, upsell, paybox line, action stamp, Prisma column and operator surfaces exist and are
  connected; they do not prove layout or click behaviour. No browser/E2E run was done.
- **`npm run db:push` is still pending.** `onboarding_submissions.billingCycle` is a new
  column; until it is pushed, a live sign-up will fail with "column does not exist". The
  default is `"monthly"`, so existing rows read correctly once pushed.
- **Two `tsc` errors were in the tree** from a concurrent session's in-progress
  WhatsApp-contact refactor, not from this feature
  (`OnboardingDetail.tsx(199) Cannot find name 'waHref'`,
  `useOnboardingForm.ts(190) INITIAL_DRAFT missing 'email'`). Verified out of scope by
  `git diff` — this change touches neither symbol.
- Not in scope (deliberately): the public marketing pricing cards still advertise monthly
  only; `packagesFrom` now carries the yearly data if that is wanted later. Renewal billing
  for a yearly tenant remains the operator-set subscription window.

## Merge evidence

Checkpoints on `feat/gb-pricing-tab`, in order:

| Commit | Stage | Evidence |
|--------|-------|----------|
| `82e8453` | RED | `test: reproducer for the yearly get-started subscription` — `npm run test:yearly-subscription` → 1 passed, 26 failed |
| `5cf26ff` | GREEN | `feat: yearly billing option at get-started checkout` — `npm run test:yearly-subscription` → 27 passed, 0 failed; `npm run test:checkout-total` → 13 passed, 0 failed |

No separate refactor commit: the implementation landed in its final shape (shared pure
helpers, no duplication introduced) and the tests stayed green.
