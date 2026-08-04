# TDD evidence — every group-buy product carries its mg into the cart

**Source plan**: none. Journeys derived during this TDD run from the user's
request: *"do e2e testing when checking out the product in the groupbuy — test
all the products, add it to cart, all of it should display each their mg."*

Follows [gb-card-dose-name.tdd.md](gb-card-dose-name.tdd.md), which put the dose
on the group-buy **card** and left the cart gap open under "Known gaps".

## User journeys

> As a k-glow customer joining the open round, I want every product I add to the
> cart to name the dose I am joining for, so the checkout list and the order I
> send are not a list of bare product names.

> As the store owner reading the order, I want each line to say which strength
> was bought and to be charged that strength's price, so I can place the supplier
> order without messaging the customer back.

## Root cause

The card heading was fixed, but the **page had no option picker**: `Join GB`
called `addToCart(p)` with the raw catalog row
(`src/storefront/pages/GroupBuyPage.tsx:154,171`). `cartDisplayName`
(`src/storefront/checkout.ts:119`) appends a dose only when the dose is genuinely
known — a picked variation, a name that already carries one, or exactly ONE
buyable option — so a multi-dose product landed in the cart bare, at the BASE
option's `gbPrice`.

Measured on the live k-glow round before the fix (36 resolvable products):
**10 lines carried a dose, 26 were bare** — including Tirzepatide (12 options)
and Retatrutide (10).

## Task report

**Task**: give the group-buy card the dose pick the catalog card and two-ways
home already have, and prove it end to end for every product in a round.

- **Execution**: added `gbPageOptions` / `defaultGbOptionIndex` / `gbCardAddition`
  and `GroupBuyPageLine.options` + `.defaultOptionIndex` to
  `src/lib/storefront/group-buy-page.ts`; exported `variationEntryId` from
  `src/storefront/checkout.ts`; rewrote the card as `GbProductCard` in
  `src/storefront/pages/GroupBuyPage.tsx` (dose `<select>`, price follows the
  selection, stepper keyed to the selected option's own cart line); added the
  optional `gbPrice` to the shared `Variation` type.
- **Validation command**: `npm run test:gb-cart-doses`
- **RED** (commit `5c3e072`, before any production edit): `1 passed, 13 failed`
  plus a crash —

  ```
    ✓ all 8 assigned products are on the page
    ✗ every joinable product carries a dose into the cart when the seller recorded one
        — (0 , import_group_buy_page.gbCardAddition) is not a function
    ✗ the only doseless cart lines are the products the seller gave no dose — …
    ✗ multi-dose Tirzepatide → the first dose, not a bare name — …
    ✗ a distinct base price does NOT default the card to doseless 'Standard' — …
    ✗ each cart line is charged its own option's group-buy price — …
    ✗ the server re-derives the same price for every line — …
    TypeError: (0 , import_group_buy_page.gbCardAddition) is not a function
  ```

  Failing for the intended reason: the page had no option core at all.
- **GREEN** (commit `4c2ff90`): `22 passed, 0 failed`.
- **Guaranteed by the passing tests**: adding any product in a round from the
  group-buy page produces a cart line naming the dose the seller recorded, at
  that dose's own group-buy price, and the server re-derives the same price.

## Test specification

All rows: `npm run test:gb-cart-doses` (`scripts/test-gb-cart-doses.ts`), E2E
over the whole page → pick → cart → drawer → order chain.

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Every joinable product whose seller recorded a dose carries it into the cart | `every joinable product carries a dose into the cart when the seller recorded one` | e2e | PASS |
| 2 | The only doseless cart lines are the products with no dose anywhere | `the only doseless cart lines are the products the seller gave no dose` | e2e | PASS |
| 3 | Each cart line names the option the card had selected | `every cart line names the option the card had selected` | e2e | PASS |
| 4 | A multi-dose product reads `Tirzepatide — 5mg × 10 vials`, never bare | `multi-dose Tirzepatide → the first dose, not a bare name` | e2e | PASS |
| 5 | A distinct base price does not leave doseless "Standard" selected | `a distinct base price does NOT default the card to doseless 'Standard'` | e2e | PASS |
| 6 | A name already carrying a dose is not doubled | `a name that already carries its dose is not doubled` | e2e | PASS |
| 7 | A doseless option still names itself (`KPV — 5 vials`) | `a doseless option still names itself` | e2e | PASS |
| 8 | Each line is charged the advertised price for its own option | `each cart line is charged its own option's group-buy price` | e2e | PASS |
| 9 | A variation with no `gbPrice` sells at its own price — no base-price undercharge | `a variation with no gbPrice sells at its own price, not the base group price` | e2e | PASS |
| 10 | The server re-derives the same per-unit price (`authoritativeItemPrice`) | `the server re-derives the same price for every line` | integration | PASS |
| 11 | Re-hydrating the cart from the live catalog keeps every dose | `re-hydrating the cart from the live catalog keeps every dose` | e2e | PASS |
| 12 | The order message the seller reads names each dose | `the order message names each dose` | e2e | PASS |
| 13 | Options are priced at the group-buy price, not the regular one | `options are priced at the group-buy price, not the regular one` | unit | PASS |
| 14 | A product with no variations offers no options and adds bare | `a product with no variations offers no options` | unit | PASS |
| 15 | The default pick is the first DOSED option; falls back to the first | `the default pick is the first option carrying a dose` / `with no dosed option anywhere…` | unit | PASS |
| 16 | An out-of-range pick falls back to the default, never crashes or adds the wrong dose | `an out-of-range pick falls back to the default option, never crashes` | unit | PASS |
| 17 | A paused product stays listed but offers no join | `a paused product is still listed but offers no join` | e2e | PASS |

## Live-data verification

The whole round driven through the shipped path (`buildGroupBuyPageView` →
`gbCardAddition` → `makeVariationEntry` → `cartDisplayName` / `unitPrice`) against
the k-glow tenant, round "check out now ☺️😘", all 36 resolvable products:

```
OK   Tirzepatide — 5mg × 10 vials        @ ₱2,980      (was bare "Tirzepatide")
OK   Retatrutide — 5mg                   @ ₱3,866      (was bare)
OK   GHK-CU — 100mg × 10 vials           @ ₱2,880      (was bare)
OK   Bacteriostatic Water — 3ml          @ ₱488        (was bare)
OK   Semaglutide — 5mg × 10 vials        @ ₱4,340
OK   Lemon Bottle 10ml — 10ml            @ ₱3,800
OK   KPV / KissPeptin-10 / BBG70 klow / PDRN skin booster / Lc216 Lipo c only
                                          (seller recorded no dose anywhere)

lines whose cart name keeps the seller dose: 36 / 36   still bare: 0
```

Before the fix the same measurement read `10 / 36`.

## Regression suites

All run after the fix:

| Suite | Result |
|---|---|
| `test:gb-cart-doses` | 22 passed, 0 failed |
| `test:group-buy-page` | 37 passed, 0 failed |
| `test:checkout-names` | 10 passed, 0 failed |
| `test:two-ways` / `two-ways-home` / `two-ways-cart` | 18 / 31 / 20 passed, 0 failed |
| `test:two-ways-mode` | PASS |
| `test:gb-e2e` | 50 passed, 0 failed |
| `test:gb-banner` / `gb-pricing` / `gb-rounds` | 10 / 33 / 13 passed, 0 failed |
| `test:variation-gb-pricing` | 17 passed, 0 failed |
| `test:group-buy-pricing` | 19 passed, 0 failed |
| `test:variation-price-reveal` | 9 passed, 0 failed |
| `test:variant-inventory` | 33 passed, 0 failed |
| `test:cart` | 15 passed, 0 failed |
| `test:onhand-order` / `test:catalog-sort` | PASS / 20 checks, 0 failures |

`npx tsc --noEmit --pretty false` — clean.

## Coverage and known gaps

- **No coverage command exists in this repo** — `package.json` has no
  `test:coverage` script and no Jest/Vitest config; the suite is ~40 standalone
  `tsx` scripts. The 80% figure is therefore not measurable here; coverage of the
  changed code is argued instead by the 17 guarantees above, which exercise every
  new exported function and both branches of each (`options` empty / non-empty,
  dosed / doseless default, in-range / out-of-range pick, variation with and
  without its own `gbPrice`).
- **A behavior change, deliberately**: a dose whose variation carries no
  `gbPrice` is now charged its own list price on this page instead of the base
  option's group price. That is the existing anti-undercharge rule
  (`makeVariationEntry`) which the catalog card and two-ways home already follow —
  the group-buy page previously disagreed with them. Sellers who want a group
  price per dose must set `gbPrice` on the variation (Group Buys → Pricing).
- **Doseless products default to "Standard"**: where the seller recorded no dose
  on any option (KPV, Selank), the card keeps the base price selected, so those
  cart lines stay bare. There is no dose to show; the customer can still pick the
  named option.
- **No visual-regression coverage**: the `<select>` is new markup inside
  `.gbpage__card-body`. Not screenshot-tested at 320/768/1024/1440.
- **No browser E2E**: the chain is exercised through the real shipped functions,
  not Playwright. The component wiring itself (`GbProductCard` calling
  `gbCardAddition`) is verified by type-checking and manual review, not by a
  rendering test.

## Merge evidence

- RED: `5c3e072` — `test: reproducer for group-buy cart lines losing the mg`
  (`npm run test:gb-cart-doses` → 1 passed, 13 failed + crash).
- GREEN: `4c2ff90` — `feat: the group-buy card picks a dose, so every cart line
  carries its mg` (same command → 22 passed, 0 failed).
- No separate refactor commit: the change was written in its final shape and the
  suites above were run against it.
