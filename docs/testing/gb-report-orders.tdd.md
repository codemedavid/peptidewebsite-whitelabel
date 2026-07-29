# TDD evidence — Group Buy report shows 0 orders (k-glow)

**Date:** 2026-07-29
**Branch:** `feat/gb-pricing-tab`
**Commits:** `b015877` (RED) → `be10fac` (GREEN)
**Source plan:** none — journeys were derived during this TDD run from the user's bug report.

---

## The defect

K Glow's Group Buy report rendered:

```
0 orders · 0 units · ₱0
No orders were placed under this group buy yet.
```

…while the tenant had three real, paid orders in the database.

## Root cause

`getGroupBuySupplierReportAction` selected a round's orders with a single clause:

```ts
// src/actions/group-buys.ts:420 (before)
where: { groupBuyId: gbId }
```

`StorefrontOrder.groupBuyId` is stamped **once**, at checkout, by `groupBuyForOrder()`
(`src/actions/orders.ts:451`). That function only returns a round when an ordered
`productId` appears in the round's `productIds` assignment. Nothing ever backfills
the column afterwards.

Live data confirmed the mismatch:

| Round | Window | Assigned products |
|---|---|---|
| `june gb` | 2026-07-21 → 07-25 | 25 (1 stale) |
| `july 28` | 2026-07-28 → 07-30 | 5 — Pinealon, MT-2, Semaglutide, Semax, BPC10+TB10 |

| Order | Placed | Status | Products ordered | `groupBuyId` |
|---|---|---|---|---|
| KG-1001 | 2026-07-26 | confirmed / paid | Bac Water, Tirzepatide | **NULL** |
| KG-1002 | 2026-07-29 | new / paid | Tirzepatide, Bac Water | **NULL** |
| KG-1003 | 2026-07-29 | new / paid | Tirzepatide, Tesamorelin, Bac Water | **NULL** |

Nobody ordered any of the 5 assigned products, so every order was stamped `NULL`
and became permanently invisible to the report. The ordered products *were*
group-buy products (`metadata.productType: "gb"`, with `gbPrice`) — the owner
simply never re-assigned them to the round.

KG-1001 is a separate case: placed 2026-07-26, when no round was live at all.

## The fix

Attribution is now a **hint**, not the source of truth. A round's orders are:

- stamped with this round → always included (any date);
- stamped with a different round → always excluded (never double-counted);
- unattributed → included when `placedAt` falls inside `[startsAt, endsAt]`;
- unattributed and inside no round's window → counted as `unlinked` and shown in
  the UI, never silently dropped.

Decided with the store owner (option "Attributed + orders in the round's window").

---

## User journeys

1. As a K Glow store owner, I want the report to show the orders customers actually
   placed during the round, so I can order from my supplier — even when I forgot to
   assign those products to the round.
2. As a store owner, I want a per-order table (name, contact, address, product,
   batch, vials, date, payment method, payment status, order status, proof) so I can
   reconcile each buyer.
3. As a store owner, I want to click a proof-of-payment image and see it large,
   without downloading it.
4. As a store owner, I want summary totals where cancelled orders never inflate
   vials, sales, or products-to-order.
5. As a store owner, I want the Excel export to tell me exactly how many vials of
   each product to order, matching the on-screen numbers.

---

## Task report

### 1. Reproduce (RED)

`scripts/test-gb-report-orders.ts` was written first against a module that did not
yet exist.

```
$ npm run test:gb-report-orders
Error: Cannot find module '../src/lib/storefront/group-buy-orders'
```

Compile-time RED: the new test newly references the missing implementation, and the
failure is the intended signal (missing business logic), not unrelated breakage.
Committed as `b015877`.

### 2. Implement (GREEN)

New pure module `src/lib/storefront/group-buy-orders.ts` —
`resolveRoundOrders`, `summarizeRoundOrders`, `buildProductsToOrder`,
`buildRoundOrderRows`, `displayPaymentStatus`, `formatShippingAddress`.

Wired into `prepareReport`, `getGroupBuySupplierReportAction`, the report modal and
the workbook serializer.

```
$ npm run test:gb-report-orders
22 passed, 0 failed

$ npm run test:gb-report
12 passed, 0 failed

$ npm run test:gb-rounds
13 passed, 0 failed

$ npm run test:gb-banner
10 passed, 0 failed

$ npm run test:two-ways
18 passed, 0 failed

$ npx tsc --noEmit --pretty false | grep -c "error TS"
0
```

Two assertions in the pre-existing `scripts/test-gb-report.ts` were updated rather
than the implementation: they asserted the removed totals labels `Placed Orders` /
`Total Items`, which the spec explicitly replaces with the owner-facing set. The
tests were wrong, not the code.

### 3. Verify against live data

A read-only script ran the new resolver over the real `k-glow` rows (deleted after
the run; not committed):

```
=== ROUND "july 28" (2026-07-28 → 2026-07-30) ===
  Total Orders 2 | Active 2 | Confirmed 2 | Pending 0 | Cancelled 0
  Total Vials 6 | Total Sales ₱22,304 | unlinked-elsewhere 1
  Products to order:
    Bacteriostatic Water — 5ml           3 vials  (2 orders)
    Tirzepatide — 30mg × 10 vials        2 vials  (2 orders)
    Tesamorelin — 10mg × 10 vials        1 vials  (1 orders)
  Order rows:
    KG-1002 … Tirzepatide — 30mg × 10 vials   1v BDO Confirmed new proof=YES counted=true
    KG-1002 … Bacteriostatic Water — 5ml      1v BDO Confirmed new proof=YES counted=true
    KG-1003 … Tirzepatide — 30mg × 10 vials   1v BDO Confirmed new proof=YES counted=true
    KG-1003 … Tesamorelin — 10mg × 10 vials   1v BDO Confirmed new proof=YES counted=true
    KG-1003 … Bacteriostatic Water — 5ml      2v BDO Confirmed new proof=YES counted=true
  EXCEL PARITY: OK — workbook totals identical to screen

=== ROUND "june gb" (2026-07-21 → 2026-07-25) ===
  Total Orders 0 | … | unlinked-elsewhere 1
  EXCEL PARITY: OK
```

The previously invisible KG-1002 and KG-1003 now appear with full detail. KG-1001
is correctly reported as 1 unlinked order (placed between rounds) and surfaced in
the modal with guidance to widen the round's dates.

---

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | Unattributed orders inside the round's window appear in the report (the k-glow bug) | `test-gb-report-orders.ts:unattributed orders inside the round's window ARE linked` | unit | PASS | `npm run test:gb-report-orders` |
| 2 | An order belonging to no round's window is reported as `unlinked`, never dropped | `…:an unattributed order outside EVERY round's window is reported as unlinked` | unit | PASS | same |
| 3 | Explicit attribution wins over the window, regardless of order date | `…:an order attributed to THIS round is included regardless of its date` | unit | PASS | same |
| 4 | An order stamped for another round is never double-counted | `…:an order attributed to a DIFFERENT round is never swept in by the window` | unit | PASS | same |
| 5 | Overlapping windows assign an order to exactly one round (earliest created) | `…:overlapping windows assign an unattributed order to ONE round` | unit | PASS | same |
| 6 | An undated round claims nothing — it can't swallow the order history | `…:a round with no window at all sweeps nothing` | unit | PASS | same |
| 7 | Window bounds are inclusive at open and close | `…:window bounds are inclusive at both edges` | unit | PASS | same |
| 8 | Total Orders counts every linked order, cancelled included | `…:Total Orders counts every linked order incl cancelled` | unit | PASS | same |
| 9 | Confirmed + Pending === Active === Total − Cancelled | `…:Active / Confirmed / Pending / Cancelled buckets add up` | unit | PASS | same |
| 10 | Total Vials excludes cancelled orders | `…:Total Vials EXCLUDES cancelled orders` | unit | PASS | same |
| 11 | Total Sales excludes cancelled orders | `…:Total Sales EXCLUDES cancelled orders` | unit | PASS | same |
| 12 | Cancellation outranks payment — a paid-then-cancelled order is never "Confirmed" | `…:a paid-but-cancelled order counts as Cancelled, never Confirmed` | unit | PASS | same |
| 13 | "canceled" and "refunded" spellings are excluded too | `…:'canceled' and 'refunded' spellings are excluded too` | unit | PASS | same |
| 14 | Products to Order sums vials per product, cancelled excluded, biggest first | `…:sums vials per product, cancelled excluded, biggest first` | unit | PASS | same |
| 15 | Legacy lines without a productId group by name | `…:legacy lines with no productId group by name` | unit | PASS | same |
| 16 | Each order line carries customer, contact, address, product, batch, vials, date, payment method, payment status, order status, proof | `…:one row per order LINE, carrying every required column` | unit | PASS | same |
| 17 | Cancelled orders are still listed, flagged `counted: false` | `…:cancelled orders still LIST on the report, flagged as not counted` | unit | PASS | same |
| 18 | Payment status renders as exactly Pending / Confirmed / Cancelled | `…:payment status maps to the three owner-facing labels` | unit | PASS | same |
| 19 | Shipping address joins only filled parts; empty renders "—" | `…:shipping address joins only the parts that are filled in` | unit | PASS | same |
| 20 | The workbook carries a Products-to-Order sheet excluding cancelled orders | `…:the workbook carries a Products-to-Order sheet excluding cancelled orders` | unit | PASS | same |
| 21 | Workbook totals equal the on-screen summary (no drift) | `…:workbook totals equal the on-screen summary (no drift)` | unit | PASS | same |
| 22 | The Orders sheet exports contact number, batch and order date, cancelled included | `…:the workbook's Orders sheet carries the full customer detail incl cancelled` | unit | PASS | same |
| 23 | Existing demand-vs-committed supplier aggregation is unchanged | `scripts/test-gb-report.ts` (12 checks) | unit | PASS | `npm run test:gb-report` |
| 24 | Round status/window resolution unchanged | `scripts/test-gb-rounds.ts` (13 checks) | unit | PASS | `npm run test:gb-rounds` |
| 25 | Storefront banner + two-ways behaviour unchanged | `test-gb-banner.ts` (10), `test-two-ways.ts` (18) | unit | PASS | `npm run test:gb-banner`, `npm run test:two-ways` |
| 26 | KGLOW's live report resolves the real orders and matches the export | read-only verification over live `k-glow` rows | manual | PASS | output quoted above |

---

## Coverage and known gaps

This repository has no coverage harness — tests are standalone `tsx` scripts, not
Jest/Vitest — so a percentage figure cannot be produced. Every exported function in
the new `src/lib/storefront/group-buy-orders.ts` is exercised: `resolveRoundOrders`
(7 checks), `summarizeRoundOrders` (6), `buildProductsToOrder` (2),
`buildRoundOrderRows` (2), `displayPaymentStatus` (1), `formatShippingAddress` (1),
plus 3 integration checks through `prepareReport` — 6/6 exported functions.

Intentional gaps:

- **No automated UI test** for the proof-of-payment lightbox or the summary tiles.
  The repo has no React test runner or Playwright setup; adding one is out of scope
  for this fix. The rendering logic is a thin map over `prep.orderLines`, which is
  fully unit-tested; the lightbox was verified by reading the render path
  (`AdminGroupBuys.tsx` → `ReportModal`), not by execution.
- **KG-1001 stays out of both rounds.** Placed 2026-07-26 when no round was live,
  it is reported as `unlinked` with in-modal guidance rather than assigned to a
  round it wasn't placed during. Per the owner's decision, inventing an attribution
  would be fabricating data. Widening `june gb`'s close date or `july 28`'s open
  date pulls it in automatically.
- **ESLint not run.** `npx next lint` prompts to initialize a config this repo has
  never had; initializing one was out of scope. `tsc --noEmit` passes with 0 errors.
- **Query breadth.** The report now fetches orders `WHERE groupBuyId = ? OR
  groupBuyId IS NULL` instead of a single indexed equality. Orders attributed to
  other rounds are still excluded in SQL. For tenants with very large unattributed
  order histories this reads more rows than before; if that becomes a problem, add a
  `placedAt` range predicate covering the union of round windows.

## "Updates automatically as new orders are confirmed or cancelled"

`getGroupBuySupplierReportAction` is an uncached Server Action querying through
`withTenant` — no `unstable_cache` anywhere in the path. Opening the report always
re-resolves from the current rows, so a payment confirmed or an order cancelled is
reflected the next time the modal opens.

## Merge evidence

If these commits are squashed, preserve:

- **RED** — `b015877`: `npm run test:gb-report-orders` → `Cannot find module
  '../src/lib/storefront/group-buy-orders'` (compile-time RED, intended cause).
- **GREEN** — `be10fac`: 22 + 12 + 13 + 10 + 18 checks passing, `tsc --noEmit` 0
  errors, live k-glow verification showing 2 orders / 6 vials / ₱22,304 with 1
  order correctly flagged unlinked.
- **Refactor** — none needed; the implementation was written in its final shape and
  the pure/impure split (`lib/storefront/group-buy-orders.ts` vs the action) was
  established up front.
