# TDD Evidence — Group Buy extras become operator add-ons on every plan

**Source plan**: inline `/plan` (2026-07-17, this session) — no `.plan.md` artifact.
**Branch**: `feat/trial-system`

## User journey

As the platform operator, I want every Group Buy functionality to be grantable
per tenant on any plan (Starter / Business / Automated) — never auto-on with a
package and never "Locked · upgrade plan" — so a tenant like dragon-peptides can
sit on Starter and still be sold Group Buy explicitly.

## Root cause

`groupbuy.scheduled`, `groupbuy.multiple_active` and
`groupbuy.reports.auto_on_close` lived only in the `ENTERPRISE` ceiling
(`src/lib/features/catalog.ts`), so they were plan-locked on Starter/Business
(`admin/tenants/[slug]/features/page.tsx` lock rule: outside ceiling ∧ not
operator-grantable) and auto-included on Automated. All other GB keys were
already correct (module + rules operator-grantable; 12 building blocks in every
ceiling but inert until `groupbuy.module`).

## RED → GREEN

| Stage | Commit | Command | Result |
|---|---|---|---|
| RED | `c185c9d` test: add reproducer | `npm run test:plan-scope` | 16 passed, **2 failed** — `groupbuy.scheduled should be operator-grantable`; `groupbuy.scheduled shows "Locked · upgrade plan" on starter` |
| GREEN | `a31bc91` feat: GB extras → OPERATOR_GRANTABLE | `npm run test:plan-scope` | **18 passed, 0 failed** |

Fix: removed the 3 extras from `ENTERPRISE`, added them to `OPERATOR_GRANTABLE`
(catalog.ts only; every consumer derives from it).

## Test specification

| # | What is guaranteed | Test | Result |
|---|---|---|---|
| 1 | The 3 GB extras are outside every plan ceiling and state `addon` on starter/pro/enterprise | `test:plan-scope` — "GB Enterprise extras are operator add-ons on EVERY plan" | PASS |
| 2 | No `groupbuy.*` key is ever plan-locked (admin Features lock rule mirrored) | `test:plan-scope` — "no groupbuy.* feature is ever plan-locked" | PASS |

## Regression sweep (all after GREEN)

`test:plan-feature-config` 20/20 · `test:feature-disclosure` 11/11 ·
`test:feature-spotlight` 6/6 · `test:plan-distribution` 9/9 · `test:plan-status`
13/13 · `test:trial-gating` 14/14 · `test:trial-state` 13/13 · `test:trial-expiry`
8/8 · `test:trial-upgrade` 9/9 · `test:reviews` 7/7 · `test:staff` 62/62 ·
`test:track-note` 20/20 · `test:cart` 15/15 · `test:checkout-total` 13/13 ·
`test:gate` 8/8 · `tsc --noEmit` exit 0.

## Known gaps

- `scripts/test-business-package.ts` (unwired — no npm alias) fails 2/10 **before
  and after** this change (verified by stashing the catalog edit): it asserts the
  Business ceiling is exactly 15 features, but the trial system deliberately
  added `storefront.track_note` to Business (`test:track-note` covers that).
  Stale expectation; not touched here.
- No dedicated runtime E2E for the Group Buys manager UI; verification below is
  DB-level plus the existing cart/checkout suites.

## Ops applied (live DB, user-requested)

1. `npm run db:sync-features` → `enterprise: +0 / -3` (removed the 3 extras);
   starter/pro up to date. Pre-verified safe: no saved `plan_features_config`
   row; no tenant had any GB grant (all existing `groupbuy.*` overrides are
   revocations on peppertones / pepstack-davao).
2. dragon-peptides: plan `enterprise → starter`; granted `enabled=true`
   overrides for `groupbuy.module`, `groupbuy.rules`, `groupbuy.scheduled`,
   `groupbuy.multiple_active`, `groupbuy.reports.auto_on_close` (the 12
   building blocks come from the Starter ceiling). Recomputed entitlement
   union: **17/17 `groupbuy.*` keys resolved**.
   Note: entitlements are `unstable_cache`d 5 min — direct DB writes don't bust
   the tag, so the storefront admin may lag up to 5 minutes (or dev-server
   restart).
