# TDD evidence — product card: sold-out CTA + responsive buy row

**Date:** 2026-07-26 · **Branch:** `main` · **Suite:** `npm run test:product-cta`

## Source

No plan file. Journeys derived during this TDD run from a user-supplied
screenshot of the HP Glow catalog (Semax card, 2-up phone grid) showing:

- an `OUT OF STOCK` badge and two struck-through, sold-out option pills
  (`5MG · OUT`, `10MG · OUT`), and then a live-looking primary button reading
  **"Select an option"** — a choice the customer could not make;
- that same button overflowing the card's right edge and being sliced off by
  `.card { overflow: hidden }`.

## User journeys

1. As a shopper on a phone, I want the product card's buy row to stay inside the
   card, so the Add to Cart button is never cut in half.
2. As a shopper, when every size of a product is out of stock, I want the card to
   tell me it is sold out rather than invite me to pick an option that does not
   exist.

## Task report

### 1. Sold-out precedence over "Select an option"

The card and the quick-view modal each owned their own nested ternary for the
price-slot label, the button label and the disabled state, and both ordered
`needsSelection` above out-of-stock. Extracted the precedence into one pure
helper, `buildProductCta` (`src/lib/storefront/product-cta.ts`), read by both
surfaces. Order: price-on-request → group-buy on-hand block → **every option
exhausted ("Sold out")** → nothing picked ("Select an option") → picked option
exhausted ("Sold out") → buyable. CTA copy unified on "Sold out" (the old
button said "Out of Stock" for the single-price case).

- **RED:** `npm run test:product-cta` → `Error: Cannot find module
  '../src/lib/storefront/product-cta'` (compile-time RED — the test newly
  references the helper that must exist). Commit `66ae26c`.
- **RED (behavioural), after the helper landed:** `10 passed, 7 failed` —
  `Catalog.tsx still contains the literal "Out of Stock" CTA copy`,
  `Catalog.tsx does not import/use buildProductCta`, plus the 5 CSS assertions.
- **GREEN:** `17 passed, 0 failed`. Commit `4061a23`.
- **Guaranteed:** an all-sold-out product renders "Sold out" in both the price
  slot and the button, disabled, at any selection index; a product with one
  stocked option still asks for a selection; picking a sold-out option among
  stocked ones shows "Sold out" but keeps that option's price on screen.

### 2. Responsive buy row

`.btn` is `white-space: nowrap` and `.product-card__cta` was `flex: 1` with the
default `min-width: auto`, so a variable-length label ("Select an option",
"Available after group buy") could neither shrink nor wrap; the row grew past
the card and was clipped. Fixed with `min-width: 0`, `white-space: normal`,
`flex: 1 1 130px`, `flex-wrap: wrap` on the row, and moving the container-query
stack threshold 240px → 320px (sized by the longest label, not by "Add to Cart").

- **RED:** 5 CSS assertions failing, including `the stack threshold is 240px —
  too narrow for labels like "Select an option"; expected ≥ 300px`.
- **GREEN:** included in the `17 passed, 0 failed` run. Commit `4061a23`.

### 3. Regression caught by the browser check (not by the unit run)

Screenshotting at 414px showed the stacked CTA rendered as a large gold
**ellipse**. Two distinct flex faults, both introduced by the wrap fix:

1. multi-line flex defaults to `align-content: stretch`, so the wrapped CTA line
   inflates to the row's spare height;
2. inside the `@container` stack the row becomes `flex-direction: column`, where
   the CTA's `flex: 1 1 130px` basis is a **height** — a 130px-tall button with
   `.btn`'s pill radius is an oval.

- **RED:** added 3 assertions → `17 passed, 2 failed`, then `19 passed, 1 failed`.
- **GREEN:** `20 passed, 0 failed`. Commit `2d22a10`.
- Also tightened `padding-inline` in the stacked state so "Select an option"
  fits on one line on 180px-wide phone cards.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | All variations out of stock → CTA reads "Sold out", not "Select an option" | `scripts/test-product-cta.ts` | unit | PASS |
| 2 | All variations out of stock → price slot reads "Sold out" | same | unit | PASS |
| 3 | Sold out still wins after clicking a dead option pill | same | unit | PASS |
| 4 | One stocked option → still asks for a selection | same | unit | PASS |
| 5 | Picking the stocked option → "Add to Cart", real price, enabled, correct stock cap | same | unit | PASS |
| 6 | Picking a sold-out option among stocked ones → "Sold out", price stays visible | same | unit | PASS |
| 7 | Single-price product in stock → "Add to Cart" | same | unit | PASS |
| 8 | Single-price product at zero stock → "Sold out" | same | unit | PASS |
| 9 | `priceOnRequest` outranks every other state | same | unit | PASS |
| 10 | Group-buy on-hand block keeps its own CTA | same | unit | PASS |
| 11 | No `"Out of Stock"` literal left in `Catalog.tsx` | same | wiring | PASS |
| 12 | Card **and** modal both call `buildProductCta` | same | wiring | PASS |
| 13 | CTA can shrink inside the clipped card (`min-width: 0`) | same | CSS | PASS |
| 14 | CTA label wraps rather than overflowing (`white-space: normal`) | same | CSS | PASS |
| 15 | Buy row wraps the CTA onto its own line (`flex-wrap: wrap`) | same | CSS | PASS |
| 16 | Cart icon never shrinks (`svg { flex: none }`) | same | CSS | PASS |
| 17 | Wrapped CTA keeps its own height (`align-content: flex-start`) | same | CSS | PASS |
| 18 | Stacked column state does not also wrap (`flex-wrap: nowrap`) | same | CSS | PASS |
| 19 | Stacked CTA drops its flex basis (`flex: none`) | same | CSS | PASS |
| 20 | Stack threshold ≥ 300px | same | CSS | PASS |

## Browser verification (Playwright, live dev server, hpglow tenant)

Measured every card's CTA rect against its card rect at 5 viewport widths:

| Viewport | Card width | Cards | Overflowing |
|---|---|---|---|
| 320px | 280px | 36 | **0** |
| 375px | 335px | 36 | **0** |
| 414px | 180px (2-up) | 36 | **0** |
| 768px | 341px | 36 | **0** |
| 1440px | 278px | 36 | **0** |

180 cards measured, 0 clipped; CTA sits 15–21px inside the card edge. 9 HP Glow
products with every variation sold out (Cagrilintide, GHK-CU, HP Glow Precision
Pen V1, Kisspeptin, NAD+, Selank, Semax, Tesamorelin, Thymosin Alpha-1) all
render `cta: "Sold out"` / `priceSlot: "Sold out"`.

## Coverage and known gaps

- `npx tsc --noEmit` — clean.
- Regression suites re-run, all PASS: `test:variant-inventory`,
  `test:product-variations`, `test:product-detail`,
  `test:variation-price-reveal`, `test:product-add-gates`, `test:two-ways-cart`,
  `test:catalog-sort`, `test:price-font`, `test:footer-style`.
- `test:onhand-gate` fails 1 of 9 (`blocks the paused product through the real
  resolvers`). **Pre-existing and unrelated** — reproduced identically at `HEAD`
  before these changes in a detached worktree; that test imports only
  `on-hand-gate.ts` and `group-buy.ts`, neither of which this work touches.
- Not covered: the Two-Ways home / group-buy product rows
  (`TwoWaysHome.tsx`) keep their own inline "Out of stock" copy — a different
  layout with its own stock semantics, deliberately left alone.
- No visual-regression baseline is committed; the Playwright sweep above was
  run ad hoc from the session scratchpad.

## Merge evidence

Checkpoints on `main`, in order:

- `66ae26c` — RED (module missing; test + npm script only)
- `4061a23` — GREEN (17/17): helper, `Catalog.tsx` wiring, CSS
- `2d22a10` — refactor GREEN (20/20): stacked-CTA ellipse fix

Two commits from a concurrent session (`4f30679`, `41f37f3`, hpglow footer) are
interleaved in the history; both of this task's earlier checkpoints were
verified reachable from `HEAD` with `git merge-base --is-ancestor`.
