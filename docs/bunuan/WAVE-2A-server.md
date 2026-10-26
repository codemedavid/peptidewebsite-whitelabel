# Wave 2A — schema, live DB, server actions

Branch `bunuan/2a-server` (from `feat/mobile-admin-app` AFTER 1A + 1B are merged), worktree `../pepweb-2a`, port 3121. Read README.md, HANDOFF-1A.md, HANDOFF-1B.md first.

**Goal:** wire the 1A rules to the database and server, so Wave 3 only builds screens. You are the ONLY wave that edits `prisma/schema.prisma` or the live database.

## Schema (additive only)
- `GroupBuy`: `stage String @default("open")` (open|bunuan|closed|payment — keep `status` as is; liveness code reads `status`+`endsAt`), `stageChangedAt`, `paymentMode String?` (snapshot from 1B's `gbPaymentModeFor` when the round opens), `paymentDueAt DateTime?`, `ligwakLockedAt DateTime?`.
- Variation `kitSize` lives in product `metadata.variations[]` (no column): carry it through product-mapping both ways and `normalizeProductInput` (+ MCP `manage_product_variations`), or admin saves wipe it.
- New `GbAllocation` (round, version, lockedAt, lockedBy) + `GbAllocationEntry` (order id, line key, variation, quantity, successQty, cancelledQty, kitSize snapshot, suggestion, decision ligwak|keep) + append-only `GbAuditEvent` (stage changes, order edits, ligwak decisions, lock, recalculate, refunds). DB CHECK `successQty + cancelledQty = quantity`.
- `StorefrontOrder`: `originalTotal`, `adjustedTotal`, `amountDue`, `refundDue`, `refundStatus` (for_review|refund_pending|refunded), `refundReference` — all nullable; NULL = never allocated, so every existing order reads exactly as today.
- Update `prisma/rls.sql` + `src/lib/db/tenant-client.ts` for the new tables like the paid_access ones.

## Live DB procedure (outward-facing — ask the owner before step 3)
1. `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` must show ONLY your additions (no DROP).
2. Feature rows `groupbuy.bunuan`, `groupbuy.ligwak` (OPERATOR_GRANTABLE, default OFF) — targeted upsert, NOT `db:sync-features`.
3. `prisma db push`, then re-run `prisma/lockdown-public-api.sql`, then the diff again (must be empty).

## Server (put in `src/modules/bunuan/server` + `src/modules/ligwak/server`, actions in each module's `actions.ts`)
- `setGbStageAction(roundId, stage)` — uses `allowedNextStages`; blocks Start Bunuan on pay_first blockers (returns the list); audits.
- **Bunuan cap at checkout** (`src/actions/orders.ts` `validateLiveOrder`): when the round is in `bunuan`, inside the order transaction lock the round row (`SELECT … FOR UPDATE` on group_buys, or `pg_advisory_xact_lock(hashtext(id))`), recount live with `tallyKits`, `clampToBunuan`, reject over-limit lines with a clear message. Auto-move to `closed` when `allKitsFilled`. Respect Paid Access access (`src/lib/storefront/gb-access.server.ts`).
- **Concurrency test:** two buyers race for the last vials → exactly the allowance is sold.
- `editOrderLinesAction(orderId, lines)` — staff `groupbuys`/orders permission, `repriceEditedLines`, stock moves via `src/lib/storefront/inventory.ts`, audit, locked at `payment` stage, warning flag when over the Bunuan allowance.
- Ligwak: `previewLigwakAction(roundId)`, `decideLigwakAction(roundId, decisions)`, `lockLigwakAction(roundId)` (writes allocation + order totals via `recalculateOrder`), `recalculateLigwakAction(roundId, reason)` (explicit, audited).
- Refunds (pay_first): `setRefundStatusAction(orderId, status, reference)` capped at amount paid.
- Supplier report (`src/lib/storefront/group-buy-report.ts`, `src/storefront/admin/supplier-workbook.ts`): use the 1A counting rule + allocation (success qty only), kits per variation via `withKitColumns`.
- Kit tally for display (`gb-round-demand.ts`, cached) switches to per-variation keys.
- All 6 order-total surfaces (grep `adminFee`) read `adjustedTotal` when set.
- Register every new action in `BRIDGED_ACTIONS` (`src/lib/mobile/admin-bridge.ts`); add contract types to `src/lib/mobile/shop-contract.ts` (customer order lines with variation, line status, totals, stage) — Wave 3 depends on these, so finish and freeze them first and list them in your hand-off.
- Caps: `resolveGroupBuyCaps` → `caps.bunuan`, `caps.ligwak`.

**Done when:** new PGlite tests `test:bunuan-db`, `test:bunuan-flow` (checkout cap + race + auto-close), `test:ligwak-flow` (suggest → decide → lock → totals → recalc), `test:gb-order-edit` green; all existing GB/order/mobile suites green; both `tsc` clean; live diff empty; HANDOFF-2A.md lists every action + contract type.
