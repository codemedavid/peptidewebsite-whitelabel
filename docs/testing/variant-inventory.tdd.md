# TDD Evidence — Per-Variation Inventory & Availability

**Feature:** Inventory & availability tracked *per product variation*, not just per product.
**Command:** `/ecc:plan` → `/ecc:tdd-workflow proceed`
**Date:** 2026-07-24
**Branch:** main

## Problem

`Product.stock` was a single integer and every variation (`metadata.variations`,
shape `{name, price}`) shared it. A seller couldn't say "5mg: 12 left, 10mg: sold
out" on one product. Order lines already carried a `variation` label, but every
stock guard ignored it and keyed off the shared column.

## Decisions (confirmed with the user before coding)

1. **Migration = Fallback.** A variation with **no** numeric `stock` keeps drawing
   from the base `Product.stock` column (historical shared behavior). Only a
   variation with a numeric `stock` is tracked as its own pool. → **No schema
   change, no backfill, no `db:push`.** `metadata.variations[].stock` is optional.
2. **Admin surfaces = Both** were planned; the Add/Edit Product form ships in this
   pass (see Deferred).

## Source Plan

Inline `/ecc:plan` output for "Inventory & Availability per stock of products (per
variants)". Journeys below were derived from it.

## User Journeys

- As a store owner, I set a distinct stock count on each variation so one option
  can sell out while its siblings stay available.
- As a store owner, I leave a variation's stock blank so it keeps sharing the base
  product stock (nothing about my existing catalog changes).
- As a shopper, I see which specific option is out of stock before I try to buy it.
- As the system, when an order is confirmed I deduct the *chosen variation's* pool
  (not the whole product), and restock the same pool if the order is cancelled.

## RED → GREEN

| Stage | Commit | Evidence |
|---|---|---|
| RED | `f52364b` test: RED gate | `npm run test:variant-inventory` → `MODULE_NOT_FOUND: src/lib/storefront/inventory.ts` (the new test references the missing engine — intended compile/module RED) |
| GREEN (engine) | `4e0f037` feat: inventory engine, guard & deduction | `npm run test:variant-inventory` → **33 passed, 0 failed**; `tsc --noEmit` clean |
| GREEN (UI) | `128fc8c` feat: admin input, cart cap & storefront availability | gates below all green; `tsc --noEmit` clean |

## The single rule (source of truth)

`src/lib/storefront/inventory.ts`:
```
effectiveStock(product, variationName) =
  (variation with that name has a numeric stock) ? that stock
                                                  : max(0, product.stock ?? 0)
```
Used by the checkout guard, both deduction paths, the cart cap, and every display
surface — so they can never drift.

## Test Specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | A tracked variation reports its own stock; a tracked 0 is out even when the base has stock | `test-variant-inventory.ts` · effectiveStock | unit | PASS |
| 2 | An untracked variation (blank stock) falls back to the base column | · effectiveStock | unit | PASS |
| 3 | Deduct/restock moves only the named tracked variation, clamps at 0, immutable | · applyVariationStock / applyStockMoveToProducts | unit | PASS |
| 4 | A fallback / non-variation line moves the base column instead | · applyStockMoveToProducts | unit | PASS |
| 5 | Two variation lines on one product hit independent pools | · applyStockMoveToProducts | unit | PASS |
| 6 | A product is "out of stock" only when EVERY option is exhausted | · productOutOfStock | unit | PASS |
| 7 | Mapping round-trips a numeric variation stock (incl. 0) and never injects stock onto an untracked variation | · product-mapping round-trip | unit | PASS |
| 8 | Quick-view modal exposes per-option stock and all-options-out `outOfStock` | · buildProductDetail | unit | PASS |
| 9 | The checkout guard (`stockViolation`) and deduction are wired to the shared engine | · orders.ts wiring (structural) | integration | PASS |

Command / output:
```
npm run test:variant-inventory   → 33 passed, 0 failed
```

## Regression gates (unchanged, all green)

```
test:product-variations  30 passed, 0 failed
test:product-detail      20 passed, 0 failed
test:cart                15 passed, 0 failed
test:two-ways-cart       20 passed, 0 failed
test:bulk-order-status   27 passed, 0 failed
test:order-detail        17 passed, 0 failed
tsc --noEmit             clean
```

## Files changed

- `src/lib/storefront/inventory.ts` **(new)** — the pure engine
- `src/lib/storefront/variations.ts` / `product-mapping.ts` / `product-detail.ts` — type + round-trip + modal availability
- `src/storefront/types.ts` — `variations[].stock?`
- `src/actions/orders.ts` — variation-aware guard + demo/DB deduction (DB writes `metadata.variations[].stock`)
- `src/actions/products.ts` — `normalizeProductInput` preserves per-variation stock
- `src/storefront/admin/variation-presets.ts` / `AdminAddProduct.tsx` — per-variation stock input + save forwarding
- `src/storefront/store.tsx` — per-variation cart cap
- `src/storefront/components/Catalog.tsx` — card + modal per-option availability

## Known gaps / deferred (follow-ups)

- **AdminInventory** dedicated screen still edits stock at the product level; per-variation editing there was planned as a convenience (the Add/Edit Product form already sets it). Not yet done.
- **TwoWaysHome** and the server **`products/[slug]/page.tsx`** render variations but do not yet show per-variation availability. The client cart + server checkout guard already enforce it, so this is display polish, not a correctness hole.
- **`test:onhand-gate`** shows 1 pre-existing failure ("blocks the paused product through the real resolvers") that belongs to a concurrent in-progress feature (GB access-gate-port Phase 2 fail-closed on-hand gate). It is **not** in this feature's import path (`on-hand-gate.ts` → `group-buy.ts`, neither touched here) and is unrelated to these changes.
- No `db:push` needed — variation stock lives in the existing `metadata` JSON column.
