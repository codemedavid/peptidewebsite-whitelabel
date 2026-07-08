# TDD Evidence — Add "ready" Order Status

**Feature:** Add a `ready` fulfillment status (packed / ready to ship or collect) to the storefront order lifecycle.
**Branch:** `feat/bulk-order-status`
**Source plan:** inline plan from `/ecc:plan add ready in order status` (conversational mode — no `.plan.md` artifact).

## Decision

`ready` sits **between `processing` and `shipped`**:

```
new → confirmed → processing → ready → shipped → delivered   (cancelled = branch)
```

It is a **neutral** status: like `processing`/`shipped`/`delivered` it moves **no inventory**. Only `confirmed` deducts stock and `cancelled` restocks it (`inventoryMove` in `src/lib/storefront/order-status.ts`), so `ready` required no change to the stock-movement logic — only inclusion in the status list so `isOrderStatus` accepts it.

## User Journeys

1. As a store admin, I can move an order (single or bulk) to **Ready** so customers know it's packed and awaiting dispatch — without any stock being deducted or restocked.
2. As a customer tracking my order, I see a **Ready** step on the fulfillment timeline between Processing and Shipped.

## Task Report

| Task | Summary | Command | RED → GREEN |
|---|---|---|---|
| Core transition rules | `ready` added to `ORDER_STATUSES` (after `processing`) and the `OrderStatus` union; verified neutral (no stock move) and journey-append on change | `npm run test:bulk-order-status` | RED `FAIL — 25 passed, 2 failed` → GREEN `PASS — 27 passed, 0 failed` |
| Exhaustiveness across surfaces | Adding to the `OrderStatus` union forced every `Record<OrderStatus,…>` map to add the case | `npx tsc --noEmit` | 4 errors (AdminOrders, AdminOrderDetail, TrackOrderPage ×2) → 0 errors |

### RED evidence
```
✗ lists the seven statuses in fulfillment order — Expected values to be loosely deep-equal
✗ 'ready' sits between processing and shipped — undefined == 'processing'
FAIL — 25 passed, 2 failed.
```
Commit: `cbb3489 test: add reproducer for 'ready' order status (RED)`

### GREEN evidence
```
PASS — 27 passed, 0 failed.
```
`npx tsc --noEmit` → `0` errors.

## Test Specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | `ORDER_STATUSES` lists seven statuses in fulfillment order | `test-bulk-order-status.ts:lists the seven statuses in fulfillment order` | unit | PASS |
| 2 | `ready` sits between `processing` and `shipped` | `…:'ready' sits between processing and shipped` | unit | PASS |
| 3 | `isOrderStatus("ready")` is true (server-action guard accepts it) | `…:accepts every canonical status` | unit | PASS |
| 4 | `processing → ready` moves no stock | `…:'ready' is neutral — moves no stock (processing → ready)` | unit | PASS |
| 5 | `processing → ready` appends a journey event, `move:null` | `…:processing → ready → changed + appended, but no inventory move` | unit | PASS |
| 6 | `ready → cancelled` still restocks a previously-confirmed order | `…:ready → cancelled still restocks a confirmed order` | unit | PASS |

## Surfaces Updated

| File | Change |
|---|---|
| `src/storefront/types.ts` | `ready` added to `OrderStatus` union |
| `src/lib/storefront/order-status.ts` | `ready` added to `ORDER_STATUSES` (neutral status; comment) |
| `src/storefront/admin/AdminOrders.tsx` | `STATUS_OPTIONS`, pill label (`✅ Ready`), `totalAll` sum, stat card |
| `src/storefront/admin/AdminOrderDetail.tsx` | pill label + `<option value="ready">` |
| `src/storefront/pages/TrackOrderPage.tsx` | `STATUS_LABELS`, `STATUS_DOT` (`#0ea5a3`), `FLOW` timeline |
| `src/storefront/storefront.css` | `.admin-pill--ready` + `.admin-stat-mini[data-tint="ready"]` (teal `#0EA5A3`) |

## Coverage & Known Gaps

- Pure transition core covered by `test:bulk-order-status` (27 assertions). UI surfaces are guarded at compile time by `tsc` exhaustiveness on `Record<OrderStatus,…>`.
- No visual-regression screenshots captured for the new pill/timeline color; recommend a quick manual check of the admin Orders list, order-detail select, and the Track timeline.

## Merge / History Note

⚠️ A **concurrent session** working on the payment-proof viewer committed `ccc9788` and `6f912fe` while this feature was mid-commit. Its `6f912fe` commit ("docs: TDD evidence for payment-proof full-image viewer") **swept this `ready` feature's GREEN changes** (all six source files) into it alongside the payment-proof work. The code is correct and fully committed, but the `ready` changes live under a commit labeled for a different feature. Reviewers should not expect a standalone `feat: ready order status` commit — the RED reproducer is `cbb3489`; the GREEN is bundled into `6f912fe`.
