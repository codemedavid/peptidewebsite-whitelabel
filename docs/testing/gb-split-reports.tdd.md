# TDD Evidence — Group buy end-of-round reports (supplier + customer)

**Branch:** `feat/brand-splash`
**Date:** 2026-08-21
**Source plan:** produced inline via `/ecc:plan`; user confirmed **Option A** (two separate `.xlsx` files).

## What was asked

> Every time a group buy is finished it should have a report on it — customer details and
> order details downloadable as an Excel file, and another report for the supplier: the
> products ordered, each with how many vials to order from the supplier.

## What already existed (verified before writing code)

Most of the chain shipped previously and was **not** rebuilt:

| Piece | Where |
|---|---|
| Per-round report action | `src/actions/group-buys.ts` → `groupBuyReportAction` |
| Excel download, lazy `exceljs` | `src/storefront/admin/supplier-workbook.ts` |
| Product → vials to order | `buildProductsToOrder` (`src/lib/storefront/group-buy-orders.ts:255`) |
| Order lines w/ customer, address, proof | `buildRoundOrderRows` (same file) |

Entitlements were checked against the live DB before any code was written — all three
group-buy tenants already had the flags on, so the flags were **not** the gap:

```
dragon-peptides      module=ON  supplier=ON  excel=ON  customers=ON  autoClose=ON
k-glow               module=ON  supplier=ON  excel=ON  customers=ON  autoClose=ON
peptide-groupbuy     module=ON  supplier=ON  excel=ON  customers=ON  autoClose=off
```

## The four real gaps

1. **The Excel workbook had no customer sheet at all.** The per-customer section existed in
   the CSV and PDF exports only; the `.xlsx` silently omitted it.
2. **One workbook, not two.** Sending the supplier the order meant sending every buyer's
   name, phone, shipping address, payment-proof link and the store's gross income with it.
3. **The customer aggregation was inlined in the server action**, duplicating the demand rule
   the workbook uses — free to drift.
4. **"Every finished round"** relied on a one-shot popup deduped in `localStorage`, so a
   manager on a second device, a staff account, or a cleared browser never saw it.

## User journeys

1. As a store owner, when a group-buy round finishes, I want to see at a glance that its
   reports are waiting, so I don't have to remember which rounds have closed.
2. As a store owner, I want one Excel file I can forward to my supplier untouched, showing
   each product and how many vials to order — and nothing about my customers or my margin.
3. As a store owner, I want a second Excel file with every buyer, what they ordered, what
   they owe and where it ships, so I can fulfil and reconcile.

## Task report

### Task 1 — Per-buyer aggregation (`buildCustomerLines`)

Repeat orders from the same person merge on `email || phone || name` (lowercased); cancelled
orders are excluded on the same `orderCountsAsDemand` rule the supplier lines use; sorted
biggest-spender first. Contact number and shipping address ride along for fulfilment.

- **RED:** `npm run test:gb-report` → `11 passed, 9 failed` —
  `(0 , import_group_buy_report.buildCustomerLines) is not a function`
- **GREEN:** `npm run test:gb-report` → `20 passed, 0 failed`

### Task 2 — Split the workbook in two

`buildSupplierWorkbook` now emits `Products to Order` + `Product Summary` only.
`buildCustomerWorkbook` emits `Summary` + `Customers` + `Orders`.

- **RED:** `npm run test:gb-e2e` → crash at step 7,
  `(0 , import_supplier_workbook.buildCustomerWorkbook) is not a function`
- **GREEN:** `npm run test:gb-e2e` → `56 passed, 0 failed`

The privacy assertions serialize the supplier workbook to real bytes, reload it, and sweep
every cell for `Erika|Santos|0917|Mabini|imagekit` and for any row labelled
`income|sales|revenue`. Both must come back empty.

### Task 3 — One aggregation, one meaning

`groupBuyReportAction` calls `buildCustomerLines` instead of re-aggregating inline;
`GroupBuyCustomerLine` is now an alias of `ReportCustomerLine`. The screen and the download
read the same rows by construction.

- **GREEN:** `npx tsc --noEmit` clean; all gb-* suites unchanged.

### Task 4 — Flag every finished round (`roundsAwaitingReport`)

Derives finished-but-unarchived rounds through `effectiveGroupBuyStatus` (no cron exists — a
window lapses silently). The rounds list promotes that round's button to a solid
**"Reports ready"** badge that persists until the round is archived. Needs no stored state,
so it survives a different device, a staff login and a cleared browser. The paid
`auto_on_close` popup remains on top of it.

- **RED:** `npm run test:gb-report` → `20 passed, 8 failed` —
  `roundsAwaitingReport is not a function`
- **GREEN:** `npm run test:gb-report` → `28 passed, 0 failed`

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | The same buyer's two orders merge into one row | `test-gb-report.ts:one row per customer — the same buyer's two orders merge` | unit | PASS |
| 2 | `ANN@x.io` and `ann@x.io` are one customer | `test-gb-report.ts:the merge key is case-insensitive on email` | unit | PASS |
| 3 | A cancelled-only buyer never reaches the report | `test-gb-report.ts:a cancelled-only customer never reaches the report` | unit | PASS |
| 4 | An emailless buyer is kept, keyed on phone | `test-gb-report.ts:a customer with no email still gets a row, keyed on phone` | unit | PASS |
| 5 | Contact + shipping address reach the sheet | `test-gb-report.ts:contact and shipping address ride along for fulfilment` | unit | PASS |
| 6 | Rows sort biggest spender first | `test-gb-report.ts:rows are sorted biggest spender first` | unit | PASS |
| 7 | No orders yields `[]`, not a crash | `test-gb-report.ts:no orders means an empty list, not a crash` | unit | PASS |
| 8 | The two files never overwrite each other | `test-gb-report.ts:the two reports are named apart…` | unit | PASS |
| 9 | Supplier file holds exactly `Products to Order` + `Product Summary` | `test-gb-e2e.ts:the SUPPLIER workbook opens and holds only product sheets` | integration | PASS |
| 10 | Customer file holds exactly `Summary` + `Customers` + `Orders` | `test-gb-e2e.ts:the CUSTOMER workbook opens with summary, customers and orders` | integration | PASS |
| 11 | **Supplier file leaks no name, phone, address or proof link** | `test-gb-e2e.ts:PRIVACY: the supplier file leaks no customer name, phone or address` | integration | PASS |
| 12 | **Supplier file carries no revenue figure** | `test-gb-e2e.ts:PRIVACY: the supplier file carries no revenue figure` | integration | PASS |
| 13 | Erika's two orders merge in the real `.xlsx` cells (2 orders / 37 vials / ₱44,400) | `test-gb-e2e.ts:Customers sheet: one row per buyer — Erika's TWO orders merge` | integration | PASS |
| 14 | The cancelled buyer is absent from Customers | `test-gb-e2e.ts:Customers sheet: the cancelled buyer is not owed anything` | integration | PASS |
| 15 | Customers TOTAL reconciles with the dashboard | `test-gb-e2e.ts:Customers sheet: the TOTAL row reconciles with the dashboard` | integration | PASS |
| 16 | Vials to order read 37 / 22 / 15 in the actual cells | `test-gb-e2e.ts:Products to Order sheet: 37 / 22 / 15 in the actual cells` | integration | PASS |
| 17 | A lapsed or closed round is flagged; live/draft/scheduled are not | `test-gb-report.ts:roundsAwaitingReport` (8 checks) | unit | PASS |
| 18 | Archived and cancelled rounds stop being chased | `test-gb-report.ts:an ARCHIVED round…` / `a CANCELLED round…` | unit | PASS |

## Full suite result

```
gb-report              28 passed, 0 failed
gb-report-orders       22 passed, 0 failed
gb-e2e                 56 passed, 0 failed
gb-analytics           37 passed, 0 failed
gb-rounds              13 passed, 0 failed
gb-ratio               34 passed, 0 failed
gb-content             31/31 checks passed
gb-cart-doses          22 passed, 0 failed
group-buy-page         51 passed, 0 failed
group-buy-pricing      19 passed, 0 failed
gb-assignment          23 passed, 0 failed
gb-banner              10 passed, 0 failed
gb-pricing             33 passed, 0 failed
plan-scope             19 passed, 0 failed
npx tsc --noEmit       clean
```

## Known gaps

- **`npm run build` was not run.** A dev server was live; a concurrent build clobbers
  `.next/` and 500s the running server. `tsc --noEmit` is clean, which covers the type
  surface. Run the build once the dev server is down.
- **No schema change, no `db:push` needed.** `roundsAwaitingReport` derives closure from the
  existing window rather than stamping a new `reportReadyAt` column — deliberate, given the
  pending `db:push` backlog.
- **Still no cron.** A round's window lapses silently and is only noticed when someone loads
  the admin. The badge makes that harmless (it persists until archived) but "the instant it
  closes" would need a scheduled job.
- **CSV and PDF exports were left as-is.** They already carried the per-customer section and
  still pass; they were not re-split into two files.

## Checkpoint commits

| Stage | Commit |
|---|---|
| RED | `2e92055` test(storefront): reproducer for the split customer + supplier GB reports |
| GREEN | `4c919a8` feat(storefront): split the group-buy report into supplier and customer workbooks |
| GREEN | `1786b37` feat(storefront): flag every finished group buy until its reports are pulled |
| REFACTOR | `8679301` refactor(storefront): retitle the group-buy report modal |

---

# Follow-up (same day) — live verification on k-glow

Running the finished reports against k-glow's real database surfaced two further
problems. Both are recorded here because they were found *by* this work and fixed
under the same RED/GREEN discipline.

## Finding 1 — a round was renamed and reused, not replaced

k-glow's "Group buy batch 3" held **7** orders. Five of them were `shipped` and
carried checkout snapshots reading `Group buy batch 2` / `Group buy 08/02 batch 2`;
the round's window (08-19 → 08-25) opened five days *after* the last of them was
placed (08-14 13:02). The owner had edited a live round's name and window instead
of closing it and creating a new one, so a fulfilled run's orders stayed attached.

The batch-3 supplier order therefore read **43 vials** when only **8** were actually
outstanding — 35 had already been bought and shipped.

**Fix:** `scripts/split-reused-gb-round.ts` — dry-run by default, `--apply` to write.
It detects strays by the one piece of evidence that survives a rename (the order's
own `groupBuyName` snapshot, stamped at checkout and never rewritten), reconstructs
a **closed** round spanning them, and re-points only those orders. Snapshots are
never edited. Blank snapshots are left alone — they prove nothing.

Applied to k-glow on 2026-08-21:

```
"Group buy batch 2"  (closed, new: cmt2l1bd10001molfdolcxhas)  5 orders · 35 vials · PHP 84,330
"Group buy batch 3"  (active)                                  2 orders ·  8 vials · PHP 19,181.40
DOUBLE-COUNT CHECK: 7 distinct orders across all 5 rounds → PASS
```

## Finding 2 — product variations collapsed into one supplier line (CRITICAL)

Verifying the split exposed a far worse, long-standing bug. A product's variations
(5ml / 10ml / 3ml…) are Product clones that all carry the **same `productId`**,
distinguished only by a `variation` label. Every report surface keyed on `productId`
alone, so different SKUs merged into one row labelled by whichever arrived first.

Live k-glow batch 2 read:

```
14 × Bacteriostatic Water — 5ml
```

when the round actually needed:

```
 4 × Bacteriostatic Water — 5ml             @510
 4 × Bacteriostatic Water — 10ml            @732
 3 × Bacteriostatic Water — 3ml             @488
 3 × Bacteriostatic Water — 3ml bac 5 vials @245
```

Sending that orders fourteen of the wrong size and none of the other three. It hit
**5 of that round's 11 rows** — also Tirzepatide (3 SKUs → 1), Retatrutide (3 → 1),
GHK-CU (2 → 1) and HHB (2 → 1). The vial *total* was always right, which is why it
went unnoticed: only the split was wrong.

**Fix:** `productLineKey()` in `src/lib/storefront/group-buy.ts` is now the single SKU
identity, shared by `buildSupplierReport`, `buildProductsToOrder` and `prepareReport`'s
per-SKU order counts. The `productId` still leads, so a mid-round rename does not split
a line; items with no `productId` still fall back to the name.

- **RED:** `npm run test:gb-report` → `32 passed, 4 failed` —
  `expected 4 SKUs, got Bacteriostatic Water — 5ml`
- **GREEN:** `npm run test:gb-report` → `36 passed, 0 failed`

### Added guarantees

| # | What is guaranteed | Test | Result |
|---|---|---|---|
| 19 | Each variation gets its own supplier line | `buildSupplierReport keeps each variation on its own line` | PASS |
| 20 | The four bac-water SKUs read 4/4/3/3, not 14 | `buildProductsToOrder gives the supplier one row per variation` | PASS |
| 21 | Variation rows still sum to the headline vial count | `the variation rows still sum to the headline vial count` | PASS |
| 22 | Product Summary carries every variation too | `Product Summary carries every variation too, none swallowed` | PASS |
| 23 | Per-variation order counts aren't copied from the base | `per-variation order counts are right…` | PASS |
| 24 | **A mid-round rename still does NOT split a line** | `a product with NO variations still groups by productId (no regression)` | PASS |
| 25 | Same variation label on different products never merges | `two variations of DIFFERENT products never merge` | PASS |
| 26 | Legacy items with no productId still fall back to name | `legacy items with no productId still fall back to the name` | PASS |

### Live re-verification after the fix

```
Group buy batch 2 — 20 rows, 35 vials   (was 11 collapsed rows)   RECONCILE PASS
Group buy batch 3 —  7 rows,  8 vials                             RECONCILE PASS
```

## Follow-up commits

| Stage | Commit |
|---|---|
| RED | `e6e1018` test(storefront): reproducer for variations collapsing into one supplier line |
| GREEN | `519c181` fix(storefront): never collapse product variations into one supplier line |

## Still open

- **Other tenants are affected too.** `dragon-peptides` (88 GB products, many with
  variations) and `hpglow` have never been checked against the corrected grouping.
  Any supplier order placed from a past report may have been mis-split the same way.
- The three empty k-glow rounds (`june gb`, `july 28`, `check out now`) remain
  unarchived, so they still show "Reports ready". Archiving them clears it.
