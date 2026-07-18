# TDD Evidence — Code-review fixes (GB supplier report + upgrade approval + spotlight)

**Source plan:** inline `/ecc:plan` output ("Fix code-review findings"), option **B** (all four). Companion docs: `gb-storefront-banner.tdd.md`, `gb-rounds-access-code.tdd.md`, `trial-upgrade.tdd.md`.

## Findings addressed (from `/code-review low`)

1. **Duplicate/driftable aggregation** in `getGroupBuySupplierReportAction` — `buildSupplierReport` ran twice over the same orders (directly + inside `prepareReport`), and the two number sets could diverge.
2. **Check-then-act race** in `decideUpgradeRequestAction` — status guard on a pre-transaction `findUnique`; two concurrent approvals both pass.
3. *(verify-first)* `scopedCatalog` filters on exact `id` — could drop variation clones.
4. *(perf)* Sequential `hasFeature` loop in `page.tsx` spotlight whose results are unused during an active trial.

## User journey

> As a store operator, I download a group-buy supplier workbook and expect its
> totals to match exactly what the report screen showed; and as a platform
> operator, when I approve an upgrade I expect a double-click (or a teammate
> clicking at the same time) to apply the plan flip exactly once.

## Task report

| Task | Summary | Command | Result |
|---|---|---|---|
| 1 RED | Sentinel-injected `SupplierReport` must drive the summary/totals; `prepareReport` ignored a prebuilt report | `npm run test:gb-report` | FAIL 11/12 — "summary comes from the injected report" (commit `test: reproducer…`) |
| 1 GREEN | `prepareReport(round, orders, report?)` optional param (default builds it); action passes its already-built report | `npm run test:gb-report` | PASS 12/12 (commit `fix: reuse the prebuilt supplier report…`) |
| 2 | `decideUpgradeRequestAction` decides inside an interactive `$transaction` via conditional `updateMany(where:{id,status:'pending'})`; `count===0` ⇒ "already decided" | `npx tsc --noEmit`, `npm run test:trial-upgrade` | tsc clean; 9/9 (commit `fix: make upgrade approve/reject atomic…`) |
| 3 | Verified variation clones are cart-only (`store.tsx:443 makeVariationEntry`); the catalog `products` array is one entry per product with its real `id`. **Non-bug — no change.** | code trace | closed |
| 4 | Skip the spotlight `hasFeature` loop when `trialActive` (predicate unused then) | `npm run test:feature-spotlight`, `npx tsc --noEmit` | 6/6; tsc clean (commit `perf: skip the spotlight entitlement loop…`) |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | `prepareReport` uses an injected `SupplierReport` for the summary + report-derived totals instead of re-aggregating (no drift) | `test-gb-report.ts:prepareReport uses the injected report instead of re-aggregating` | unit | PASS |
| 2 | Omitting the report keeps identical behavior (default aggregation) | existing `test-gb-report.ts` prepareReport cases | unit | PASS (12/12) |
| 3 | Upgrade state machine: only pending → approved/rejected, decisions final | `test-trial-upgrade.ts` | unit | PASS (9/9) |
| 4 | `pickFeatureSpotlight` selection unchanged (trial vs entitlement branches) | `test-feature-spotlight.ts` | unit | PASS (6/6) |

## Coverage and known gaps

- No `test:coverage` in this repo — suites are hand-rolled `tsx` + `node:assert` runners; coverage is per-behavior, not instrumented.
- **Finding 2 has no unit test.** The fix is DB-level atomicity inside a `"use server"` action; the repo does not mock Prisma, and sibling actions (`saveGroupBuyAction`, `downgradeToStarterAction`) are likewise validated by `tsc` + their pure cores, not by action-level unit tests. The pure transition rule it builds on (`canTransitionUpgrade`) is covered by `test:trial-upgrade`. The atomic guarantee rests on the conditional `updateMany` + `count` check, verified by inspection.
- **Finding 3** produced no code change (verified non-bug). Documented here so the review item is closed with a reason.

## Regression sweep (post-change)

`gb-report 12` · `gb-banner 10` · `feature-spotlight 6` · `trial-upgrade 9` · `gb-rounds 13` · `plan-scope 19`; `tsc --noEmit` 0 errors.

## Merge evidence (RED→GREEN)

- Finding 1: RED `test-gb-report.ts` (sentinel not reflected) → GREEN optional `report` param + action reuse.
- Finding 2: structural fix (interactive `$transaction` + conditional flip); tsc + `test:trial-upgrade` green.
- Finding 4: behavior-preserving guard; `test:feature-spotlight` green.
