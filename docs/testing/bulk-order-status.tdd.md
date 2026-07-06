# TDD Evidence — Bulk Change Order Status

**Feature:** Store-admin Orders Management — change the status of many selected
orders at once, alongside the existing Delete Selected / Delete All bulk actions.

**Branch:** `feat/bulk-order-status`
**Source plan:** inline `/ecc:plan` output (see session) — approved, then implemented
via `/ecc:tdd-workflow`. No `*.plan.md` artifact was written.

## User journey

> As a store admin, I want to select multiple orders and change them all to one
> status in a single action, so I don't have to open each order — and the
> fulfillment journey and inventory stay correct exactly as they do for a
> single-order edit (a journey event is appended only on a real change; stock
> deducts on confirm and restocks on cancel, never twice).

## Design

The correctness-critical decision — "what changes when this order moves to status
X" — was **extracted into a pure module** so the single-order update and the new
bulk action share identical rules and can never drift:

- `src/lib/storefront/order-status.ts` — `ORDER_STATUSES`, `isOrderStatus`,
  `cleanIdList`, `stockCurrentlyDeducted`, `inventoryMove`, `planStatusChange`.
- `src/actions/orders.ts` — `updateStorefrontOrderAction` refactored onto
  `planStatusChange` + a shared `applyOrderStockMove` DB helper; new
  `bulkUpdateStorefrontOrderStatusAction` (demo + DB paths) reuses the same core.
- `src/storefront/admin/AdminOrders.tsx` — status `<select>` + Change Status
  button in the bulk bar; `bulkChangeStatus` handler mirrors `deleteSelected`.
- `src/storefront/storefront.css` — `.admin-orders__bulkstatus` group styling.

## RED → GREEN

| Stage | Command | Result | Evidence |
|---|---|---|---|
| RED | `npm run test:bulk-order-status` | FAIL — `MODULE_NOT_FOUND` for `src/lib/storefront/order-status.ts` (test newly exercises the not-yet-created core → compile-time RED) | commit `5e658c1` |
| GREEN | `npm run test:bulk-order-status` | PASS — 23 passed, 0 failed | commit `7761db9` |
| Wire-in | `npx tsc --noEmit` | 0 errors after refactor + bulk action + UI | commit `aef6894` |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | `ORDER_STATUSES` lists the six statuses in fulfillment order | `test-bulk-order-status.ts` | unit | PASS |
| 2 | `isOrderStatus` accepts canonical statuses, rejects empty/wrong-case/non-string | " | unit | PASS |
| 3 | `cleanIdList` keeps non-empty strings, drops blanks/non-strings, dedupes, caps, non-array → [] | " | unit | PASS |
| 4 | `stockCurrentlyDeducted` replays journey: legacy/empty → false; confirm → true; confirm→cancel → false; bounce → true | " | unit | PASS |
| 5 | `inventoryMove`: new→confirmed = deduct; confirmed→cancelled (deducted) = restock; unchanged = null; confirmed→shipped = null; cancel-never-confirmed = null; re-confirm = null | " | unit | PASS |
| 6 | `planStatusChange`: unchanged status appends no event and moves nothing | " | unit | PASS |
| 7 | `planStatusChange`: new→confirmed appends exactly one event and deducts | " | unit | PASS |
| 8 | `planStatusChange`: confirmed→shipped appends but moves no stock | " | unit | PASS |
| 9 | `planStatusChange`: confirmed→cancelled restocks | " | unit | PASS |
| 10 | `planStatusChange`: tolerates a missing `statusHistory` (legacy order) | " | unit | PASS |
| 11 | BULK: one target status across a mixed set changes only the differing orders; already-target orders move no stock | " | unit | PASS |

Total: **23 assertions, all PASS.**

## Regression + gates

| Check | Command | Result |
|---|---|---|
| Existing Order Detail helpers unaffected | `npm run test:order-detail` | PASS — 17/0 |
| Staff-permission gate (orders permission) unaffected | `npm run test:staff` | PASS — 62/0 |
| Tenant isolation (forTenant + Postgres RLS) | `npm run test:isolation` | PASS — 44/0, "ISOLATION HOLDS" |
| Full project type-check | `npx tsc --noEmit` | 0 errors |

## Coverage & known gaps

- **No coverage tool in repo** (no jest/vitest); coverage is expressed through the
  branch-exhaustive assertions above, which cover every branch of the pure core.
- **Server-action wiring not directly unit-tested.** Per repo convention, the
  `"use server"` action (DB/cookie deps) and the React component are not unit
  tested. Mitigation: the bulk action's demo and DB paths are structural mirrors
  of the already-proven single-order `updateStorefrontOrderAction`, and both call
  the same tested `planStatusChange` core and `applyOrderStockMove` helper.
- **Follow-up (manual QA):** exercise the button in the running store admin
  (demo mode at `slug.lvh.me:3100`) — select orders, Change Status, confirm pills
  update and inventory reflects a confirm→deduct once per order.

## Merge evidence (for squash)

RED: `test-bulk-order-status.ts` failed with MODULE_NOT_FOUND (core missing).
GREEN: created `order-status.ts` → 23/23 pass. Refactored single-order action +
added bulk action + UI → `tsc` 0 errors, isolation 44/0, order-detail/staff green.
