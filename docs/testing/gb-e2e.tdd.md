# TDD evidence — Group Buy end-to-end lifecycle

**Cycle:** 3 of 3 on `feat/gb-pricing-tab`
**Siblings:** [gb-report-orders.tdd.md](./gb-report-orders.tdd.md) (the order-resolution fix),
[gb-analytics.tdd.md](./gb-analytics.tdd.md) (the per-round dashboard)
**Suite:** `npm run test:gb-e2e` → `scripts/test-gb-e2e.ts`

## Source

No plan file. Journeys derived directly from the user's request:

> "do an ece testing make sure to test if the groupbuy is created and open in the
> storefront the users can order in the opened groupbuy and their groupbuy orders
> will be in the groupbuy opened order details not anywhere else so its organized
> and see if the data is correct and will not be counted if theres a cancelled
> order and check if the export excel file data is correct"

The first two cycles proved each module in isolation. This one proves they hold
together as one chain, and closes the gap neither could reach: the bytes of the
actual `.xlsx`.

## User journeys

1. As a store owner, I create a group buy so customers can order into it.
2. As a customer, I see the round open on the storefront and place an order.
3. As a store owner, I open that round and see its orders — all of them, and
   only them.
4. As a store owner, I trust the totals: a cancelled order is visible but never
   inflates what I buy from the supplier.
5. As a store owner, I export the round to Excel and send it to my supplier
   without re-checking it against the screen.

## Why a lifecycle test, not more unit tests

The k-glow bug was not a broken function. Every function was correct in
isolation; the defect lived in the *seam* — checkout stamped `groupBuyId = NULL`
when the owner's product assignment didn't match what customers bought, and the
report filtered on that column. Unit tests on either side passed while the live
report read `0 orders · 0 units · ₱0`.

So the fixture is that seam, deliberately: `KG-2002` buys RT20 + CGL5, which the
round never assigned, so checkout stamps NULL. It must still appear on the
round's page.

**Proof the fixture reproduces the real bug** (replaying the old rule over it):

```
OLD attribution-only rule → 0 orders · 0 units · PHP 0
NEW window-fallback rule  → 4 orders · 74 units · PHP 71700
```

Without this, a suite of green checks would prove nothing about the defect it
claims to cover.

## The fixture

Two rounds and six tenant-wide orders. Vial totals are the user's own worked
example — TR30 = 37, RT20 = 22, CGL5 = 15.

| Round | Status | Window | Assigned |
|---|---|---|---|
| TR30 Batch #1 | closed | −30d → −20d | TR30 |
| TR30 Batch #2 | **active** | −1d → +6d | TR30, min 20 / max 100 |

| Order | Round | `groupBuyId` | Status | Vials | Value | Why it's here |
|---|---|---|---|---|---|---|
| KG-2001 | B | stamped | confirmed / paid | 20 | ₱24,000 | the ordinary path |
| KG-2002 | B | **NULL** | pending | 37 | ₱27,300 | the k-glow seam |
| KG-2003 | B | stamped | **cancelled** / paid | 17 | ₱20,400 | paid *then* cancelled |
| KG-2004 | B | stamped | pending | 17 | ₱20,400 | repeat customer (KG-2001) |
| KG-1001 | A | NULL | completed | 5 | ₱6,000 | must never leak into B |
| KG-0001 | — | NULL | pending | 9 | ₱10,800 | inside no window → unlinked |

Round B truth: 4 orders (3 active, 1 confirmed, 2 pending, 1 cancelled),
**74 vials**, **₱71,700**, 2 participants.

Dates are offsets from `new Date()`. A hardcoded date silently expires and turns
"the round is open" into "the round closed" — that exact time bomb already bit
`test-onhand-gate.ts`.

## Task report

### RED

`npx tsx scripts/test-gb-e2e.ts`

Sections 1–6 passed (32 checks) because they exercise code the earlier two cycles
already shipped. Section 7 failed:

```
7. The exported Excel file matches the screen
/scripts/test-gb-e2e.ts:546
  const wb = await buildSupplierWorkbook(prep);
                   ^
TypeError: (0 , import_supplier_workbook.buildSupplierWorkbook) is not a function
```

This is the honest RED. `supplier-workbook.ts` built the workbook and downloaded
it in one function that touches `Blob`, `document` and `URL` — browser-only, so
no test could serialize it. The Excel file the owner sends the supplier had never
been verified by anything except reading the code.

### GREEN

Split the serializer from the download. `buildSupplierWorkbook(prep)` returns the
`Workbook`; `downloadSupplierWorkbook(prep)` calls it and hands the bytes to the
browser. Both existing callers (`AdminGroupBuys.tsx:514`,
`AdminGroupBuyDetail.tsx:151`) keep the identical signature. The new
`import type { Workbook }` is erased at compile time, so exceljs stays lazy and
out of the storefront bundle.

```
$ npm run test:gb-e2e
50 passed, 0 failed
```

The export section now writes real `.xlsx` bytes, loads them into a **fresh**
workbook, and reads cells back — not the object it just built.

### Regression sweep

```
gb-e2e        50   gb-analytics  37   gb-report     12   gb-report-orders 22
gb-rounds     13   gb-banner     10   gb-content    31   gb-pricing       33
gb-ratio      19   onhand-gate    9   two-ways      18   order-detail     17
payment-proof  6   staff         62
```

339 checks, 0 failures. `npx tsc --noEmit` → 0 errors. `npm run build` → compiles.

## Test specification

| # | What is guaranteed | Test | Result |
|---|---|---|---|
| 1 | A saved round survives the DB round-trip with batch, min and max intact | `the saved round survives the DB round-trip intact` | PASS |
| 2 | An open round is not stamped with a closed date | `an open round is NOT stamped with a closed date` | PASS |
| 3 | The round reads active and the owner sees "Open" | `the round reads active, and the owner sees it as Open` | PASS |
| 4 | Exactly one round is live; a finished one is not | `it is the ONE live round` | PASS |
| 5 | A finished round accepts no new orders | `the finished round reads Completed and takes no new orders` | PASS |
| 6 | A cancelled round never re-opens inside a live window | `a CANCELLED round never re-opens` | PASS |
| 7 | The storefront gate shows the round live over its product | `the storefront gate shows the round live` | PASS |
| 8 | Customers can add the group-buy product to the cart | `customers can add the group-buy product to the cart` | PASS |
| 9 | With on-hand paused, only non-round products are blocked | `only non-round products are blocked` | PASS |
| 10 | Checkout stamps the live round onto an assigned-product order | `checkout stamps the live round` | PASS |
| 11 | Checkout stamps NULL when the cart misses the assignment | `checkout stamps NULL … (the k-glow bug)` | PASS |
| 12 | The round shows exactly its own four orders | `the open round shows exactly its own four orders` | PASS |
| 13 | The NULL-stamped order still appears | `the unattributed order still appears` | PASS |
| 14 | Another round's order never leaks in | `the finished round's order never leaks in` | PASS |
| 15 | An order under no round is not invented into one | `an order placed under no round is not invented into one` | PASS |
| 16 | The orphan is surfaced as unlinked, not dropped | `the orphan is surfaced as unlinked` | PASS |
| 17 | No order is counted by two rounds | `no order is ever counted by two rounds` | PASS |
| 18 | Every tenant order is accounted for exactly once | `every tenant order is accounted for exactly once` | PASS |
| 19 | Overview: batch, status, product, orders, participants | `overview: batch, status, participants, orders` | PASS |
| 20 | A repeat customer counts once | `a repeat customer counts as one participant` | PASS |
| 21 | Progress reads 74/100 with the minimum met | `progress reads 74 of 100 with the minimum met` | PASS |
| 22 | Financials: gross, confirmed, pending, collected, outstanding | `financials: gross, confirmed, pending…` | PASS |
| 23 | **INVARIANT** gross === confirmed + pending | `INVARIANT gross income === confirmed + pending` | PASS |
| 24 | **INVARIANT** total vials === confirmed + pending | `INVARIANT total vials === confirmed + pending` | PASS |
| 25 | Vial split 20 / 54 / 17 cancelled | `vials split` | PASS |
| 26 | Products to order = 37 / 22 / 15 | `products to order match the worked example` | PASS |
| 27 | Products to order sum to the headline vials | `products to order sum to the headline vial count` | PASS |
| 28 | The list row equals the page you click into | `the management list row agrees with the page` | PASS |
| 29 | Rows carry name, contact, address, batch, method, proof | `every order row carries the full customer detail` | PASS |
| 30 | A multi-product order yields one row per product | `a multi-product order produces one row per product` | PASS |
| 31 | Filters AND together and stay inside the round | `the orders table filters narrow within the round only` | PASS |
| 32 | Paid-then-cancelled reads Cancelled, never Confirmed | `paid-then-cancelled reads Cancelled` | PASS |
| 33 | The cancelled order stays listed, flagged not counted | `the cancelled order is still listed` | PASS |
| 34 | Counted in total orders, not in active orders | `counted in total orders but not in active orders` | PASS |
| 35 | Its vials never reach the supplier order | `its vials never reach the supplier order` | PASS |
| 36 | **DELTA** un-cancelling adds back exactly ₱20,400 / 17 vials | `DELTA: un-cancelling adds back exactly…` | PASS |
| 37 | **DELTA** cancelling drops that participant | `DELTA: cancelling drops the participant` | PASS |
| 38 | The file is named after this round only | `the file is named after this round only` | PASS |
| 39 | The workbook really opens with the expected sheets | `the workbook really opens` | PASS |
| 40 | Totals sheet cells match the dashboard | `Totals sheet: vials and sales match the dashboard` | PASS |
| 41 | 37 / 22 / 15 appear in the actual cells | `Products to Order sheet: 37 / 22 / 15` | PASS |
| 42 | The TOTAL row is the supplier order (74) | `the TOTAL row is the supplier order` | PASS |
| 43 | The summary block carries gross income and the order mix | `the summary block carries gross income` | PASS |
| 44 | One sheet row per order line, cancelled included | `one row per order line, cancelled included` | PASS |
| 45 | Customer detail lands in the right columns | `full customer detail lands in the right columns` | PASS |
| 46 | The cancelled line is marked Counted = No | `the cancelled line is present and marked not counted` | PASS |
| 47 | The proof cell is a hyperlink, not a download | `the proof is a clickable link, not a download` | PASS |
| 48 | The export contains no order from another round | `the export contains NO order from another round` | PASS |
| 49 | Workbook totals equal the on-screen totals | `EXPORT PARITY: the workbook totals equal…` | PASS |
| 50 | The file agrees with `buildProductsToOrder` directly | `EXPORT PARITY: the file agrees with…` | PASS |

## Live verification (read-only)

A throwaway diagnostic ran the same walk over real k-glow rows and was deleted
afterwards. No writes.

```
Tenant: K Glow (k-glow) — 2 rounds · 3 orders total

── "june gb" [Completed]  0 orders · 0 vials · PHP 0
   INVARIANTS gross=true vials=true products-to-order=true
   EXCEL file-total=0 screen-total=0 leaked-orders=0 → OK

── "july 28" [Completed]  2 orders (2 confirmed) · 6 vials · gross PHP 22,304
   participants 2 · unlinked-elsewhere 1 · rows 5
   INVARIANTS gross=true vials=true products-to-order=true
   EXCEL file-total=6 screen-total=6 leaked-orders=0 → OK

ISOLATION: orders claimed by >1 round → 0
ALL LIVE CHECKS PASSED
```

## Coverage and known gaps

The repo has no coverage harness (no Jest/Vitest), so no percentage is reported.
Coverage here is behavioural: 50 checks across all seven stages of the chain.

Stated plainly, what this does **not** prove:

- **Not proven on live data:** k-glow currently has no cancelled order and no
  open round (both read Completed), so the cancellation rule and the
  open-storefront path are proven by the fixture only.
- **No browser test.** The repo has no React test runner or Playwright, so the
  dashboard, the filters and the proof lightbox are verified by typecheck, build
  and reading the render paths — not by clicking them.
- **The download itself is untested.** `buildSupplierWorkbook` is now covered;
  the `Blob`/`URL.createObjectURL`/`a.click()` wrapper around it still needs a
  browser.
- **KG-0001 stays unlinked.** It was placed when no round was live. Reported as
  `unlinked` rather than assigned — correct, but it means one real order sits in
  no report.
- **The underlying k-glow product drift is untouched.** Customers buy products
  the owner never assigned to the round, which is why checkout stamps NULL. The
  report now copes; the assignment is still worth fixing in Group Buys → Pricing,
  because those customers also miss group-buy pricing at checkout.

## Merge evidence

| Stage | Commit | Evidence |
|---|---|---|
| RED | `23599d4` | `TypeError: buildSupplierWorkbook is not a function` — sections 1–6 pass, 7 fails |
| GREEN | `b64cbe9` | `npm run test:gb-e2e` → 50 passed, 0 failed |
| Docs | this file | 339 checks across 14 suites, tsc clean, build compiles |
