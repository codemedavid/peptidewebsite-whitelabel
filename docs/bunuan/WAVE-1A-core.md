# Wave 1A — pure logic (Bunuan + Ligwak + totals + stages)

Branch `bunuan/1a-core`, worktree `../pepweb-1a`, port 3111. Read README.md first.

**Goal:** every rule as pure, zero-DB, JSON-safe functions with thorough unit tests, so Waves 2–3 only wire them up.

## Files you own (new)
- `src/lib/storefront/gb-kits.ts` — kit identity + tally. Evolves `gb-moq-kits.ts` (which tallies by productId today; keep its exports working, re-export or delegate).
- `src/lib/storefront/gb-stage.ts` — stage model.
- `src/modules/bunuan/core/*` — Bunuan rules (+ `index.ts`). Mirror the layout of `src/modules/paid-access/core`.
- `src/modules/ligwak/core/*` — Ligwak suggestion + decisions.
- `src/lib/orders/gb-totals.ts` — recalculated totals.
- `scripts/test-gb-kits.ts`, `scripts/test-bunuan-core.ts`, `scripts/test-ligwak-core.ts`, `scripts/test-gb-totals.ts`, `scripts/test-gb-stage.ts` + `package.json` scripts (`test:bunuan` runs all five).

Do NOT edit `orders.ts`, `schema.prisma`, any UI, or anything in `src/modules/paid-access`.

## What to build
1. **Kit key + size** — `kitKey(line)` = `productLineKey` from `src/lib/storefront/group-buy.ts` (product + variation). `kitSizeFor(product, variationName)` = variation `kitSize` → product `vialsPerKit` → null. Normalizer for `kitSize` (reuse `normalizeVialsPerKit` rules).
2. **Counting rule** — `countsTowardKits(order, paymentMode)`: pay_first → confirmed-or-later status (see `COMMITTED_STATUSES` in group-buy.ts) and not cancelled; pay_later → `orderCountsAsDemand`. `tallyKits(orders, products, paymentMode)` → per kit key `{ vials, kitSize, fullKits, leftover, vialsNeeded }` (`vialsNeeded` = 0 when leftover is 0).
3. **Bunuan** — `bunuanOpenItems(tally)` (only keys with vialsNeeded > 0), `bunuanAllowance(tally, key)`, `clampToBunuan(lines, tally)` → `{ accepted, rejected[] with reason }` for the checkout cap, `allKitsFilled(tally)`, `bunuanStartBlockers(orders, paymentMode)` (pay_first orders awaiting a payment check).
4. **Ligwak** — `suggestLigwak(orders, products, paymentMode)`: per kit key, sort eligible orders oldest-first (`placedAt`, then `orderNumber`, then `id`), fill whole kits, the remainder = suggestions from the LAST placed vials, splitting a line per vial (5 ordered → 2 kept, 3 suggested). Snapshot `kitSize` on each entry. `applyLigwakDecisions(suggestions, decisions)` → per order line `{ quantity, successQty, cancelledQty, lineStatus: pending|success|partial|cancelled }` where Keep moves vials back to success. Never mutate inputs.
5. **Totals** — `recalculateOrder(order, lineResults, paymentMode, amountPaid)`: `items = Σ successQty × unitPrice × (totalAfterDiscount / subtotal)` (promo prorated), `shipping = items > 0 ? shippingFee : 0`, keep admin/processing fee rules consistent with how they are charged today (check `adminFee`/`paymentFee` handling), `newTotal`; pay_later → `amountDue`, all-cancelled → order cancelled, nothing due; pay_first → `refundDue = min(paid, paid − newTotal)` floored at 0. Integer centavos/pesos as the codebase does — check before choosing.
6. **Order edit repricing** — `repriceEditedLines(lines, catalog)` for admin edits (server re-prices from the catalog; client prices ignored).
7. **Stages** — `GbStage = open | bunuan | closed | payment`; `allowedNextStages(current, { hasBunuan, hasLigwak, paymentMode, ligwakLocked, blockers })`, `canOrder(stage)`, `editsLocked(stage)`; Bunuan → closed automatically when `allKitsFilled`.

## Must-have tests
15 vials @10 → 1 kit + 5 ligwak; 143 @10 → 7 needed; the 8+5 split; exact multiples (nothing open, nothing suggested); ties by orderNumber then id; variation kit size overriding product; missing kit size = not in Bunuan; pay_first vs pay_later counting; clamp rejects the 8th vial when 7 are open; discount proration + shipping rule; all-cancelled; refund cap; stage transitions incl. Payment time blocked until Ligwak locked; inputs not mutated.

**Done when:** `npm run test:bunuan` green, `npx tsc --noEmit` clean, HANDOFF-1A.md written with every exported signature.
