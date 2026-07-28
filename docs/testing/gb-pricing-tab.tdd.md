# TDD evidence — Group Buys → Pricing tab

**Branch:** `feat/gb-pricing-tab`
**Date:** 2026-07-28
**Source plan:** none on disk — journeys derived during the `/ecc:plan` run in this session and confirmed with the user via three scoping questions (delete semantics, "not available" semantics, tab scope).

## User journeys

1. As a store owner, I want to set a group-buy price on any product from inside Group Buy Management, so that I don't have to open the full product editor for each one.
2. As a store owner, I want to change a group-buy price by clicking the product, so that adjusting a round's pricing is quick.
3. As a store owner, I want to remove a product from the group buy without deleting it, so that it keeps selling at its regular price.
4. As a store owner, I want to mark a group-buy product "not available" so it stays visible but can't be ordered.

## Scoping decisions (confirmed with the user)

| Question | Chosen |
|---|---|
| What does Delete do? | Remove from the group buy only — untag, clear GB price, drop from round assignments. Product stays in the catalog. |
| What does "not available" mean? | `purchasable: false` — visible but not buyable. Not `available: false` (which hides it entirely). |
| Which products does the tab list? | All catalog products, with an "In the group buy" filter. |

## Two pre-existing defects found and fixed

Both were required for journey 4 to work at all; the user approved including them ("include the fixes").

### Defect 1 — product saves silently wiped `purchasable` / `priceOnRequest`

`normalizeProductInput` never carried either key, so `productToDbWrite` persisted `undefined` and `compactMetadata` dropped it. `AdminAddProduct` compounded it by omitting both from its save payload — and that payload is the whole product, so a missing key reads as "cleared", not "unchanged". Net effect: anything marked not-available was put back on sale by the next ordinary product edit. Same class of regression as the `productClass` drop already recorded in `scripts/test-product-add-gates.ts`.

### Defect 2 — `purchasable: false` did not block a purchase

It was honoured in exactly one component (`TwoWaysHome.tsx:257`). It was **absent** from `buildProductCta` — whose own header calls it "the single rule for what a product's buy controls SAY and whether they work" — from the group-buy page's Join GB button, from `store.addToCart`, and from order placement. A paused product was fully buyable everywhere except one row.

## Task report

| # | Task | Validation command | RED | GREEN |
|---|---|---|---|---|
| 1 | Carry `purchasable`/`priceOnRequest` through the save pipeline | `npm run test:product-add-gates` | 6 failed, incl. `editing a not-available product does not silently make it buyable again — true == false` | 21 passed, 0 failed |
| 2 | Enforce the pause across CTA, GB page, cart, server | `npm run test:product-cta` | 7 failed, incl. `purchasable:false → Not available … 'Add to Cart' == 'Not available'` | 31 passed, 0 failed |
| 3 | Pure `gb-pricing` module | `npm run test:gb-pricing` | compile-time RED (module absent), then 1 failed on a wrong expectation of mine | 33 passed, 0 failed |
| 4 | `saveGroupBuyProductPricingAction` | `npx tsc --noEmit` + schema check | — | clean; `group_buys.productIds` confirmed `Json`, delegate `groupBuy` |
| 5 | Pricing tab UI | `npm run build` | — | build succeeds |

### Note on task 3

One failure was my test expectation, not the module: I asserted `row.gbPrice === 0` for an untagged product. `groupBuyLine` deliberately falls back to the **regular** price so a line never advertises a phantom saving. I fixed the test, not the module — a zero there would have been a second, conflicting definition of "no GB price set". `hasSavings` is that signal.

### Note on task 2

My first draft asserted `GroupBuyPage.tsx` must call `buildProductCta`. That would have forced a **wrong** implementation: the helper gates on stock, but group-buy lines are pre-orders exempt from stock (`isGroupBuyPreorder`), so every stock-0 round product would have rendered "Sold out". The assertion was changed to the actual requirement — a `purchasable` guard — and the page guards it directly.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | `purchasable: false` survives a full normalize → DB write → re-read round trip | `test-product-add-gates.ts:purchasable:false reaches the DB metadata through the full save pipeline` | unit | PASS |
| 2 | Editing a paused product in the ordinary editor does not put it back on sale | `test-product-add-gates.ts:editing a not-available product does not silently make it buyable again` | unit | PASS |
| 3 | An orderable product never persists a `purchasable` key (DB stays tidy) | `test-product-add-gates.ts:an orderable product never persists a purchasable key` | unit | PASS |
| 4 | A paused product's CTA reads "Not available" and is disabled even with stock | `test-product-cta.ts:purchasable:false → Not available, disabled, even with stock` | unit | PASS |
| 5 | The pause outranks the group-buy gate and sold-out, but not price-on-request | `test-product-cta.ts:purchasable:false beats the group-buy on-hand gate` / `beats sold-out` / `price-on-request still outranks` | unit | PASS |
| 6 | The group-buy page blocks paused products | `test-product-cta.ts:the group-buy page blocks paused products` | wiring | PASS |
| 7 | The cart refuses to add a paused product | `test-product-cta.ts:the cart guards purchasable` | wiring | PASS |
| 8 | Order placement re-checks the pause server-side | `test-product-cta.ts:order placement re-checks purchasable server-side` | wiring | PASS |
| 9 | The tab lists the whole catalog in catalog order | `test-gb-pricing.ts:lists the whole catalog, not just group-buy products` | unit | PASS |
| 10 | The admin's saving equals what the storefront actually charges | `test-gb-pricing.ts:the row's saving agrees with what the storefront actually charges` | unit | PASS |
| 11 | A GB price at or above the regular price is rejected (no phantom discount) | `test-gb-pricing.ts:a price equal to the regular price is rejected` / `above` | unit | PASS |
| 12 | Removing a product untags it but keeps the catalog row and regular price | `test-gb-pricing.ts:keeps the product and its regular price in the catalog` | unit | PASS |
| 13 | Emptying a round's assignment is reported, not silently widened to all products | `test-gb-pricing.ts:removing the round's only product does not silently widen it to all` | unit | PASS |
| 14 | Archived rounds never claim a product | `test-gb-pricing.ts:an archived round never claims a product` | unit | PASS |
| 15 | Every operation is immutable | `test-gb-pricing.ts:does not mutate the input` (×3) | unit | PASS |

## Coverage and known gaps

- New gate: `npm run test:gb-pricing` (33 assertions) added to `package.json`.
- Regression sweep, all green: `gb-pricing`, `product-cta`, `product-add-gates`, `cart`, `two-ways`, `two-ways-home`, `two-ways-cart`, `group-buy-pricing`, `group-buy-page`, `gb-rounds`, `gb-report`, `gb-content`, `gb-banner`, `gb-ratio`, `staff` (62), `variant-inventory`, `product-variations`, `product-detail`, `checkout-total`, `onhand-order`, `catalog-sort`.
- `npx tsc --noEmit` clean; `npm run build` succeeds.

**Gaps, stated plainly:**

- `saveGroupBuyProductPricingAction` has no automated test — it needs a DB and a session, matching this repo's convention that server actions are covered indirectly via their pure layer (`gb-pricing.ts`, fully tested). Its private `applyOp` / `normalizeGbPricingOp` are therefore untested directly.
- The tab UI has no component test; the repo has no React test infrastructure (every gate is a `node:assert` script). Verified via `npm run build` and the wiring assertions in `test-product-cta.ts`.
- **Not manually exercised in a browser.** The DB write path in particular has not been run against a live tenant.
- `npm run test:onhand-gate` has 1 failure (`blocks the paused product through the real resolvers`). **Pre-existing** — it reproduces identically with all Phase 2 changes stashed. Untouched here.
- No schema migration was needed (everything lands in the existing `Product.metadata` JSON and `group_buys.productIds`), so no `db push` is required for this feature.

## Merge evidence

Five checkpoint commits on `feat/gb-pricing-tab`, RED/GREEN recorded in each message:

```
942dcbf feat: Group Buys → Pricing tab
30ca472 feat: saveGroupBuyProductPricingAction — atomic GB pricing write
0daf35f feat: gb-pricing pure module behind the Group Buys → Pricing tab
5f8c209 fix: make "not available" actually block a purchase
7df53a6 fix: stop product saves wiping purchasable / priceOnRequest
```

If squashed, copy this file's task report and test specification into the PR body.
