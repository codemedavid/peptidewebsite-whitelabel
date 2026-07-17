# TDD evidence — COA + Protocols operator entitlement

**Date:** 2026-07-17 · **Branch:** `feat/trial-system`

## Source plan

No `*.plan.md`. Journeys derived during this run from an operator report: the
Dragon Peptides store admin was showing the **Lab Results (COA)** and
**Protocols** managers even though the operator never switched them on. Root
cause (read-only trace): neither manager had any platform entitlement — the only
gate was the store owner's branding toggle (`brand.showPageCOA` /
`showPageProtocols`, default-on), so every tenant on every plan got both. There
was no `storefront.coa` / `storefront.protocols` key at all.

## User journeys

1. As the platform operator, I want COA and Protocols to be per-tenant features I
   grant (like Reviews), so a Starter tenant doesn't get managers I never enabled.
2. As the platform operator, I want them **default OFF / operator-grantable** (in
   no plan ceiling), never showing "Locked · upgrade plan".
3. As a store owner who was already using COA/Protocols, I want nothing to
   disappear on deploy — existing tenants keep their managers.
4. As the operator, I want Dragon Peptides specifically to be **OFF** (it is the
   store that exposed the bug), while every other existing tenant is granted.
5. As a store owner, once granted, I keep control of page visibility via my
   branding toggle (entitlement AND owner-toggle).

## Design

`storefront.coa` / `storefront.protocols` mirror `storefront.reviews` exactly:
registered in `FEATURES` + `FEATURE_META` (Catalog group), added to
`OPERATOR_GRANTABLE`, in no plan ceiling. The Reviews gate `resolveShowReviews`
was generalized to `resolveEntitledPage(entitled, ownerToggle)` and both new
pages plus Reviews delegate to it. `page.tsx` projects the ANDed result onto
`showPageCOA` / `showPageProtocols`; `MODULE_FEATURE.lab` / `.proto` map the
store-admin modules to the keys. Existing tenants are backfilled a grant
(Dragon Peptides excluded, written OFF explicitly).

## Task report

### Task A — the entitlement (feature registry + gate + projection)

- Registered the two keys, wired `MODULE_FEATURE`, extracted
  `resolveEntitledPage`, projected the gate in `page.tsx`, gated the branding
  toggles in `BrandTweaksForm`.
- **RED:** `npx tsx scripts/test-coa-protocols-feature.ts` → after hardening two
  vacuous `undefined === undefined` assertions to literal strings, **11 failed**
  (keys/meta/grantable/gate/module-map all absent).
- **GREEN:** same command → **PASS, 15 passed, 0 failed.**
- Guarantees: keys exist with Catalog metadata; operator-grantable; in no plan
  ceiling; label distinct from "Product specs"; `lab→storefront.coa`,
  `proto→storefront.protocols`; two-layer gate truth table; `resolveShowReviews`
  behaviourally identical to the shared gate; unentitled tenant's managers hidden.

### Task B — the backfill decision core

- Extracted the grant/revoke/skip logic from `backfill-coa-protocols-grants.ts`
  into the pure `planCoaProtocolsBackfill(...)`, then refactored the script to
  consume it (so the tested copy is the one that runs).
- **RED:** `npx tsx scripts/test-coa-protocols-backfill.ts` against the throwing
  stub → **8 failed** ("not implemented").
- **GREEN:** after implementing the pure function → **PASS, 8 passed, 0 failed.**
- Guarantees: normal tenant granted both (enabled=true); excluded tenant
  (dragon-peptides) written OFF explicitly, not absent; existing override always
  skipped, never clobbered (both for normal and excluded tenants); typo in an
  excluded slug surfaced as `unknownExclusions`; `planned = grants ⊎ revokes`.

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|--------------------|------|------|--------|----------|
| 1 | `storefront.coa`/`storefront.protocols` registered, Catalog metadata, operator-grantable, in no plan ceiling | `scripts/test-coa-protocols-feature.ts` | unit | PASS | `npm run test:coa-protocols` (15/15) |
| 2 | Two-layer gate `resolveEntitledPage`; Reviews delegates unchanged | `scripts/test-coa-protocols-feature.ts` | unit | PASS | same |
| 3 | Unentitled tenant's COA/Protocols managers are hidden (`isAdminViewVisible`) | `scripts/test-coa-protocols-feature.ts` | unit | PASS | same |
| 4 | Backfill grants normals, excludes dragon-peptides OFF, never clobbers existing overrides, flags typo'd slugs | `scripts/test-coa-protocols-backfill.ts` | unit | PASS | `npm run test:coa-protocols-backfill` (8/8) |
| 5 | No regression in sibling feature-flag suites | reviews / plan-scope / trial-gating / trial-expiry / staff | unit | PASS | `npm run test:<name>` all green |

## Coverage and known gaps

- Pure-core assert suites (no coverage instrument in this repo — the project uses
  standalone `tsx` gates, matching `test:reviews` / `test:plan-scope`). Every new
  branch of the gate and the backfill planner is exercised.
- `tsc --noEmit` clean across the change.
- **Not covered by automated tests (integration, deliberate):** the DB-facing
  seam of the backfill script (Prisma `findMany`/`upsert`) and the `page.tsx`
  server projection are validated manually. The backfill is **dry-run by
  default**; a live dry run correctly refused because the `Feature` rows don't
  exist yet (guard fired), pending the two operational steps below.

## Deploy steps (not yet run — require operator go-ahead)

1. `npm run db:sync-features` — creates the two `Feature` rows (also reconciles
   the rest of the catalog; interacts with the pending trial-system sync).
2. `npx tsx scripts/backfill-coa-protocols-grants.ts` (dry) then `--apply` —
   grants every existing tenant except **dragon-peptides** (written OFF).

## Merge evidence (for squash)

RED→GREEN captured above: Task A 11→15 (0 failing), Task B 8→8 (0 failing), all
sibling suites green, `tsc` clean. Behaviour of the backfill script is unchanged
by the Task B refactor — the extracted planner is byte-for-byte the prior inline
logic, now unit-tested.
