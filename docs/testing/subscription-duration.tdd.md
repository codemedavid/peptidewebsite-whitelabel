# Subscription-duration banner — TDD evidence

**Branch:** `feat/trial-system` · **Date:** 2026-07-21

## Source / trigger

User question: *"why is there still no banner of duration of subscription in the tenant admin page?"*

Root cause: the only countdown that existed was the **trial** banner (governed by
`status === "trial"` + an opted-in `OnboardingSubmission` + `trialEndsAt`). There was
**no subscription-period concept in the schema at all** — plans are one-time fees — so a
paid (`status: "active"`) tenant had no duration to show. Since public onboarding forces
`trial: false`, new tenants never hit the trial banner either.

Chosen resolution (operator-confirmed): add a **real subscription period** (new `Tenant`
fields + a resolution helper), surfaced on **both** the tenant's own store admin and the
platform-admin tenant-detail page.

## User journeys

1. As a store owner on a paid plan, I see a banner showing how much of my subscription
   period remains, so I know when to renew.
2. As the operator, I see a tenant's subscription window + days remaining on their detail
   page, so I can manage renewals.
3. Edge cases: no window set → no banner (byte-identical legacy behavior); expired →
   "ended" state; trial tenants keep the trial banner and never show both.

## RED / GREEN

| Gate | Command | Result |
|------|---------|--------|
| RED | `npm run test:subscription-state` | FAIL — `Cannot find module '../src/lib/subscription/subscription-state'` (compile-time RED; test exercises the not-yet-existing core) |
| GREEN | `npm run test:subscription-state` | **14 passed, 0 failed** |
| Regression | `npm run test:trial-state` / `test:trial-gating` | 13 passed / 18 passed |
| Types | `npx tsc --noEmit` | **0 errors** (0 in touched files) |

## What each layer guarantees

| # | Layer | File |
|---|-------|------|
| 1 | Pure math (RED/GREEN core) | `src/lib/subscription/subscription-state.ts` — `computeSubscriptionState`, `brandSubscriptionFrom`, `DEFAULT_SUBSCRIPTION_DAYS = 30`. Governs `status != "trial"` tenants with a `subscriptionEndsAt`; identical clamp math to the trial core. |
| 2 | Schema | `Tenant.subscriptionStartsAt` / `subscriptionEndsAt` (nullable, operator-set) |
| 3 | Resolver | `src/lib/subscription/subscription-info.ts` — `getSubscriptionState` (React `cache` + `unstable_cache` 5 min, tag `tenant:${id}`), fail-open so missing columns / read errors → no banner |
| 4 | Projection | `page.tsx` → `brand.subscription = brandSubscriptionFrom(await getSubscriptionState(tenantId))`; type on `src/storefront/types.ts` |
| 5 | Store-admin UI | `src/storefront/admin/SubscriptionBanner.tsx` + wired in `AdminPage.tsx` (`headerChrome`, mutually exclusive with the trial banner); slate/blue CSS `.admin-sub*` in `storefront.css` |
| 6 | Platform-admin UI | `TenantDetail.subscription` in `src/lib/admin/data.ts` (attached outside the cache, fail-open) + Subscription card rows in `TenantDetailView.tsx`. Also fixed the hardcoded "Free trial · 14 days" (contradicted `DEFAULT_TRIAL_DAYS = 30`) → "Free trial". |

## Test specification

| # | Guarantee | Test | Type | Result |
|---|-----------|------|------|--------|
| 1 | Trial tenants are not governed here (no double banner) | `test-subscription-state.ts` | unit | PASS |
| 2 | Paid tenant with no window → not governed (legacy byte-identical) | `test-subscription-state.ts` | unit | PASS |
| 3 | Start-but-no-end → not governed | `test-subscription-state.ts` | unit | PASS |
| 4 | Mid-period math: days left / dayNum / pctUsed / endsAt | `test-subscription-state.ts` | unit | PASS |
| 5 | Annual window computes totalDays from start/end | `test-subscription-state.ts` | unit | PASS |
| 6 | Suspended (still-paid) tenant with a window is governed | `test-subscription-state.ts` | unit | PASS |
| 7 | Missing start falls back to `DEFAULT_SUBSCRIPTION_DAYS` | `test-subscription-state.ts` | unit | PASS |
| 8 | ISO-string dates accepted (brand JSON round-trip) | `test-subscription-state.ts` | unit | PASS |
| 9 | Expiry: expired / 0 left / 100% / day clamped | `test-subscription-state.ts` | unit | PASS |
| 10 | Degenerate window (end before start) stays in range | `test-subscription-state.ts` | unit | PASS |
| 11 | `brandSubscriptionFrom` undefined when not governed | `test-subscription-state.ts` | unit | PASS |
| 12 | `brandSubscriptionFrom` serializes `endsAt` to ISO | `test-subscription-state.ts` | unit | PASS |

## Known gaps / follow-ups

1. **⚠ Needs `db:push`** — the two new `Tenant` columns aren't on the live DB yet (see
   `[[live-db-state]]`). Until pushed, `getSubscriptionState` fails open → no banner. The
   Prisma client was regenerated locally (`npx prisma generate`).
2. **⚠ No operator setter yet** — nothing WRITES `subscriptionStartsAt`/`subscriptionEndsAt`.
   The display machinery is complete, but the banner appears only once a window is populated
   (operator UI on the tenant settings/detail page, or a one-off script). This is the next
   chunk of work.
3. No visual-regression screenshots captured for the new banner (unit core only).
