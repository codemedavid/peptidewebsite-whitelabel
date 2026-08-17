# TDD evidence — bulk order status change aborts with Prisma P2028

**Date:** 2026-08-17
**Branch:** `main`
**Commits:** `013785b` (RED) → `44fbb51` (GREEN) → refactor (dead imports)
**Source plan:** none on disk — journeys were derived during this run from a screenshot of the failure on the `pepstack-davao` store admin.

## The report

The store admin's Orders screen, with 17 orders selected and **Change Status → Confirmed**, showed:

```
Invalid `prisma.storefrontOrder.findFirst()` invocation:

Transaction API error: Transaction not found. Transaction ID is invalid,
refers to an old closed transaction Prisma doesn't have information about
anymore, or was obtained before disconnecting.
```

Nothing was saved — the transaction rolled back.

## Diagnosis (measured, not assumed)

That is Prisma **P2028**: the interactive transaction exceeded its budget and was killed. The `findFirst` named in the message is the per-order re-read at `src/actions/orders.ts:1691` (pre-fix).

A read-only probe against the live DB established the arithmetic:

| Measurement | Value |
|---|---|
| Active orders on `pepstack-davao` | 320 |
| Total line items | 521 (avg 1.63/order, max 6) |
| Round-trip latency inside a `withTenant()` tx | **~321 ms** (`20 round trips: 6434ms`) |
| `withTenant()` budget (`TX_TIMEOUT_MS`) | 20 s |

The action's cost was `1 + 2×orders + 2×lineItems` **sequential** round trips inside one transaction:

- per order — `updateMany` + `findFirst` re-read
- per line item — `product.findFirst` + `product.updateMany` (`applyOrderStockMove`)

17 orders ≈ 28 line items ⇒ **~92 round trips ≈ 29.5 s** > 20 s. Deterministic, not a flake. `cleanIdList` caps selections at 1000 orders, which no single transaction could ever survive.

## User journeys

1. As a store owner, I want to select many orders and change their status in one action, so that I don't have to confirm them one at a time.
2. As a store owner, I want stock to move exactly once per order when I confirm or cancel in bulk, so that my inventory stays truthful.
3. As a store owner, when something does go wrong, I want to be told what to do about it — not shown a database transaction id.

## Task report

### Task 1 — pin the round-trip *shape* with a reproducer

Wall-clock assertions would be flaky, so the test pins the shape of the work instead: the stock move must cost `O(1)` reads + `O(distinct changed products)` writes, never `O(line items)`, and the plan must be computed in memory so no order is re-read after its own write. A fake DB counts every round trip; that counter is the assertion.

**Command:** `npm run test:bulk-status-batching`

**RED output:**

```
Error: Cannot find module '../src/lib/storefront/bulk-status'
Require stack:
- scripts/test-bulk-status-batching.ts
```

Resolve-time RED, failing for the intended reason: the three seams the fix must introduce (`bulk-status.ts`, `stock-move-db.ts`, `inventory.applyStockMovesToProducts`) did not exist. Committed as `013785b`.

### Task 2 — batch the stock move

`src/lib/storefront/stock-move-db.ts` applies many orders' movements with one product read and at most one write per product actually changed. The pure fold is `inventory.applyStockMovesToProducts`; `applyStockMoveToProducts` became its single-order case, so the demo path and the DB path share one engine. The DB surface is an interface, not a Prisma client — which is what lets the test substitute a counting fake.

### Task 3 — drop the per-order re-read

`src/lib/storefront/bulk-status.ts` plans the whole selection in one in-memory pass and returns each changed order with its `prevStatus`, so the caller rebuilds the updated row from what it already read. Per-order rules still delegate to `planStatusChange`, so bulk / single / demo cannot drift.

### Task 4 — bound the transaction

Writes go in chunks of 20 orders, one transaction each (`BULK_STATUS_CHUNK`). Duration no longer scales with the selection.

**Accepted trade-off:** all-or-nothing across the *whole selection* is gone; a chunk can succeed while a later one fails, and the action reports the honest `changed` count. What remains atomic is the pair that matters — an order's status change and its stock movement never separate. This was raised with the user in the plan and confirmed with "proceed". The prior behaviour was total failure with nothing saved, so partial success is strictly better.

### Task 5 — stop leaking Prisma internals

`orderActionError()` maps P2028 to "That took too long to save. Please select fewer orders and try again." Applied to the bulk path and the single-order path.

**GREEN output:**

```
Bulk status change — batching & round-trip budget

planBulkStatusChange()
  ✓ produces one write per genuinely changed order, none for no-ops
  ✓ appends exactly one journey event to a changed order
  ✓ collects a stock move for each order whose transition moves stock
  ✓ collects no stock move for an imported order
  ✓ returns prevStatus per changed order so no re-read is needed
  ✓ restocks on cancel only when the items are currently deducted

applyStockMovesToProducts()
  ✓ folds several orders' deductions onto the same product
  ✓ nets a deduct and a restock across orders
  ✓ moves a tracked variation's own pool and leaves the base column alone
  ✓ clamps at zero rather than going negative
  ✓ matches legacy lines (no productId) by exact name

applyOrderStockMovesBatched() — round-trip budget
  ✓ reads every product it needs in exactly ONE query
  ✓ writes at most once per distinct product, not once per line item
  ✓ the 17-order case that timed out now costs a bounded number of round trips
  ✓ skips the write entirely for a product whose net delta is zero
  ✓ makes no round trips at all when there is nothing to move
  ✓ persists the netted stock value, not a per-order intermediate
  ✓ writes a tracked variation through metadata, leaving base stock out of the patch
  ✓ ignores a line whose product is missing from the catalog

19 passed, 0 failed
```

**Result: 17 orders go from ~92 round trips to ~30** (1 read + ≤20 order writes + 1 product read + writes for products actually touched), ≈ 9.6 s at the measured latency, inside the 20 s cap with headroom — and bounded for any selection size.

### Task 6 — live verification of the one thing a fake cannot cover

The fake proves the round-trip *count*; it cannot prove the new `OR` where-shape is valid Prisma or that the tenant extension still isolates it. Checked read-only against the live DB:

```
query is valid Prisma: true
owning tenant sees: 3 of 3 requested
metadata/stock selected ok: true
OTHER tenant sees (must be 0): 0
```

Tenant scoping survives because the extension spreads `tenantId` as a sibling key of `OR`, and Prisma ANDs top-level keys (same reasoning as `ACTIVE_ORDERS_WHERE`, `src/lib/orders/trash.ts:38`).

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Only genuinely changed orders are written; no-ops cost nothing | `test-bulk-status-batching.ts` → `produces one write per genuinely changed order` | unit | PASS |
| 2 | A changed order gains exactly one journey event | `…appends exactly one journey event` | unit | PASS |
| 3 | An imported order's status moves but its stock stays frozen | `…collects no stock move for an imported order` | unit | PASS |
| 4 | The caller can emit status-change events without re-reading any row | `…returns prevStatus per changed order` | unit | PASS |
| 5 | Cancel restocks only when the items are currently deducted | `…restocks on cancel only when…` | unit | PASS |
| 6 | Several orders' deltas fold onto one product correctly, incl. deduct+restock netting | `applyStockMovesToProducts()` ×5 | unit | PASS |
| 7 | A tracked variation moves its own pool, leaving the base column and siblings alone | `…moves a tracked variation's own pool` | unit | PASS |
| 8 | **All products are read in exactly one query, regardless of order count** | `…reads every product it needs in exactly ONE query` | integration (fake DB) | PASS |
| 9 | **Writes scale with distinct products, not line items** (60 items / 4 products → ≤4 writes) | `…writes at most once per distinct product` | integration (fake DB) | PASS |
| 10 | **The 17-order case that timed out stays within a bounded round-trip budget** | `…the 17-order case that timed out…` | integration (fake DB) | PASS |
| 11 | A product whose delta nets to zero is not written at all | `…skips the write entirely…` | integration (fake DB) | PASS |
| 12 | The real Prisma where-shape is valid and still tenant-scoped | live read-only probe (output above) | integration (live DB) | PASS |

## Coverage and known gaps

No coverage tooling is configured in this repo (`scripts/test-*.ts` self-contained suites, no Jest/Vitest), so the 80% line-coverage gate cannot be computed. Coverage is expressed as behavioural cases above.

Regression suites re-run after the refactor, all green:

```
bulk-status-batching     19 passed, 0 failed
bulk-order-status        PASS — 27 passed, 0 failed.
variant-inventory        33 passed, 0 failed
cart                     20 passed, 0 failed
order-trash              PASS — order trash verified
tsc --noEmit             0 errors
```

**Gaps, stated plainly:**

- `npm run test:legacy-import` reports `35 passed, 1 failed` — `parses all 487 historical orders — 0 == 487`. **Pre-existing and unrelated**: verified by stashing this change and re-running, which fails identically. The HP Glow dump the test reads is not present in this working copy.
- No end-to-end test drives the real server action against a real transaction; the round-trip budget is proven with a fake, and the query shape separately against the live DB. A true E2E would need a seeded tenant and a writable test database.
- Chunk-boundary failure (chunk 1 commits, chunk 2 fails) is reasoned about but not simulated in a test.
- The measured ~321 ms/round-trip came from a developer laptop, **not** from production. If Vercel's functions sit far from the Supabase region, production pays a similar tax on every call site in the app, not just this one. Worth measuring separately; out of scope here.

## Follow-up: two defects found in code review

Reviewing this change surfaced two real defects in it. Both were reproduced RED first (`8bbe05c`), then fixed (`8088767`).

### A. Duplicate product names double-moved stock

Batching replaced the DB path's `findFirst({ where: { name } })` — exactly one row — with `findMany` + "match every row with this name". A legacy order line carrying no `productId` therefore moved the same units once *per duplicate listing*.

Checked against live data:

```
duplicate (tenant,name) product pairs: 1
worst: Glow Sculpt Duo (Tirzepatide 30mg & GHK-CU 100mg) - FREE SHIPPING NATIONWIDE=2
live non-imported orders: 428
  with >=1 line lacking productId: 0 (lines: 0)
```

So it was **latent, not firing**: the duplicate exists, but no live non-imported order currently has a `productId`-less line. Still a real regression — `normalizeItems` permits such lines and legacy orders are exactly the case the name-match path exists for. RED reproduced it precisely: `expected 1 write, made 2`.

`applyStockMovesToProducts` now resolves a name-matched line to the *first* row carrying that name, restoring `findFirst` semantics. Id-matched lines are untouched.

### B. Partial bulk failure lost emails and left the catalog stale

Chunking introduced a path that all-or-nothing had made impossible: a later chunk fails *after* earlier ones committed. The `catch` returned before the PostHog emit loop and before `revalidateTenant`. Concretely — an owner bulk-confirms 100 orders, chunk 4 fails: orders 1–60 are committed with stock deducted, but none of those 60 customers get a status email, the catalog keeps serving pre-deduction stock, and retrying is a no-op for the 60 (`planStatusChange` skips them), so those emails are lost permanently.

The chunk loop now holds the failure, completes the emit + revalidate for everything that committed, and only then reports — leading with the count saved:

> Saved 60 orders before running out of time. The rest were left unchanged — select them and try again.

**Honest limit:** the *control flow* guarantee (emit-before-report) is verified by reading, not by an automated test — the server action needs auth, tenant headers and a writable DB to drive. What is unit-tested is the pure decision it depends on, `bulkStatusFailureMessage` / `isTransactionTimeout` (4 cases). A true test of the ordering would need a seeded, writable test database.

`test:bulk-status-batching` is now **26/26** (was 19; RED at 20 passed / 6 failed).

## Merge evidence

If these commits are squashed, preserve:

- **RED** `013785b` — `npm run test:bulk-status-batching` failed to resolve `bulk-status.ts` / `stock-move-db.ts` / `applyStockMovesToProducts`, the three seams the fix introduces.
- **GREEN** `44fbb51` — same command, 19/19; `bulk-order-status` 27/27, `variant-inventory` 33/33, `cart` 20/20, `tsc --noEmit` clean; live DB confirms the new query is valid and tenant-scoped.
- **REFACTOR** — removed `ProductMetadata` and `applyVariationStock` imports left dead by the replaced loop; typecheck and all four suites re-run green.
