# TDD Evidence — DB-backed COA reports + k-glow Janoshik seed

**Date:** 2026-07-23
**Branch:** main
**Commits:** `96e64a2` (RED) → `6e6f7c4` (GREEN) → `c9f131b` (seed)

## Source plan

No `*.plan.md`; journeys derived during this TDD run from the request:
add 7 Janoshik lab test reports to tenant **k-glow**'s COA (Lab Reports) page.

The request surfaced a latent bug: COA reports were **localStorage-only**
(store `makeSetter("coa", …)`), never persisted to the DB. So seeding data
alone would not surface it — the store ignored any server value and a fresh
device always fell back to the generic `SEED_COA_REPORTS` samples. Same
cross-device class already fixed for protocols / FAQ / payments.

## User journeys

1. As a k-glow **store owner**, I want my 7 Janoshik lab reports to appear on
   the public COA page so customers on **any device** see verified testing.
2. As a **customer**, I want to open a report's official Janoshik verification
   page from the COA card.
3. As **any store owner**, when I add/edit lab reports in `#admin`, they persist
   to the DB (branding.config) so they show on every device — not only the
   editing browser.

## Task report

| Behavior | Validation command | Result | Guarantee |
|---|---|---|---|
| Pure normalizer sanitizes untrusted COA input | `npm run test:coa` | **RED then GREEN** (11/11) | `normalizeCoaReports` never throws, drops garbage/name-less rows, caps counts+lengths, strips non-http(s) URLs |
| COA page-visibility entitlement gate unaffected | `npm run test:coa-protocols` | PASS (15/15) | The STORE_COA/STORE_PROTOCOLS gate still governs page + admin manager visibility |
| Whole program typechecks | `tsc --noEmit` | PASS (no errors) | New action/type/store wiring compiles |
| 7 reports live on k-glow COA page | Browser @ `k-glow.lvh.me:3100/#coa` | PASS | All 7 render with cert thumbnails, purity badges, Janoshik verify links |

### RED evidence

```
$ npm run test:coa    # after 96e64a2, before 6e6f7c4
Error: Cannot find module '../src/lib/storefront/coa'
```

Compile-time RED: the new test references `src/lib/storefront/coa.ts`, which did
not exist — the failure is caused by the intended missing implementation.

### GREEN evidence

```
$ npm run test:coa
Storefront COA — pure core (normalizeCoaReports)
  ✓ non-array input collapses to [] (never throws)
  ✓ garbage array entries are dropped, not thrown on
  ✓ entries with a blank/absent name are dropped
  ✓ a full report round-trips its fields
  ✓ missing optional fields default to empty strings
  ✓ a missing id is backfilled with a stable, unique id
  ✓ javascript: / data: / garbage URLs are stripped to empty
  ✓ http and https URLs are preserved
  ✓ report count is capped at MAX_COA_REPORTS
  ✓ name is capped at MAX_COA_NAME chars
  ✓ lab / date / purity are capped at MAX_COA_TEXT chars
11 passed, 0 failed

$ npm run test:coa-protocols
PASS — 15 passed, 0 failed.
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Malformed COA config never throws; collapses to `[]` | `scripts/test-coa.ts` | unit | PASS |
| 2 | Name-less / garbage rows are dropped | `scripts/test-coa.ts` | unit | PASS |
| 3 | Clean report round-trips all fields | `scripts/test-coa.ts` | unit | PASS |
| 4 | `javascript:` / `data:` URLs stripped from image/link (fail-closed) | `scripts/test-coa.ts` | unit | PASS |
| 5 | Count + string lengths capped | `scripts/test-coa.ts` | unit | PASS |
| 6 | COA page/admin visibility still gated by STORE_COA | `scripts/test-coa-protocols-feature.ts` | unit | PASS |
| 7 | 7 Janoshik reports render live on k-glow COA page | manual browser | e2e | PASS |

## Implementation

- `src/lib/storefront/coa.ts` — `normalizeCoaReports` pure core (reuses
  `safeHttpUrl` from `hero-links`).
- `src/actions/storefront-admin.ts` — `saveCoaReportsAction` (read-modify-write
  `branding.config.coaReports`, permission `lab`), mirroring
  `saveProtocolsAction`.
- `src/storefront/types.ts` — `Brand.coaReports?: CoaReport[]` (server-derived).
- `src/storefront/store.tsx` — seed from `brandSeed.coaReports`; drop the
  localStorage hydration + localStorage-only setter; `setCoaReports` persists to
  the DB.
- `scripts/seed-kglow-coa.ts` — re-hosts the 7 Janoshik certificates to k-glow's
  ImageKit folder and writes `coaReports`; `storefront.coa` granted to k-glow.

## Coverage & known gaps

- The pure core is fully covered by `scripts/test-coa.ts` (custom tsx harness,
  matching the repo's `test:*` convention — this project has no Jest/Vitest).
- The store setter and server action are exercised end-to-end via the live
  browser check rather than a mocked unit test (consistent with how
  protocols/FAQ persistence is verified in this repo).
- Data seed used direct DB writes (script), which do not bust Next's
  `unstable_cache`; a dev-server restart / 5-min TTL is required before the
  change is visible (documented behavior).
