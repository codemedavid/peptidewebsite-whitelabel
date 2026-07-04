# TDD Evidence — Reviews as a managed feature (admin → Features)

**Date:** 2026-07-04
**Branch:** main

## Source plan
Derived inline during `/ecc:plan` → `/ecc:tdd-workflow`. No `*.plan.md` artifact was written; the plan was presented and confirmed in-session.

**Confirmed decision:** the Reviews feature is **operator-grantable / default-OFF** (not in any plan ceiling) — no tenant surfaces Reviews until the platform operator grants it per tenant.

## User journeys
1. As a **platform operator**, I want a Reviews on/off toggle in admin → Features, so I can enable or disable the Reviews page per tenant.
2. As a **platform operator**, when I revoke Reviews for a tenant, the storefront Reviews page + nav link AND the store-admin Reviews manager all disappear.
3. As a **store owner** of an entitled tenant, I still control the Reviews page from the branding editor "Reviews page" toggle; when unentitled, that toggle isn't shown.

## Design (mirrors the Dosage-calculator two-layer gate)
- New feature `FEATURES.STORE_REVIEWS = "storefront.reviews"` in `Catalog` group, added to `OPERATOR_GRANTABLE`, **not** in any plan ceiling.
- Pure gate `resolveShowReviews(entitled, ownerToggle) = entitled && ownerToggle !== false` in `src/storefront/visibility.ts`.
- Storefront render (`src/app/(tenant)/(storefront)/page.tsx`) projects `hasFeature(STORE_REVIEWS)` → `brand.reviewsEntitled` and folds it into `brand.showPageReviews`. Existing `visibility.ts` mappings (`PAGE_TOGGLE.reviews`, `ADMIN_VIEW_TOGGLE.reviews`) already key on `showPageReviews`, so nav/page/admin-manager gating needed no change.
- `BrandTweaksForm` hides the "Reviews page" owner toggle when `reviewsEntitled === false`.

## Task report
| Task | Summary | Command | Result |
|---|---|---|---|
| RED | Wrote `scripts/test-reviews-feature.ts` before any impl | `npm run test:reviews` | **RED** — 1 passed, 6 failed (`STORE_REVIEWS undefined`, no `FEATURE_META`, not in `OPERATOR_GRANTABLE`, `resolveShowReviews is not a function`) |
| GREEN | Registered feature + added pure gate + projection + owner-toggle guard | `npm run test:reviews` | **GREEN** — 7 passed, 0 failed |
| Typecheck | Full project type-check | `npx tsc --noEmit` | **PASS** — exit 0 |
| Regression | Catalog-adjacent suites | `npm run test:feature-disclosure`, `npm run test:plan-scope` | **PASS** — 11/11 and 16/16 |

## Test specification
| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | `STORE_REVIEWS` is registered as `storefront.reviews` and in `ALL_FEATURES` | `scripts/test-reviews-feature.ts` | unit | PASS |
| 2 | It has admin Features metadata in the `Catalog` group (label + description) | `scripts/test-reviews-feature.ts` | unit | PASS |
| 3 | It is operator-grantable (never plan-locked) | `scripts/test-reviews-feature.ts` | unit | PASS |
| 4 | It is default-OFF — absent from starter/pro/enterprise ceilings | `scripts/test-reviews-feature.ts` | unit | PASS |
| 5 | Reviews hidden when unentitled, regardless of the owner toggle | `resolveShowReviews` cases | unit | PASS |
| 6 | Reviews visible when entitled and owner hasn't turned the page off | `resolveShowReviews` cases | unit | PASS |
| 7 | Reviews hidden when entitled but owner turned the page off | `resolveShowReviews` cases | unit | PASS |

## Files changed
- `src/lib/features/catalog.ts` — `STORE_REVIEWS` key, `OPERATOR_GRANTABLE` member, `FEATURE_META` entry.
- `src/storefront/visibility.ts` — pure `resolveShowReviews`.
- `src/storefront/types.ts` — `Brand.reviewsEntitled?: boolean`.
- `src/app/(tenant)/(storefront)/page.tsx` — entitlement projection onto `brand`.
- `src/storefront/tweaks/BrandTweaksForm.tsx` — owner toggle guarded on `reviewsEntitled`.
- `scripts/test-reviews-feature.ts` + `package.json` `test:reviews` script.

## Coverage / known gaps
- Pure cores (catalog registration, gate logic) fully covered by `test:reviews`.
- The DB entitlement path (`hasFeature`) and the FeaturesEditor UI render are exercised by the existing platform-features infrastructure (unchanged) and are not re-tested here; the operator grant/revoke persistence reuses the same `TenantFeatureOverride` mechanism as every other operator-grantable feature.
- No DB migration required.

## Manual verification checklist (for reviewer)
- [ ] Grant Reviews to a demo tenant in admin → Features → storefront Reviews nav/page + store-admin Reviews manager appear.
- [ ] Revoke → both disappear.
- [ ] For an entitled tenant, store-admin "Reviews page" toggle shows and hides the page independently.
