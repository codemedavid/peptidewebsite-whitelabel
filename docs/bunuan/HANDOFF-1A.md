# Hand-off — Wave 1A (pure logic)

Branch `bunuan/1a-core` (from `feat/mobile-admin-app` @ 7a4d7c9). No DB, no UI, no `orders.ts`, no `schema.prisma`, no Paid Access, no mobile changes.

`npm run test:bunuan` → **137 passed, 0 failed** (6 suites). `npx tsc --noEmit` clean. Every rule was mutation-checked: 22 mutants, 21 killed; the survivor is equivalent (removing the `pay_later` early return in `bunuanStartBlockers` gives the same result).

| Suite | Tests | Covers |
|---|---|---|
| `test:gb-kits` | 36 | kit key = `productLineKey`, kit size per variation, `kitMath`, counting rule per mode, untrusted items JSON, tally, per-variation supplier columns |
| `test:bunuan-core` | 21 | 143 @ 10 → 7 open, exact multiple / no orders / no size = closed, the cap (8th vial rejected), shared allowance, **two-buyer race**, cancellation re-opens, pay_first blockers, edit warnings |
| `test:ligwak-core` | 24 | 15 @ 10 → 10 + 5, the 8+5 split, exact multiples, ties (placedAt → numeric orderNumber → id), store-added vials newest, per-variation kits, counting rule, decisions (ligwak/keep/undecided/stale), line status labels |
| `test:gb-totals` | 19 | equals `computeOrderTotals` when nothing is cancelled, partial / all cancelled, promo proration + centavo rounding, 100%-off keeps shipping, fixed vs % admin fee, QR PH re-charge, refund cap, amount due |
| `test:gb-stage` | 21 | hand-written transition matrix, forward-only, Start Bunuan blocked / skipped, Payment time waits for the Ligwak lock, auto-close, `canOrder`, `editsLocked` |
| `test:gb-reprice` | 16 | snapshot price kept, removal, catalog pricing (gbPrice in a round, regular outside), raise = appended newer line, browser price ignored, refusals |

Existing suites re-run green: `gb-moq-kits` 26, `gb-report` 36, `gb-report-orders` 22, `gb-rounds` 13, `sale-price` 37.

## Exported API

### `src/lib/storefront/gb-kits.ts` — kit identity, size, the ONE counting rule
```ts
type GbPaymentMode = "pay_first" | "pay_later"
type KitLine  = { index; name; qty; productId?; variation?; cancelledQty?; placedAt? }
type KitOrder = { id; orderNumber?; placedAt: string /* ISO, = createdAt */; status; paymentStatus?; items: unknown }
type KitProduct = { id; vialsPerKit?: unknown; variations?: { name; kitSize?: unknown }[] }
type KitTallyEntry = { key; productId: string|null; variation: string|null; name; vials; kitSize: number|null; fullKits; leftover; vialsNeeded }
type KitTally = Readonly<Record<string, KitTallyEntry>>

kitKey(line): string                                   // === productLineKey(line)
normalizeKitSize(raw): number | undefined              // = normalizeVialsPerKit
kitSizeFor(product, variationName?): number | null     // variation.kitSize → product.vialsPerKit → null
kitMath(vials, kitSize): { fullKits, leftover, vialsNeeded }
countsTowardKits(order, mode): boolean                 // pay_first: committed & not cancelled; pay_later: orderCountsAsDemand
readKitLines(items: unknown): KitLine[]                // untrusted JSON; keeps original index
countedVials(line): number                             // qty − cancelledQty
indexProducts(products): ReadonlyMap<string, KitProduct>
kitSizeForLine(line, index): number | null
tallyKits(orders, products, mode): KitTally            // counter, cap, report all read this
withLineKitColumns(rows, products): rows & KitColumns  // supplier rows per VARIATION
```

### `src/lib/storefront/gb-stage.ts`
```ts
GB_STAGES = ["open","bunuan","closed","payment"]; type GbStage
type StageContext = { hasBunuan; hasLigwak; paymentMode; ligwakLocked; blockers: number; allKitsFilled? }
type StageOption  = { stage; allowed; reason?; skipsTo? }
normalizeGbStage(raw): GbStage                         // unknown/missing → "open"
stageLabel(stage): "Open" | "Bunuan time" | "Closed" | "Payment time"
allowedNextStages(current, ctx): StageOption[]         // buttons, blocked ones carry `reason`
resolveStageMove(current, target, ctx): { ok:true; stage; skipped } | { ok:false; reason }
autoAdvance(current, { allKitsFilled }): GbStage       // bunuan → closed
canOrder(stage): boolean                               // open, bunuan
editsLocked(stage, ligwakLocked = false): boolean      // payment, or Ligwak locked
```

### `src/modules/bunuan/core` (`rules.ts`, barrel `index.ts`)
```ts
type BunuanLine = { name; qty; productId?; variation? }
type BunuanRejection<L> = { line: L; key; asked; allowed; reason: "not_open" | "over_limit"; message }
type BunuanBlocker = { id; orderNumber?; placedAt }
bunuanOpenItems(tally): KitTallyEntry[]                // vialsNeeded > 0, by name
bunuanAllowance(tally, key): number
allKitsFilled(tally): boolean                          // {} → true
clampToBunuan(lines, tally): { accepted: L[] /* trimmed */; rejected: BunuanRejection<L>[] }
bunuanStartBlockers(orders, mode): BunuanBlocker[]     // pay_first unchecked, oldest first; pay_later → []
bunuanEditWarnings(kitDeltas, tally): string[]
```

### `src/modules/ligwak/core` (`allocate.ts`, barrel `index.ts`)
```ts
type LigwakEntry = { id /* `${orderId}#${lineIndex}` */; orderId; orderNumber?; lineIndex; key; name; productId; variation;
                     placedAt; quantity; kitSize /* snapshot */; keepQty; suggestQty }
type LigwakKit   = { key; name; variation; kitSize; vials; fullKits; keepVials; ligwakVials }
type LigwakPlan  = { entries: LigwakEntry[] /* walk order */; kits: LigwakKit[] }
type LigwakDecision = { entryId; suggestQty; choice: "ligwak" | "keep" }
type LineStatus = "pending" | "success" | "partial" | "cancelled"
type LigwakLineResult = { entryId; orderId; lineIndex; key; quantity; successQty; cancelledQty; lineStatus; decision }

suggestLigwak(orders, products, mode): LigwakPlan      // raw qty (ignores earlier cancelledQty)
ligwakSuggestions(plan): LigwakEntry[]                 // suggestQty > 0
applyLigwakDecisions(plan, decisions): { lines; undecided: LigwakEntry[]; complete }
cancellationsByOrder(lines): Record<orderId, Record<lineIndex, { cancelledQty }>>  // feeds recalculateOrder
lineStatusFor(quantity, cancelledQty): "success" | "partial" | "cancelled"
lineStatusLabel(r): "Pending" | "Success" | "Cancelled" | "2 Success · 3 Cancelled"
```

### `src/lib/orders/gb-totals.ts`
```ts
type TotalsOrder  = Pick<Order, "items"|"discount"|"adminFee"|"paymentFee"> & { shipping: { fee } }
type LineOutcomes = Readonly<Record<number, { cancelledQty }>>
type GbRecalc = { subtotal; successSubtotal; discount; shipping; adminFee; paymentFee; originalTotal; newTotal;
                  cancelledAll; amountPaid; amountDue; refundDue; nextAction: "collect"|"refund"|"none"; mode }
recalculateOrder(order, outcomes, mode, amountPaid, opts?: { adminFeePercent? }): GbRecalc
```

### `src/lib/orders/gb-order-edit.ts` (brief item 6)
```ts
type EditedLine = { index?: number; productId?; variation?; qty: unknown }   // whole edited list
type EditedOrderItem = OrderItem & { placedAt?: string; addedBy?: "store" }
type LineChange = { kind: "added"|"removed"|"qty"; key; name; variation; fromQty; toQty; price }
repriceEditedLines(current, edited, catalog, { scope?: GroupBuyPriceScope|null; now: ISO })
  → { ok:true; items: EditedOrderItem[]; changes: LineChange[]; kitDeltas: Record<key, number> } | { ok:false; error }
```

## Notes for Wave 2A (please read)

1. **Order line JSON gains three optional fields:** `cancelledQty` (ligwak'd vials), `placedAt` (when store-added vials were added) and `addedBy: "store"`. Whatever normalizes `StorefrontOrder.items` must pass them through, or the kit tally and the Ligwak ordering silently lose them. The other option is to project `GbAllocationEntry` onto the lines before calling `tallyKits`; `readKitLines` reads either.
2. **Variation kit size is `metadata.variations[].kitSize`.** The product size stays `vialsPerKit`. Carry `kitSize` through product-mapping, `normalizeProductInput` and MCP `manage_product_variations`.
3. **`GbPaymentMode` is declared in `gb-kits.ts`** with the same union 1B puts in `gb-payment-mode.ts`. They're structurally identical; after both merge, make one re-export the other.
4. **The supplier report** should switch from `withKitColumns` (per product) to `withLineKitColumns` (per variation) and count with `tallyKits`/`countsTowardKits`. `gb-round-demand` and `KitProgressBar` still tally per product (`tallyKitVials`); I left them alone.
5. **`recalculateOrder` needs `adminFeePercent`** when the store's admin fee is in percentage mode, because the order snapshot doesn't record the mode. Read it from `config.adminFee`.
6. **`KitOrder.placedAt` = `StorefrontOrder.createdAt.toISOString()`.**
7. **Line results map back by `lineIndex`,** the index in the order's `items` array. Lines with qty ≤ 0 are skipped but keep their indices.

## Files touched outside the brief's list
- `src/lib/storefront/group-buy.ts`: new export `orderCountsAsCommitted(status, paymentStatus?)`. `isCommitted` now delegates to it, with no behaviour change, so the pay_first rule and the supplier report share one definition.
- `src/lib/orders/gb-order-edit.ts` and `scripts/test-gb-reprice.ts`: new. The brief's item 6 named no file. The script is `test:gb-reprice`, because 2A owns `test:gb-order-edit`.
- `package.json`: 7 scripts.

## Open questions (my default, in bold)
1. **Reopening a round.** The stages are **forward-only**, with no Closed → Open. Should an admin be able to reopen before the Ligwak lock?
2. **QR PH fee on a pay_first refund.** When vials are cancelled, the 2% fee is **re-charged on the new base**, so its difference is part of the refund. The store may not get that fee back from QR PH. Alternative: keep the fee as charged.
3. **Edits after the Ligwak lock.** `editsLocked` is **true once Ligwak is locked**, which is stricter than "locks at Payment time". An edit after the lock would invalidate the allocation, so the admin presses Recalculate first.
4. **Bunuan timer.** No `bunuanEndsAt`. Bunuan ends by admin action or **automatically when every kit fills**, matching 2A's schema.
