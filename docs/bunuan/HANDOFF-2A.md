# Hand-off — Wave 2A (schema, live DB, server actions)

Branch `bunuan/2a-server` (from `feat/mobile-admin-app` @ 94da36f, after 1A + 1B). Wave 3 builds screens on the actions and **contract types below**. Use only those, and don't change the server rules. If you need a rule changed, ask in your hand-off.

**Nothing changes for a store without `groupbuy.bunuan` / `groupbuy.ligwak`.** Its rounds stay `stage = "open"`, every stage and Ligwak action answers `unavailable`, the cap never fires, and all new order columns stay NULL, so totals are computed as today.

## Owner decisions applied to the 1A core (README decision 10)
- **Reopen:** `allowedNextStages("closed")` now offers `open`. It is allowed until the Ligwak lock and blocked (with a reason) after it. The old round editor follows the same rule (`stageSyncForSave`).
- **QR PH fee:** `recalculateOrder` keeps the payment fee exactly as charged, even when every line is cancelled, so a refund covers items + shipping only.
- Edits are locked after the Ligwak lock until Recalculate (1A's `editsLocked`, unchanged). There is no Bunuan timer: Start Bunuan clears `endsAt`.

## Schema (additive)
- `GroupBuy`: `stage` (default `"open"`), `stageChangedAt`, `paymentMode` (snapshot of `gbPaymentModeFor` taken on the first stage move or when the round is opened in a stage store), `paymentDueAt`, `ligwakLockedAt`.
- `StorefrontOrder` (all nullable, whole centavos): `originalTotalCents`, `adjustedTotalCents`, `amountDueCents`, `refundDueCents`, `refundStatus` (`for_review | refund_pending | refunded`), `refundReference`, `gbTotals` (the full `GbRecalc` breakdown in major units, so every surface shows the same lines), `storeEditedAt`.
  - I used `*Cents` names instead of the brief's `originalTotal` etc., to match the repo's money convention. Wave 3 reads the contract types, not these columns.
- New tables: `GbAllocation` (round, version, paymentMode, lockedAt/By, supersededAt), `GbAllocationEntry` (order, lineIndex, lineKey, variation, quantity, successQty, cancelledQty, kitSize snapshot, suggestQty, decision), and the append-only `GbAuditEvent`.
- **DB rules** live in `src/modules/ligwak/sql/gb-allocation.sql`, applied with `npm run db:gb-allocation` (idempotent):
  - CHECK `successQty + cancelledQty = quantity`, with no negatives
  - decision, stage and mode must come from their sets
  - refunds only move forward, and `refunded` needs a reference
  - the audit table refuses UPDATE/DELETE (a store-deletion cascade still passes)
- RLS: `prisma/rls.sql`. Tenant extension: `src/lib/db/tenant-client.ts`.
- Order line JSON gains server stamps: `cancelledQty`, `placedAt`, `addedBy: "store"`, `changedByStore`, `originalQty`.
  - They are read only from the stored row (`storedItems` in `db-mapping.ts`). A checkout payload can never carry them.
  - Stock moves use `stockItems`, which counts only the vials that survived Ligwak.

## Server actions (all return the contract types; registered in `BRIDGED_ACTIONS`)
`src/modules/bunuan/actions.ts`. Store admin with `groupbuys`; `editOrderLinesAction` also accepts `orders`.
```ts
getGbRoundStageAction(roundId): Promise<GbRoundStageResult>
setGbStageAction(roundId, stage: "open"|"bunuan"|"closed"|"payment", opts?: { paymentDueAt?: ISO|null; reason?: string }): Promise<GbStageResult>
getBunuanCounterAction(roundId): Promise<GbBunuanCounterResult>             // live, poll ~5s
editOrderLinesAction(orderId, lines, opts?: { preview?: boolean; expectedUpdatedAt?: ISO }): Promise<GbOrderEditResult>
  // lines = the WHOLE edited list: { index, qty } per kept line (0 / omitted = remove), { productId, variation?, qty } per new one
```
`src/modules/ligwak/actions.ts`. Store admin with `groupbuys`.
```ts
previewLigwakAction(roundId): Promise<LigwakReviewResult>
decideLigwakAction(roundId, decisions: LigwakDecisionInput[]): Promise<LigwakReviewResult>  // merged over saved ones
lockLigwakAction(roundId): Promise<LigwakReviewResult>
recalculateLigwakAction(roundId, reason: string): Promise<LigwakReviewResult>              // reason ≥ 3 chars
listGbRefundsAction(roundId): Promise<GbRefundsResult>
setRefundStatusAction(orderId, status: ShopRefundStatus, reference?): Promise<GbRefundResult>
```
Server functions taking a resolved ctx (for tests and 3C) are in `src/modules/bunuan/server` and `src/modules/ligwak/server`.

**Stage moves.** Every move runs in one transaction with the round row locked, and is audited:
- **Start Bunuan:** blocked (code `blocked`, with `blockers`) while any pay_first order awaits a payment check. It clears `endsAt`, keeps `status: active`, and skips straight to Closed when every kit is already full.
- **Close:** sets `status: closed` and stamps `closedAt` once.
- **Reopen:** sets `status: active` and drops an `endsAt` that has already passed. Refused after the lock; also refused while another round is live (the one-active index).
- **Payment time:** pay_later only, after the Ligwak lock in Ligwak stores. Takes the optional `paymentDueAt`.
- **The old round editor** (`saveGroupBuyAction`) keeps the stage in step and can't reopen a locked round.
- `windowEnded` tells the admin that an Open round's `endsAt` has passed: customers can't order, and the admin moves the round on from there.

**Bunuan cap** (`src/modules/bunuan/server/cap.ts`, wired into `src/actions/orders.ts`):
- a no-lock pre-check in `validateLiveOrder`, so the quote shows the message too;
- the binding check inside the order's own insert transaction: `SELECT … FOR UPDATE` on the round, a live recount, and a rollback with a customer message ("Only 7 vials of … are left to fill the kit…").
- The order that fills the last kit moves the round to Closed (audited `actor: "system"`). An admin edit that fills it does the same.
- An order attributed to a round that closed in the meantime is refused.

**Counting.** The cap and the admin counter count claims: every placed, non-cancelled order, so a pay_first Bunuan order awaiting its check still holds its vials (otherwise two buyers could be sold the same last vials). The counter shows those vials as `pendingVials`. Ligwak and the supplier report use 1A's payment-mode rule, and **Lock is blocked while any pay_first order awaits its check**.

**Lock** writes, in a fixed number of queries:
- every counted order: line `cancelledQty`, the cents columns, and `gbTotals`, in one bulk UPDATE;
- `refundStatus = for_review` where a refund is due;
- a restock of ligwak'd vials on orders whose stock was already deducted.

Recalculate undoes the lock:
- it supersedes the version, starts the next one with the decisions carried over (a changed suggestion reads undecided), and returns the orders to un-allocated (stock deducted again);
- it is refused at Payment time and once any refund is `refund_pending`/`refunded`.

**Supplier report.** Stage stores use the kit rule: success vials only, kits per variation. It is refused while the round still takes orders.

## Contract types (FROZEN — `src/lib/mobile/shop-contract.ts`, add optional fields only)
- **Customer:**
  - `ShopGroupBuy.stage?`, `ShopGroupBuy.bunuan?: ShopBunuanState | null` (only in Bunuan: `open: ShopBunuanItem[] = { productId, variation, name, allowance }`).
  - `ShopOrderItem.lineStatus? | successQty? | cancelledQty? | lineStatusLabel? | changedByStore? | originalQty?`.
  - `ShopOrder.originalTotal? | amountDue? | refundDue? | refundStatus? | refundReference? | changedByStore?` (`total` is already the new total).
  - `ShopOrderRound.stage? | stageLabel? | paymentDueAt? | ligwakLocked?`.
- **Admin:** `GbStage`, `GbPaymentModeName`, `ShopLineStatus`, `ShopRefundStatus`, `GbFail{code,message,blockers?}`, `GbFailCode`, `GbBlocker`, `GbStageOption`, `GbRoundStage`, `GbStageResult`, `GbRoundStageResult`, `GbKit`, `GbBunuanCounter`, `GbBunuanCounterResult`, `GbLineChange`, `GbEditLine`, `GbOrderEditResult`, `LigwakChoiceName`, `LigwakSuggestion`, `LigwakKitSummary`, `LigwakOrderImpact`, `LigwakReview`, `LigwakReviewResult`, `LigwakDecisionInput`, `GbRefundStep`, `GbRefund`, `GbRefundsResult`, `GbRefundResult`.
- **Website (3B) without the app contract:**
  - `Order` carries the stamps plus `gbTotals`, `adjustedTotal`, `amountDue`, `refundDue`, `refundStatus`, `refundReference` and `storeEditedAt`.
  - `TrackedOrder` carries the same (`changedByStore`).
  - `gbLineStatuses(order, { enabled })` in `src/lib/orders/gb-line-status.ts` gives each line's status.
  - `brand.groupBuyBanner.stage` and `brand.groupBuyBanner.bunuan` drive the storefront Bunuan state (the app reads the same banner).
- **Caps:** `GroupBuyCapabilities.bunuan`, `.ligwak` (`resolveGroupBuyCaps`; the app's own caps type in `mobile/.../group-buys/model.ts` doesn't have them yet — 3A). Product: `variations[].kitSize` (the editor field is 3A's).

## Tests
| Script | Count | Covers |
|---|---|---|
| `test:bunuan-db` | 33 | SQL rules (idempotent, CHECKs, refund trigger, append-only audit + cascade), stamps from rows only, total surfaces, `kitSize` through `normalizeProductInput` / mapping / MCP plan |
| `test:bunuan-flow` | 18 | real website checkout + app catalog: blockers, Start Bunuan, counter, "only 15mg up to 7", over-limit + not-open refusals, **two races** (5-of-7 and last-2), auto-close, reopen, old editor, store without features |
| `test:ligwak-flow` | 27 | suggest (8+5+2 → Ben 3, Cara 2), undecided/stale, lock via the action, totals, customer app lines, supplier report, locks, recalc, Payment time + due date, pay_first QR PH refund + trail, stock restock/re-deduct, Lock blocked by unchecked payments |
| `test:gb-order-edit` | 18 | server pricing, preview, audit + `storeEditedAt`, Bunuan warning, stale editor, stock moves, edit auto-closes Bunuan, locks, permissions |
| `test:gb-stage-sync` | 21 | pure: effective stage, row writes, old-editor sync, claims counter, line statuses |
| `test:bunuan` (1A) | green | re-run with the reopen and QR PH changes |

- Mutation-checked: 37 mutants, all killed.
- On first run, 3 survived, and each pointed at a test gap. I closed them by adding the non-closing 5-of-7 race, fixing a no-op mutant, and asserting the stored `changedByStore`.
- The race test also caught a real bug: an order attributed to a round that had just auto-closed was accepted.
- **Limitation:** PGlite runs transactions one after another, so the races prove the recount inside the insert transaction, not Postgres row locking itself. `FOR UPDATE` only proves out on real Postgres (none available locally).

## Files touched outside the brief's list (small hunks)
- `src/lib/storefront/gb-stage.ts`, `src/lib/orders/gb-totals.ts` (+ `test-gb-stage.ts`, `test-gb-totals.ts`): the owner decisions.
- `src/storefront/types.ts`: `OrderItem` stamps, `OrderGbTotals`, `Order` re-total fields, and variation `kitSize`.
- `src/lib/storefront/variations.ts` (`Variation.kitSize`), `src/lib/storefront/variation-plan.ts`, `src/app/api/mcp/route.ts` (`kitSize` in two schemas).
- `src/lib/orders/db-mapping.ts`, `src/lib/orders/apply-status.ts` + the bulk path in `src/actions/orders.ts` (`stockItems`), `src/lib/orders/tracked-order.ts`, `src/lib/storefront/order-confirmation.ts`.
- `src/lib/storefront/group-buy.ts` (`GroupBuy.stage` from the row only), `group-buy-banner.ts`, `gb-round-demand.ts` (per-variation `lines`), `storefront-brand.ts`, `src/lib/mobile/group-buy-share.ts`, `order-rounds(.server).ts`, `shop-orders.ts`.
- `src/actions/group-buys.ts`: `stageSyncForSave` in save; kit-rule report + ordering-ended guard.
- `src/lib/features/catalog.ts`, `src/lib/storefront/group-buy-server.ts`.

## Open questions
1. **Fully-ligwak'd orders** keep their status (their total goes to 0, or to the kept QR PH fee). Should Lock also mark them `cancelled`? My default: no, because a status change would also fire customer emails and stock moves.
2. **Payment time without Ligwak** (a Bunuan-only store): there is no re-total, so `amountDue` is NULL and 3B should show the order's total.
3. **Admin edit re-pricing:** the admin fee and discount snapshots are kept as charged. A percentage admin fee isn't re-charged on edits (it is at the Ligwak lock).
4. **3C:** `setGbStageAction` / `setStage` (it returns `move: { from, to }`), `finishBunuanOrder` and `lockLigwak` are the hook points. 2A sends no notifications and doesn't move `sendGroupBuyInvoices`.

## Live DB
_(filled in after the owner approves the push — see below)_
