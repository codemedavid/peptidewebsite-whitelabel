# TDD Evidence — Order Detail redesign

**Feature:** Re-skin the store-admin Order Detail screen to the imported Claude
Design `Order Detail.dc.html` (two-column layout + sticky summary sidebar),
preserving all existing behavior.

**Source plan:** inline `/ecc:plan` output (this session) — no `*.plan.md` file.
Palette decision: **brand-aware** (design primary blue → `--brand-accent`;
green/amber kept semantic).

## User journeys

- As a store owner, I open an order and see the customer, address, items,
  payment proof, and a payment summary in a scannable two-column layout.
- As a store owner, I copy any field (name/email/phone/address) or the full
  booking block with one tap, so I can paste into a courier form.
- As a store owner, I change the order status / confirm & deduct stock, and the
  totals (subtotal − discount + shipping + admin fee) always read correctly.

## Approach

The screen's pure logic (money math, date/address formatting, totals, item
count) was **extracted** from `AdminOrderDetail.tsx` into a testable module,
`src/storefront/admin/order-detail.ts`, and pinned with unit tests **before**
the component/CSS were re-skinned. The redesign then consumes those helpers, so
the layout change cannot silently alter what the screen computes.

Visual/markup is intentionally not asserted in unit tests (brittle); see
**Coverage and known gaps** for the manual visual-regression checklist.

## Task report

| Task | Summary | Command | Result |
|---|---|---|---|
| Extract helpers | Pure presentation helpers behind Order Detail | `npm run test:order-detail` | RED → GREEN (17/17) |
| Redesign component | Two-column + sticky sidebar, brand-aware `.od-*` CSS | `npx tsc --noEmit` | clean (exit 0) |

**RED evidence** (compile-time RED — the test exercises the missing module):

```
Error: Cannot find module '../src/storefront/admin/order-detail'
Require stack: scripts/test-order-detail.ts
```

**GREEN evidence:**

```
Order Detail presentation helpers — pure core
  ✓ formatPHP renders peso with 2 decimals + thousands separators
  ✓ formatOrderDate formats ISO in Asia/Manila as 'Mon D, YYYY · h:mm AM/PM'
  ✓ formatOrderDate uses store TZ, not UTC (boundary across midnight)
  ✓ computeOrderTotals adds shipping + admin fee and subtracts discount
  ✓ computeOrderTotals never returns a negative total
  ... 17 passed, 0 failed
```

## Test specification

| # | What is guaranteed | Test (`scripts/test-order-detail.ts`) | Type | Result |
|---|--------------------|----------------------------------------|------|--------|
| 1 | Peso money renders `₱1,200.00` with 2dp + separators | `formatPHP renders peso …` | unit | PASS |
| 2 | NaN/undefined money coerces to `₱0.00` | `formatPHP coerces NaN/undefined …` | unit | PASS |
| 3 | ISO date formats as `Mon D, YYYY · h:mm AM/PM` in store TZ | `formatOrderDate formats ISO …` | unit | PASS |
| 4 | Date uses Asia/Manila, not UTC (rolls across midnight) | `formatOrderDate uses store TZ …` | unit | PASS |
| 5 | Empty → `''`; unparseable → raw string | `formatOrderDate returns '' …` | unit | PASS |
| 6 | Blank/whitespace/null address parts → `—` | `orEmDash replaces blank …` | unit | PASS |
| 7 | Address line joins parts, prefixes `Brgy.`, skips blanks | `buildAddressLine joins present parts …` | unit | PASS |
| 8 | Barangay segment omitted when empty | `buildAddressLine omits the barangay …` | unit | PASS |
| 9 | `City, Province Postal` row; no stray separators | `cityProvinceLine …` (×2) | unit | PASS |
| 10 | Booking block stacks Name/Phone/Address, Region only when set | `buildBookingText …` (×2) | unit | PASS |
| 11 | Subtotal = Σ price×qty | `computeOrderTotals sums items …` | unit | PASS |
| 12 | Total = items − discount + shipping + adminFee | `computeOrderTotals adds shipping …` | unit | PASS |
| 13 | Total never negative | `computeOrderTotals never returns a negative …` | unit | PASS |
| 14 | Item count sums quantities (qty defaults to 1) | `itemCount sums line quantities …` | unit | PASS |

## Coverage and known gaps

- **Unit:** 17/17 pass; covers every exported helper incl. edge cases (empty,
  NaN, TZ boundary, missing address parts, over-discount).
- **Type safety:** `npx tsc --noEmit` clean across the project.
- **Visual regression (manual — not automated this run):** open a tenant
  store-admin → Orders → an order at **1440 / 1024 / 768 / 375**. Verify: grid
  collapses to one column < 900px, sidebar un-sticks, field/address values
  ellipsize, empty barangay/region show `—`, Confirm button only on `new`,
  totals match the helper math. Brand palette: primary uses `--brand-accent`.

## Checkpoint commits (on `main`)

- `191b9af` — `test:` reproducer (RED)
- `5d985d1` — `feat:` helpers (GREEN, 17/17)
- `e280fdf` — `refactor:` two-column redesign (tsc clean)
