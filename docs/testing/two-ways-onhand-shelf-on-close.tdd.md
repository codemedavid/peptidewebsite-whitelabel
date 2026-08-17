# On-hand shelf must not change when a group-buy round closes

**Date:** 2026-08-17
**Reported:** "when the groupbuy is close the onhand page gets the groupbuy prices instead of staying as is" (k-glow, symptom visible **on the product cards themselves**).
**Source plan:** none — journeys were derived during this TDD run from the bug report and the live k-glow catalog.

## User journey

> As a K Glow shopper, when the group buy round is closed, I want the on-hand
> shelf to keep showing only the ready-stock products, so I am never offered
> group-buy pre-order items at group-buy prices as if they ship now.

## Root cause

`buildTwoWaysHomeView` (`src/lib/storefront/two-ways-home.ts`) resolved on-hand
membership from the **live round's scope alone**:

```ts
const inRound = (p) => !!banner && (banner.coversAll || covered?.has(p.id));
products.filter((p) => !inRound(p))       // ← everything when banner === null
```

The `productType: "gb"` tag — the intrinsic split between a ships-now product and
a group-buy pre-order — was never consulted. So when a round closed (status
`closed`, or its window lapsed so `liveGroupBuys` returned nothing, or the round
was archived), `buildGroupBuyBanner` returned `null`, `inRound` became `false`
for every product, and **every group-buy listing fell back onto the ships-now
shelf at its group-buy price**.

k-glow is the worst case because its catalog is two separately-seeded sets
(`scripts/seed-kglow-products.ts` PasaBuy listings + `scripts/seed-kglow-onhand.ts`
"-OH" rows, which are explicitly documented as "ADDED ALONGSIDE the group-buy
products, never replacing them").

Only the shelf was affected. Display prices themselves were always correct
(`onHandLine`, `resolveSelectedPrice` and `product-cta` all read `product.price`,
never `gbPrice`); the defect was **which products reached the shelf**, and those
products carry group-buy prices.

## Fix

A product is ships-now stock only when it is **neither** in the live round **nor**
tagged `productType: "gb"`:

```ts
const isOnHandStock = (p) => !isGroupBuyProduct(p) && !inRound(p);
```

Round scope still drives the teaser's membership (`gb.productIds` / `gb.count`),
so an owner can still pull an untagged product into a round — the case test 4
pins — and the group-buy page cross-check invariant is untouched.

## Task report

| Task | Execution summary | Validation command | Result |
|---|---|---|---|
| Reproduce | Added a k-glow-shaped fixture (gb listings + "-OH" rows) asserting the shelf is identical live vs closed; updated 2 cases that encoded the round-scope-only rule | `npm run test:two-ways-home` | **RED** — `3 failed, 29 passed` |
| Fix | `buildTwoWaysHomeView` excludes gb-tagged products from the shelf as well as round members | `npm run test:two-ways-home` | **GREEN** — `32 passed, 0 failed` |
| Regression sweep | Every neighbouring suite that consumes `buildTwoWaysHomeView` or the two-ways rules | see table below | all PASS |
| Typecheck | Production source | `npx tsc --noEmit --incremental` | clean, no output |

RED output:

```
✗ no live round yields a closed, empty group-buy path — Expected values to be loosely deep-equal:
✗ a closed round never returns group-buy listings to the on-hand shelf — closing the round must leave the on-hand shelf exactly as it was
✗ scoped round claims only assigned products, even among gb-tagged ones — Expected values to be loosely deep-equal:
29 passed, 3 failed
```

GREEN output: `32 passed, 0 failed`.

## Test specification

| # | What is guaranteed | Test file or command | Type | Result |
|---|---|---|---|---|
| 1 | Closing a round leaves the on-hand shelf byte-identical to what it was while the round ran (k-glow catalog shape) | `scripts/test-two-ways-home.ts:a closed round never returns group-buy listings to the on-hand shelf` | unit | PASS |
| 2 | With no live round, a gb-tagged product stays off the shelf while an untagged one stays on it | `scripts/test-two-ways-home.ts:no live round yields a closed, empty group-buy path` | unit | PASS |
| 3 | A gb-tagged product outside a live round is off the shelf, but only round members are counted by the teaser | `scripts/test-two-ways-home.ts:scoped round claims only assigned products, even among gb-tagged ones` | unit | PASS |
| 4 | An **untagged** product pulled into a live round still leaves the shelf (owner override preserved) | `scripts/test-two-ways-home.ts:scoped round claims assigned products, rest stay on-hand` | unit | PASS |
| 5 | Hiding the group-buy way still does not spill the round's pre-orders onto the shelf | `scripts/test-two-ways-home.ts:hiding the group-buy way does NOT spill the round's products onto the shelf` | unit | PASS |
| 6 | The home and the group-buy page never disagree about round membership | `scripts/test-group-buy-page.ts` cross-check | unit | PASS (37) |
| 7 | Per-way open/closed/hidden states unchanged | `npm run test:two-ways-mode` | unit | PASS |
| 8 | Pre-order stock exemption + no-mixed-carts unchanged | `npm run test:two-ways-cart` | unit | PASS (20) |
| 9 | Shelf availability still reads the shared inventory rules | `npm run test:stock-gate` | unit | PASS (41) |
| 10 | Two-ways core (`splitTwoWays`, `groupBuyLine`, `slotProgress`) unchanged | `npm run test:two-ways` | unit | PASS (18) |
| 11 | Tenant presets that flip the two-ways home unchanged | `npm run test:tenant-presets` | unit | PASS (65) |
| 12 | k-glow seed fixtures unchanged | `npm run test:kglow-pricelist`, `npm run test:kglow-onhand`, `npm run test:onhand-order` | unit | PASS |

## Live k-glow audit (read-only)

Run against the live DB while round **"Group buy batch 2"** was active
(46 assigned, ends 2026-08-14). 52 active products: **48 tagged `gb`, 4 on-hand**.

| Shelf contents | Before fix | After fix |
|---|---|---|
| Round live | 6 products | 3 products |
| Round closed | **52 products** (the bug) | 3 products |

Data drift found — the tag no longer matches how the products are actually sold:

- **3 products tagged `gb` but not in any round** — `Tirzepatide 30mg` (₱1,050,
  stock 20), `Tirzepatide 15mg` (₱800, stock 10), `Fat blaster` (₱3,824, stock
  50). These sit on the shelf today and the fix removes them, because the tag
  says pre-order. They look like ready stock that was mis-tagged.
- **1 product untagged but assigned to the live round** — `Bacteriostatic Water`
  (₱488, stock 83). Deliberate: the peptide↔bac-water ratio rule needs it inside
  the round or the no-mixed-carts rule would block it from group-buy carts. It
  correctly returns to the shelf between rounds.
- 0 duplicate names across the two ways (the older duplicate-row drift is gone).

## Coverage and known gaps

This repo uses bespoke `tsx` assertion scripts, not a coverage instrument, so
there is no line-coverage number to quote. Behavioural coverage of the changed
function is table rows 1–5 above (both close paths — owner-closed way and lapsed
round — plus the owner-override case that must keep working).

Not covered / deliberately out of scope:

- **No browser/visual check.** The rendered k-glow shelf was not re-verified in
  Chrome after the fix.
- **The 3 mis-tagged products are a data fix, not a code fix.** Until they are
  re-tagged `onhand`, deploying this removes them from the shelf.
- **Pre-existing unrelated failure:** `npm run test:legacy-import` →
  `✗ parses all 487 historical orders — 0 == 487` (35 passed, 1 failed). It
  parses the local `db_cluster-05-08-2026@01-12-58.backup` dump via
  `parseLegacyOrders` and has no coupling to two-ways. Not introduced here, not
  fixed here.

## Merge evidence

- RED: `d2863c0` `test: add reproducer for group-buy listings falling onto the on-hand shelf when a round closes` — 3 failed, 29 passed.
- GREEN: `ad49889` `fix(storefront): keep group-buy listings off the on-hand shelf when a round closes` — 32 passed, 0 failed; `tsc --noEmit` clean.
- Refactor: none required; the change is a single predicate plus documentation.
