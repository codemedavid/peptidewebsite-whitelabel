# Reseller page — the unreachable parent switch — TDD evidence

**Reported as:** "why is there no reseller page for Nova Lab when I already toggled on the reseller page feature"
**Branch:** `feat/made-to-order` · commits `12b5b8b` (RED) → `60b1ab3` (GREEN)
**Date:** 2026-09-04

## Source plan

No `*.plan.md` artifact. The plan was produced inline by `/ecc:plan` from the
report above and approved with "proceed". Its three phases are the three
sections below. One phase-1 question — gated `#merchant` list, public MOQ
pricing, or both — was left with the owner; the entitlement grant covers both
paths, and neither surface can price anything until the owner configures
products, so the answer does not block any of this work.

## Diagnosis

Read-only inspection of the live database found Nova Lab in this state:

```
Nova Lab (nova-lab)  plan = Pro
  storefront.reseller             plan=false  override=—     => OFF   <- parent
  storefront.reseller.wholesale   plan=false  override=true  => ON
  storefront.reseller.page        plan=true   override=—     => ON
  resellerAccessCodeHash set?  false
  resellerAccessCode (legacy)? false
  products = 17,  withWholesale = 0,  withLegacyReseller = 0
```

Three independent reasons the page did not exist, and none of them was visible
on any screen:

1. **The parent switch was off.** `resellerCapsFrom` returns `RESELLER_CAPS_OFF`
   the moment `storefront.reseller` is absent, so both granted children resolved
   to false and `showPageMerchant` was false.
2. **The operator could not turn it on.** `storefront.reseller` is in the Starter
   and Automated ceilings but **not** Business/Pro, and it was not in
   `OPERATOR_GRANTABLE` — so on a Pro tenant it rendered as a locked row. Because
   `requiredPlanFor` returns the *lowest* tier holding a feature, that row told a
   Pro tenant to "upgrade to **Starter**".
3. **No reseller password, and no wholesale product data.** `showPageMerchant`
   also requires `hasResellerCode`; and 0 of 17 products carried a `wholesale`
   or `reseller` leg, so the price list would have rendered empty regardless.

The admin Features screen had no notion of parent/child at all. The
`dependsOn` / "stays inert until X is on" machinery existed in
`src/lib/tenant/feature-toggle.ts` but was wired only to the MCP connector
(`src/lib/mcp/feature-tool.ts`), never to the screen an operator actually uses.

## User journeys

1. As a **platform operator**, I want to grant the Reseller parent to a tenant on
   any plan, so the two children below it are not permanently inert.
2. As a **platform operator**, when I switch on a child whose parent is off, I
   want the screen to tell me it does nothing, so I don't believe I have shipped
   a reseller page.
3. As a **platform operator**, I never want a locked row to tell me to upgrade to
   a plan below the tenant's own.
4. As a **store owner**, I want the reseller page to appear only once the whole
   gate is satisfied — entitlement, page child, and a password I set — so the
   wholesale price list is never public by accident.

## Task report

### Task 1 — make the parent reachable (`src/lib/features/catalog.ts`)

`FEATURES.STORE_RESELLER_PORTAL` added to `OPERATOR_GRANTABLE`. No plan ceiling
moved: Starter and Automated still grant it, Business/Pro can now be granted it
per tenant. The parent still exposes nothing on its own — both children keep
their own gates — so no existing tenant's storefront changes.

RED → `x the reseller PARENT is operator-grantable ... storefront.reseller must be grantable per tenant`
GREEN → `✓ the reseller PARENT is operator-grantable, so any plan can be granted it`

### Task 2 — name the whole `#merchant` gate (`src/lib/storefront/reseller-access.ts`)

`merchantPageVisible(caps, hasCode)` replaces three inline assignments in the
storefront render. Same behaviour, one testable place, so the exact shape that
produced this report is now pinned by the suite.

RED → `x merchantPageVisible is not a function` (4 checks)
GREEN → all 4 pass, including Nova Lab's literal state.

### Task 3 — surface the dependency (admin Features)

`src/app/(platform)/admin/tenants/[slug]/features/page.tsx` now builds its rows
with `buildFeatureInventory` — the same builder the MCP feature tool uses —
instead of re-deriving them inline. That removes the duplication that let the
two paths drift and carries `dependsOn`, which the inline version dropped.
`inertDependency` (in the React-free `feature-disclosure.ts`) turns it into an
**"Inert — needs Reseller"** badge on any switched-on child whose parent is off.
It reads the live toggle map, so the badge clears the moment the operator flips
the parent, with no reload.

RED → `x inertDependency is not a function` (6 checks)
GREEN → all 6 pass.

### Task 4 — unblock Nova Lab (live data)

```
$ npx tsx --env-file=.env scripts/grant-feature.ts nova-lab storefront.reseller on
✓ nova-lab: storefront.reseller = ON

  storefront.reseller             plan=false  override=true  => ON
  storefront.reseller.wholesale   plan=false  override=true  => ON
  storefront.reseller.page        plan=true   override=—     => ON
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | The Reseller parent can be granted to a tenant on any plan | `test-reseller-feature-tree.ts:the reseller PARENT is operator-grantable` | unit | PASS |
| 2 | No plan renders the parent as a locked row, so the children are never unreachable | `test-reseller-feature-tree.ts:no plan renders the reseller parent as a plan-locked row` | unit | PASS |
| 3 | A locked row never points the operator at a plan below the tenant's own | `test-reseller-feature-tree.ts:a locked row never points the operator at a plan below the tenant's own` | unit | PASS |
| 4 | Nova Lab's shape (children on, parent off) tells the operator which parent they need | `test-reseller-feature-tree.ts:Nova Lab's shape — both children on, parent off` | unit | PASS |
| 5 | The `#merchant` page needs parent AND page child AND an owner password | `test-reseller-feature-tree.ts:the reseller page needs the parent, the page child AND an owner password` | unit | PASS |
| 6 | The page child without the parent never shows the page, password or not | `test-reseller-feature-tree.ts:the page child WITHOUT the parent never shows the page` | unit | PASS |
| 7 | The parent without the page child never shows the page either | `test-reseller-feature-tree.ts:the parent WITHOUT the page child never shows the page either` | unit | PASS |
| 8 | Nova Lab's live state resolves to no page, and granting the parent alone is not enough | `test-reseller-feature-tree.ts:Nova Lab's live state resolves to no reseller page` | unit | PASS |
| 9 | An ON child under an OFF parent names the parent it needs | `test-feature-disclosure.ts:a child that is ON while its parent is OFF` | unit | PASS |
| 10 | The badge clears as soon as the parent is switched on | `test-feature-disclosure.ts:the same child goes live the moment the parent is switched on` | unit | PASS |
| 11 | An OFF child is not flagged inert — it is simply off | `test-feature-disclosure.ts:a child that is OFF is not inert` | unit | PASS |
| 12 | A top-level switch is never flagged inert | `test-feature-disclosure.ts:a top-level switch with no parent is never inert` | unit | PASS |
| 13 | An unknown parent counts as off, so the badge fails closed | `test-feature-disclosure.ts:an unknown parent entry counts as OFF` | unit | PASS |
| 14 | Deciding never mutates the toggle map | `test-feature-disclosure.ts:the state map is never mutated while deciding` | unit | PASS |

## Validation

```
npm run test:reseller-feature-tree   21 passed, 0 failed   (RED was 14 passed, 7 failed)
npm run test:feature-disclosure      17 passed, 0 failed   (RED was 11 passed, 6 failed)
npm run test:reseller-gate           21 passed, 0 failed
npm run test:wholesale-pricing       25 passed, 0 failed
npm run test:wholesale-admin         14 passed, 0 failed
npm run test:plan-scope              19 passed, 0 failed
npm run test:plan-distribution        9 passed, 0 failed
npm run test:plan-feature-config     20 passed, 0 failed
npm run test:mcp-features            all checks passed
npm run test:trial-gating            18 passed, 0 failed
npm run test:tenant-presets          65 passed, 0 failed
npm run test:two-ways-home           37 passed, 0 failed
npm run test:made-to-order           32 passed, 0 failed
npm run test:feature-spotlight        6 passed, 0 failed
npm run test:trial-expiry             8 passed, 0 failed
npx tsx scripts/test-staff-permissions.ts     51 passed, 0 failed
npx tsx scripts/test-coa-protocols-feature.ts 15 passed, 0 failed
npx tsx scripts/test-reviews-feature.ts        7 passed, 0 failed
npm run typecheck                    clean
```

## Coverage and known gaps

This repository has no jest/vitest coverage harness; its suites are hand-rolled
`tsx` assertion scripts, so no percentage is reported. Both new pure functions
are covered exhaustively by branch instead:

- `merchantPageVisible` — all three conditions exercised on and off (checks 5–8).
- `inertDependency` — all four return paths, plus the immutability guarantee
  (checks 9–14).

Known gaps, deliberate:

- **`scripts/test-business-package.ts` has 2 pre-existing failures**, unrelated
  to this work: it expects a Pro ceiling of 36 keys and the catalog now has 38
  (`storefront.track_note` among them). Verified not caused by this change —
  the diff is purely additive to `OPERATOR_GRANTABLE` and `PLAN_FEATURES.pro`
  is untouched. That script has no `npm run` alias, so it is outside the normal
  rotation. Left for whoever owns the ceiling bookkeeping.
- **`test:plan-scope` premises updated, not behaviour.** Two assertions were
  built on "on Starter none of the grantables are in the ceiling". A feature can
  be both plan-granted and operator-grantable — the check immediately below them
  already calls that a dual feature — so the stale premise was corrected to the
  per-plan rule.
- **No browser verification.** The inert badge is asserted through its pure
  helper, not rendered in a browser.
- **Two owner-side steps remain** before Nova Lab's page appears: the owner must
  set a reseller password in the now-visible Reseller Portal, and configure
  wholesale MOQ + price on the products that should carry it. Both are the
  owner's data, not something this change can supply.
- **Entitlements are cached** (`unstable_cache`, 5 min, tag `tenant:<id>`). A
  direct script write cannot bust that tag, so the grant reaches the storefront
  on the next revalidation or immediately after any admin Save.

## Merge evidence

If `12b5b8b` and `60b1ab3` are squashed, the RED/GREEN summary above is the
record: 13 checks failed for the intended reasons before the fix (missing
`merchantPageVisible`, missing `inertDependency`, the parent not grantable, the
parent locked on Pro, and the "upgrade to Starter" prompt on a Pro tenant), and
all 13 pass after it with no adjacent suite regressed.
