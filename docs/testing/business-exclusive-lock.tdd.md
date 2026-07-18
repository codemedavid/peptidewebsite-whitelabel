# TDD Evidence — Unify the Business-exclusive lock (code-review HIGH + finding 2/3)

**Source plan:** derived from the `/code-review` (high-effort) findings on `feat/trial-system`. Companion: `code-review-fixes.tdd.md`, `trial-gating`/`trial-state` suites.

## The bug (review finding #1, HIGH)

The checkout **admin fee** was gated by two different rules:

- **Storefront display** (`page.tsx`) → `hasFeature(STORE_ADMIN_FEE)`
- **Server charge** (`orders.ts`) → `isBusinessExclusiveLocked(...)`

During an **active trial** these disagree: `hasFeature` is `true` (the trial plan is technically entitled), so the storefront showed the fee line and folded it into the displayed total and the client echo — but `isBusinessExclusiveLocked` is `true` (locked), so the server never stamped it. Result:

- with `adminFeeValidation` + `ruleBasedCheckout` on → `checkoutRulesViolation` saw `shown>0 != charged 0` and **hard-blocked every checkout for the whole trial month**;
- otherwise → the order was recorded/charged for **less than the customer was shown and told to pay**.

## User journey

> As a store on an active Business trial with an admin fee configured, the fee a
> customer is shown at checkout must equal the fee the server charges — never a
> line the server silently drops or a total that blocks the order.

## Fix (right altitude)

Extract the one rule into a pure, client-safe function and route **all three** sites through it, so display, tile-lock, and charge can't drift:

```
businessExclusiveLocked(trial, entitled): boolean
  = (trial.onTrial && !trial.expired) ? true : !entitled
```

- `src/lib/trial/trial-info.ts` `isBusinessExclusiveLocked` (server charge gate) → derives from it.
- `src/storefront/visibility.ts` `isAdminModuleLocked` (store-admin tile lock) → derives from it.
- `src/app/(tenant)/(storefront)/page.tsx` → drops `brand.adminFee` when `businessExclusiveLocked(brand.trial, adminFeeEntitled)`, so **display == charge**.

Also: corrected the stale `page.tsx` comment that claimed "orders.ts re-applies the same gate" (finding 2 — now literally true), and stopped serializing the full product catalog into a paused (expired-trial) store's payload (finding 3).

## Task report

| Task | Summary | Command | Result |
|---|---|---|---|
| RED | Import + assert `businessExclusiveLocked` (missing export) and that `isAdminModuleLocked('fee')` equals it | `npm run test:trial-gating` | FAIL 14/18 — "is not a function" (commit `test: reproducer — single Business-exclusive lock rule`) |
| GREEN | Add the pure rule; route the server gate, tile lock, and storefront display through it | `npm run test:trial-gating` | PASS 18/18 (commit `fix: unify the Business-exclusive lock…`) |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Active trial → locked regardless of entitlement | `test-trial-gating.ts:businessExclusiveLocked: active trial locks…` | unit | PASS |
| 2 | No trial blob → follows entitlement | `test-trial-gating.ts:businessExclusiveLocked: no trial blob…` | unit | PASS |
| 3 | Expired trial → follows entitlement | `test-trial-gating.ts:businessExclusiveLocked: expired trial…` | unit | PASS |
| 4 | The store-admin tile lock derives from the same rule | `test-trial-gating.ts:isAdminModuleLocked('fee') is exactly businessExclusiveLocked…` | unit | PASS |
| 5 | Existing tile-lock behavior unchanged (regression) | `test-trial-gating.ts` (10 prior lock cases) | unit | PASS (18/18 total) |

## Coverage and known gaps

- The pure rule and the tile lock are unit-tested. The **storefront display gate** (`page.tsx`) and the **server charge gate** (`orders.ts`) are server code (RSC / `"use server"`); the repo doesn't render/DB-test those, so their correctness rests on both provably calling the same `businessExclusiveLocked` — verified by `tsc` + inspection. This is the same convention used for the other trial/server-action fixes.
- Finding 3 (paused-store product serialization) is a defensive change validated by `tsc`; the store owner's upgrade path is unaffected because `#admin` renders the plans screen when `brand.trial?.expired`.

## Regression sweep (post-change)

`trial-gating 18` · `trial-state 13` · `trial-expiry 8` · `trial-upgrade 9` · `gb-report 12` · `gb-banner 10` · `feature-spotlight 6` · `onhand-gate 9` · `plan-scope 19` · `checkout-total 13` · `staff 62` · `reviews 7` · `coa-protocols 15` · `track-note 20`; `tsc --noEmit` 0 errors.
