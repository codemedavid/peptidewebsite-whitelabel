# TDD evidence — Dragon Peptides catalog import

**Source plan**: none on disk. Journeys were derived during the `/ecc:plan` run that
preceded this work; the plan was presented inline and approved with "proceed".

**Date**: 2026-08-03
**Branch**: `feat/gb-pricing-tab`
**Commits**: `a8f6c75` (RED) → `c177361` (GREEN) → `e73d29a` (data backfill) → `d14d7e7` (import)

---

## User journeys

1. As a **K Glow shopper**, when I pick the 30mg Retatrutide option during a live
   group buy, I am charged the 30mg group price — not the 5mg one — so the store
   is not selling ₱9,924 of product for ₱3,866.
2. As a **Dragon Peptides store owner**, each size of a grouped product carries
   its own group-buy price, so a multi-size listing prices every option correctly
   inside a round.
3. As a **store owner**, if I leave an option's group price blank, that option
   sells at its own regular price rather than silently inheriting a discount
   meant for a different size.
4. As the **Dragon Peptides operator**, my supplier sheet becomes a live catalog
   with both price legs intact and distinct molecules kept in separate products.

---

## What changed, and why it was not just an import

The request was to import a price list. The sheet prints **two** prices per row
(GB and on-hand), so grouping sizes into variations required a variation to hold
two prices. It could not: `ProductMetadata.variations` was `{name, price, stock?}`,
and `makeVariationEntry` spread `...product`, so a variation clone silently kept
the **base product's** `gbPrice`.

A Phase-0 check of live data (not an assumption — the original plan assumed the
opposite and was wrong) found **22 k-glow products** already carrying both a
`gbPrice` and variations. The undercharge was live on real money.
`unitPrice`'s `Math.min` blocked the overcharge direction, so only undercharging
occurred.

---

## Task report

### Task 1 — reproduce the mispricing (RED)

Wrote `scripts/test-variation-gb-pricing.ts` pinning the intended contract.

```
$ npm run test:variation-gb-pricing
  ✗ carries the variation's OWN gbPrice onto the cart entry — expected the 30mg gbPrice, got 3866
  ✗ does NOT inherit the base gbPrice when the variation has none — got 3866
  ✗ THE LIVE BUG: k-glow Retatrutide 30mg no longer charges the 5mg price
  ✗ an option WITH its own gbPrice is charged that price — 3866 !== 8500
  ✗ HXTNT Reta: each size is charged its own group-buy price — 10mg in-round — 365 !== 550
  ✗ preserves a positive per-variation gbPrice — undefined !== 1704
  …
8 passed, 9 failed
```

Failures are business-logic, not setup: the suite compiled and ran, and each
failure is the base `gbPrice` leaking or the new field being absent.

### Task 2 — per-variation `gbPrice` (GREEN)

| File | Change |
|---|---|
| `src/storefront/types.ts` | `variations[].gbPrice?: number` |
| `src/lib/storefront/product-mapping.ts` | `cleanVariations(v, keepGbPrice)` — only a `gb` product stores/reads a per-option group price, and only a positive one persists a key |
| `src/lib/storefront/product-input.ts` | same positive-only rule at the admin editor boundary |
| `src/storefront/checkout.ts` | **the fix** — the clone takes the variation's `gbPrice`; no variation price ⇒ `undefined`, never the base |

Fail-safe direction: an option with no group price sells at its **own** price.
Never cheaper than the seller listed. `Math.min` still prevents the reverse.

```
$ npm run test:variation-gb-pricing
17 passed, 0 failed
```

### Task 3 — a pre-existing test had encoded the bug

`scripts/test-group-buy-pricing.ts` asserted a 10mg option priced ₱900 with no
group price of its own bills at ₱560 — the base option's price. That is the
pathology written down as a spec, so the test was wrong and was corrected.

Its *real* guarantee — that the server's `authoritativeItemPrice` agrees with the
cart's `unitPrice` — was untouched and **passed unchanged** through the fix (both
moved to 900 together). Only the hard-coded literal moved. A second case was
added proving the server honours an option's own group price.

```
$ npm run test:group-buy-pricing
19 passed, 0 failed
```

### Task 4 — restore the discounts the fix removed

The fix drops the group price on options that had none — correct, but it also
dropped it on the one option the old single number *was* right for: the base
option, where `gbPrice` sat below it. `scripts/backfill-variation-gb-price.ts`
restores exactly that leg (dry-run by default), with a ₱1 floor so cents-rounding
noise (PT-141's ₱4,854.60 vs ₱4,854) cannot persist a phantom group price.

```
$ npx tsx scripts/backfill-variation-gb-price.ts --apply
APPLY — 220 products, 22 with a product-level gbPrice + variations
19 left alone, 3 to backfill:
  k-glow/5AMINO1MQ-OH  5-Amino-1MQ  · "5mg × 10 vials" ₱2800 → gb ₱2400 (save ₱400)
  k-glow/GHKCU-OH      GHK-CU       · "100mg × 10 vials" ₱2980 → gb ₱2880 (save ₱100)
  k-glow/SEMAX         Semax        · "5mg × 10 vials" ₱3038 → gb ₱2650 (save ₱388)
Backfilled 3 product(s).

$ npx tsx scripts/backfill-variation-gb-price.ts    # idempotent
0 to backfill
```

### Task 5 — transcribe and group the sheet

`scripts/lib/dragon-pricelist.ts`: 175 printed rows → 172 unique → 88 families.

Three duplicates dropped: BPC-157 5mg and 10mg are each printed twice with
rounding drift (263.04 vs 263, 387.2 vs 387 — the more precise kept); BPC-157 +
TB500 BB20mg is printed twice identically.

**The family split is curated, not parsed.** Splitting on the last `-` looks
correct and is not: peptide names contain hyphens, so it merges BPC-157 with
BPC-157+TB-500 and GHRP-2 with GHRP-6 — different molecules at different prices
inside one product.

```
$ npm run test:dragon-pricelist
22 passed, 0 failed
```

### Task 6 — seed and verify

```
$ npx tsx scripts/seed-dragon-products.ts --apply
✓ upserted 88 products — dragon-peptides now has 88
0 product(s) already in the catalog; 0 not covered by this sheet

$ npx tsx scripts/seed-dragon-products.ts          # idempotent
88 product(s) already in the catalog; 0 not covered by this sheet
```

End-to-end read-back through the real modules
(`dbProductToStorefront` → `makeVariationEntry` → `unitPrice`):

```
88 products read back
172 options checked; 0 priced wrong in a live round
HXTNT Reta 60mg -> in-round 1704 (want 1704), out 1904 (want 1904)
```

---

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A variation clone carries its own `gbPrice`, not the base product's | `test-variation-gb-pricing.ts:makeVariationEntry` | unit | PASS |
| 2 | An option with no group price does not inherit one | same | unit | PASS |
| 3 | k-glow Retatrutide 30mg bills ₱9,924, not ₱3,866, in a live round | same:`THE LIVE BUG` | unit | PASS |
| 4 | A variation `gbPrice` above the option price never raises the line | same | unit | PASS |
| 5 | The base product with no option chosen keeps its own `gbPrice` | same | unit | PASS |
| 6 | A non-`gb` product ignores variation `gbPrice` entirely | same | unit | PASS |
| 7 | Blank/zero/negative never persists a key (admin boundary + DB round-trip) | same | unit | PASS |
| 8 | Server `authoritativeItemPrice` agrees with cart `unitPrice`, both legs | `test-group-buy-pricing.ts` | integration | PASS |
| 9 | On-hand = GB + ₱200 on all 172 transcribed options | `test-dragon-pricelist.ts` | unit | PASS |
| 10 | 88 families / 172 options; no duplicate SKU, slug, name, or size | same | unit | PASS |
| 11 | BPC-157, BPC-157+TB-500, GHRP-2, GHRP-6, and the three CJC-1295 variants stay separate products | same | unit | PASS |
| 12 | Base price is the cheapest option in both legs; options ordered cheapest first | same | unit | PASS |
| 13 | The picker shows real size labels, never a nameless "Standard" | same | unit | PASS |
| 14 | Bacteriostatic water classed `bacWater`; no serum classed `peptide` | same | unit | PASS |
| 15 | Every one of 172 seeded options prices correctly from the DB, in and out of a round | manual read-back (Task 6) | e2e | PASS |

## Regression sweep

All green after the fix:

```
variation-gb-pricing 17  cart 15  two-ways 18  two-ways-cart 20  two-ways-home 28
two-ways-mode PASS  group-buy-pricing 19  gb-pricing 33  group-buy-page 37
product-variations 30  variant-inventory 33  variation-price-reveal 9
checkout-names 10  checkout-total 13  kglow-pricelist PASS  kglow-onhand PASS
reseller-gate 14  onhand-gate 9  onhand-order PASS  stock-gate 41
product-add-gates 21  product-detail 20  gb-ratio 34  gb-e2e 50  gb-assignment 23
dragon-pricelist 22
```

`npx tsc --noEmit` — clean.

## Known gaps and follow-ups

- **No coverage tool.** This repo has no instrumented coverage runner; the
  80% target is met in spirit by pinning behaviour on every changed module,
  not by a measured number. Stated plainly rather than reported as a figure.
- **Group Buys → Pricing tab is unchanged.** `gb-pricing.ts` /
  `AdminGroupBuyPricing.tsx` still edit only the *product-level* group price.
  Per-option prices are editable in the product editor. Adding per-variation
  rows to that tab is the natural follow-up.
- **`AdminAddProduct.tsx` has no per-variation GB price input yet.** The field
  round-trips through `normalizeProductInput` and the DB, and the seed writes it,
  but an owner cannot type one per option in the UI. This is the main remaining
  piece of the feature.
- **`gbPrice` only applies while a round is live and in scope.** With no live
  round the whole Dragon Peptides catalog sells at the on-hand leg — ₱200 higher
  everywhere. Correct behaviour, but worth knowing before the store opens.
- **The 22 k-glow products' larger sizes now bill at their list price.** That is
  the fix working. If the owner intended a group discount on those sizes, they
  must enter one per option — inventing one here was deliberately avoided.
