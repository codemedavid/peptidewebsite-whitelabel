# TDD evidence — Group Buy product-assignment drift

**Cycle:** 4 on `feat/gb-pricing-tab`
**Siblings:** [gb-report-orders.tdd.md](./gb-report-orders.tdd.md) · [gb-analytics.tdd.md](./gb-analytics.tdd.md) · [gb-e2e.tdd.md](./gb-e2e.tdd.md)
**Suite:** `npm run test:gb-assignment` → `scripts/test-gb-assignment.ts`

## Source

No plan file. The request was:

> "fix the product assignment on the k-glow round"

Investigation changed what "fix" should mean, so the scope was confirmed with the
user before any code was written. See **Scope decision** below.

## What the investigation found

Read-only diagnostics against live k-glow data:

| Round | Assigned | Actually ordered | Overlap | Orders stamped |
|---|---|---|---|---|
| july 28 | Pinealon, MT-2, Semaglutide, Semax, BPC 10+TB 10 | Tirzepatide ×2, Bacteriostatic Water ×3, Tesamorelin ×1 | **none** | **0 / 2** |
| june gb | 25 products (one id points at a deleted product) | — | — | 0 / 0 |

The mechanical cause is duplicate catalog rows — 44 products, 41 distinct names:

| Name | Old row | New row |
|---|---|---|
| Tirzepatide | `cmrwzfa9t…` ₱3,000, stock 0 | `cmryjlstp…` ₱3,200, stock 9 |
| GHK-CU | `cmrwzfdam…` ₱2,480, stock 0 | `cmryjlt7g…` ₱2,000, stock 10 |
| KPV | `cmryjlu0h…` ₱1,595, stock 10 | `cms1pjzxr…` ₱700, stock 30 |

The round holds the **old** Tirzepatide id; customers buy the **new** one. Same
name, different id — indistinguishable in the admin. That is why the failure was
silent: the assignment list looked perfectly valid while every order lost its
group buy *and* its group-buy pricing.

## Scope decision

Both k-glow rounds are closed, so editing their `productIds` would change nothing
for any customer. The user was asked which outcome they wanted and chose
**"Guard against recurrence"** — a tested drift check surfaced in the admin, with
no live data changes. Not chosen (and therefore not done): rewriting the closed
rounds' data, opening a new correctly-assigned round, and de-duplicating the
catalog rows.

## User journeys

1. As a store owner, I want a warning when customers are ordering products my
   round doesn't cover, so I can fix the assignment *before* the round closes.
2. As a store owner, I want to be told when a product assigned to a round no
   longer exists.
3. As a store owner, I want to add the ordered-but-unassigned products in one click.
4. As a store owner running a whole-catalog round, I never want to be warned —
   there is nothing to drift.

## Task report

### RED

```
$ npx tsx scripts/test-gb-assignment.ts
Error: Cannot find module '../src/lib/storefront/group-buy-assignment'
  code: 'MODULE_NOT_FOUND'
```

Compile-time RED: the test references the detector that does not exist yet.
Commit `00bc6bf`.

### GREEN

Implemented `src/lib/storefront/group-buy-assignment.ts`.

```
$ npm run test:gb-assignment
23 passed, 0 failed
```

Commit `8209c96`.

The load-bearing design decision: **drift is detected from behaviour, not from
the assignment list**. Comparing assigned ids against the catalog would have
found nothing wrong with k-glow's "july 28" round — all five products exist. Only
comparing against what customers actually ordered exposes it.

Second decision: `assignedUnsold` is reported but is **not** drift. A round may
legitimately list something nobody has bought yet; warning about that would train
the owner to ignore the banner that matters.

### Integration

`getGroupBuyDashboardAction` now returns `drift`; the round dashboard renders a
warning; `addOrderedProductsToRoundAction` applies the fix. The action recomputes
drift server-side from the round's own orders — the client never supplies the
product list — writes only `productIds`, and revalidates the tenant so storefront
pricing and the on-hand gate recompute. Commit `0a237dd`.

### Regression sweep

```
gb-assignment 23   gb-e2e        50   gb-analytics 37   gb-report        12
gb-report-orders 22  gb-rounds   13   gb-pricing   33   gb-ratio         19
onhand-gate    9   two-ways      18   staff        62
```

298 checks, 0 failures. `npx tsc --noEmit` → 0 errors.

`npm run build`: the first run failed with `Failed to collect page data for
/admin/audit` — an unrelated route that queries the DB during page-data
collection. Two subsequent runs compiled cleanly (`✓ Compiled successfully in
8.8s`), so this is recorded as transient, not as a clean first result.

## Test specification

| # | What is guaranteed | Test | Result |
|---|---|---|---|
| 1 | Every ordered product the round doesn't cover is flagged | `flags every ordered product the round does not cover` | PASS |
| 2 | Drift is reported even when the assigned product is valid | `reports drift even though the assigned product is a VALID product` | PASS |
| 3 | Vials and orders are counted per unassigned product | `counts vials and orders per unassigned product` | PASS |
| 4 | Biggest sellers are listed first | `sorts the biggest sellers first` | PASS |
| 5 | Assigned products with no orders are reported | `reports assigned products nobody ordered` | PASS |
| 6 | A correctly assigned round reports nothing | `a correctly assigned round reports nothing` | PASS |
| 7 | A whole-catalog round can never drift | `a WHOLE-CATALOG round can never drift` | PASS |
| 8 | A round with no orders reports no drift | `a round with no orders yet reports no drift` | PASS |
| 9 | Assigned-but-unsold alone is not drift | `assigned-but-unsold ALONE is not drift` | PASS |
| 10 | An assigned id with no product row is reported | `an assigned id with no product row is reported` | PASS |
| 11 | A dangling id is drift on its own | `a dangling id IS drift on its own` | PASS |
| 12 | A dangling id isn't double-reported as unsold | `a dangling id is not also reported as unsold` | PASS |
| 13 | An empty catalog doesn't mass-flag assignments | `an empty catalog does not mass-flag every assignment` | PASS |
| 14 | A cancelled order doesn't create drift | `a cancelled order does not create drift by itself` | PASS |
| 15 | Cancelled vials never inflate drift counts | `cancelled vials never inflate the drift counts` | PASS |
| 16 | Lines with no productId are ignored | `a line with no productId is ignored` | PASS |
| 17 | The same product across orders aggregates | `the same product across several orders aggregates` | PASS |
| 18 | One order listing a product twice counts once | `one order listing a product twice counts as ONE order` | PASS |
| 19 | The fix keeps existing ids and adds the missing ones | `productsToAssign returns the round's ids plus the missing ones` | PASS |
| 20 | The fix never duplicates an id | `productsToAssign never duplicates an id` | PASS |
| 21 | The fix drops dangling ids | `productsToAssign drops dangling ids while adding the real ones` | PASS |
| 22 | The fix is a no-op without drift | `productsToAssign is a no-op when there is no drift` | PASS |
| 23 | The fix never collapses a round to whole-catalog | `productsToAssign never returns an empty list for an assigned round` | PASS |

Guarantee 23 is the dangerous one: an empty `productIds` means "whole catalog",
so a fix that emptied the list would silently widen a targeted round to every
product in the shop and change storefront pricing across the board.

## Live verification (read-only)

A throwaway diagnostic ran the detector over real k-glow rows, then was deleted.
No writes.

```
── "june gb"  hasDrift=true  wholeCatalog=false
   ordered-but-unassigned: none
   dangling assigned ids : 1
   assigned-but-unsold   : 24
   one-click fix would set productIds: 25 → 24

── "july 28"  hasDrift=true  wholeCatalog=false
   ordered-but-unassigned: Bacteriostatic Water — 5ml(3), Tirzepatide — 30mg × 10 vials(2),
                           Tesamorelin — 10mg × 10 vials(1)
   dangling assigned ids : 0
   assigned-but-unsold   : 5
   one-click fix would set productIds: 5 → 8
```

Both real rounds are correctly detected, and neither was modified.

## Coverage and known gaps

No coverage harness in the repo (no Jest/Vitest), so no percentage. Coverage is
behavioural: 23 checks over the pure detector.

What is **not** covered:

- **The server action and the UI are untested.** `addOrderedProductsToRoundAction`
  and the warning panel are verified by typecheck, build and a live read-only
  run — not by an automated test. The repo has no DB test harness or React
  runner. The pure detector underneath them is fully tested.
- **The button has never been clicked.** Its write path (`updateMany` on
  `productIds` + `revalidateTenant`) is unexercised on real data by design — the
  chosen scope was "no live data changes".
- **k-glow's data is unchanged.** Both rounds still carry their original
  assignment; the warning will appear on the dashboard, and the fix is the
  owner's to apply.
- **Duplicate catalog rows remain.** Tirzepatide, GHK-CU and KPV each still exist
  twice. KPV's two rows differ ₱1,595 vs ₱700, so they may be genuinely different
  sizes rather than duplicates — each needs a human decision before any merge.
- **Only the round dashboard warns.** The management list doesn't show a drift
  badge, so an owner who never opens a round won't see it.

## Merge evidence

| Stage | Commit | Evidence |
|---|---|---|
| RED | `00bc6bf` | `MODULE_NOT_FOUND: group-buy-assignment` |
| GREEN | `8209c96` | `npm run test:gb-assignment` → 23 passed, 0 failed |
| Integration | `0a237dd` | 298 checks green, tsc clean, live k-glow drift detected on both rounds |
