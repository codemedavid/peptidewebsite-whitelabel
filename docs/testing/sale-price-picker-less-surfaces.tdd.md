# TDD Evidence — Sale price on the surfaces without an option picker

**Date:** 2026-09-02
**Branch:** `feat/made-to-order`
**Reported by:** tenant **hpglow** — "when the product is discounted it is not visible in the products listings instead it is just visible once the product is in the cart"

This is a **re-report** of the bug fixed on 2026-08-28 (`8ae8890`, `docs/testing/` → `src/lib/storefront/sale.ts`). The investigation split into two independent findings; both are recorded here because only the second one is a code change.

---

## Finding 1 — the 2026-08-28 fix was never deployed (not a code defect)

The catalog card, quick-view modal and two-ways shelf are correct on this branch, and the existing suite proves it:

```
$ npm run test:sale-price      # before any change in this run
27 passed, 0 failed
```

hpglow's live data was checked directly and matches what the fixed code handles — 12 discounted products, **none with variations**, every `discountPrice` positive and below list, so `resolveSaleView` would show all of them:

| product | list | discount |
|---|---|---|
| AHK-CU Cosmetic Grade | ₱1,280 | ₱699 |
| Collagen Skinbooster | ₱599 | ₱249 |
| Fat Blaster Lipo-C | ₱2,399 | ₱1,999 |
| Glutathione | ₱1,499 | ₱999 |
| Lemon Bottle | ₱1,299 | ₱999 |
| … (12 total) | | |

hpglow's `homeLayout` is `null` (the classic layout), so its listing **is** the `Catalog` grid, which prices from `resolveSaleView`.

The cause is that production is not running this code:

```
$ git ls-remote origin refs/heads/main
4d9300c…  refs/heads/main

$ git log -1 --format='%ci %s' 4d9300c
2026-08-24 15:33:02 +0800  chore: refresh tsc incremental build info

$ git merge-base --is-ancestor 8ae8890 origin/main; echo $?
1        # the sale fix is NOT on the deployed branch

$ git rev-list --count 4d9300c..main
37       # unpushed commits on local main
```

**Remote `main` is dated 2026-08-24; the sale fix landed 2026-08-28.** hpglow has never received it. No test can close this — it needs a push and a deploy.

## Finding 2 — the fix missed two browsing surfaces (the code change below)

`resolveSaleView(p, selectedIndex)` answers `null` until the customer picks an option, so it only fits a surface that **has** an option picker. Two browsing surfaces have none, show one figure per product, and were still printing `product.price` raw:

- `src/storefront/components/EditorialEdit.tsx:87` — the editorial home's featured band (landed 2026-08-26, two days *before* the fix, and was missed by it)
- `src/storefront/pages/MerchantPage.tsx:134` — the reseller price list's **Retail** tier

The reseller case is the worse of the two: `resolveWholesale` prices its own tier off `effectiveBasePrice`, so a Retail figure that ignored a running markdown made the **wholesale saving shown against it wrong**.

---

## User journeys

1. As a shopper on an editorial-layout store, I want a marked-down product in the featured band to show the price the cart will charge, with the list price struck beside it, so I learn about the saving while browsing instead of at checkout.
2. As a reseller on the wholesale page, I want the "Retail" figure to be the price the cart actually charges, so the wholesale saving quoted against it is real.
3. As a reseller, I want a temporary markdown to be *named* on the card, so I can tell it apart from the standing retail price.
4. As a shopper, a product with variations must **not** be advertised a saving on a picker-less surface — the cart drops the base markdown when it clones a variation, so a promised markdown would be one checkout refuses to honour.

## Task report

**Behavior:** one rule for what a picker-less browsing surface shows.

- **New pure helper** `resolveBaseSaleView(p)` in `src/lib/storefront/sale.ts` — returns the full `SaleView` for the base price, never `null`. A product with variations returns the base figure with `onSale: false` (journey 4). `resolveSaleView`'s own `options.length === 0` branch now delegates to it, so there is still exactly one definition of when a markdown is real.
- **`EditorialEdit.tsx`** — binds `resolveBaseSaleView(product)` and renders `sale.price` plus an `<s className="ed-edit__compare">` carrying `sale.compareAt`, with an `sf-sr-only` "Was " prefix.
- **`editorial.css`** — styles `.ed-edit__compare` in `em` so it tracks `.ed-edit__price`, dimmed against the band's inverted strip.
- **`MerchantPage.tsx`** — the Retail tier value becomes `money(retail.price)`. The tier value is *already* `line-through` in `storefront.css` (retail is the figure wholesale beats), so a second struck price would be wrong; the markdown is named in the label via the card's existing `merchant-card__tag` instead.

**Validation command:** `npm run test:sale-price`

**RED** (commit `8836439`) — the helper did not exist and neither surface was wired:

```
resolveBaseSaleView — surfaces with no option picker
  ✗ a single-price product on sale shows the SALE price, with no pick to make — (0 , import_sale.resolveBaseSaleView) is not a function
  ✗ it carries the list price it was marked down from, for the struck figure — ... is not a function
  ✗ a product with no sale shows its list price and no compare-at — ... is not a function
  ✗ an enabled-but-unpriced discount shows the LIST price, not free — ... is not a function
  ✗ a product WITH variations shows the base price and advertises NO saving — ... is not a function
  ✗ a picker-less surface shows the price the cart charges — ... is not a function
EditorialEdit.tsx — the editorial featured band
  ✗ the featured band prices from the sale helper, not the raw list price — the editorial featured band still prints product.price — a marked-down product advertises the pre-sale price on the home page
  ✗ the band renders a struck-through compare-at price — no compare-at element in the featured band
MerchantPage.tsx — the reseller price list
  ✗ the Retail tier prices from the sale helper, not the raw list price — the reseller is quoted a retail figure the cart will not charge
  ✗ the Retail tier renders a struck-through compare-at price

27 passed, 10 failed
```

**GREEN** (commit `c04a5f2`):

```
37 passed, 0 failed
```

One RED guard was **retargeted before GREEN**, and this is deliberate: it asserted `merchant-card__compare`, a mechanism that fights `storefront.css:6014` where the retail tier value is already `line-through`. The *guarantee* (a markdown must not be applied silently) was kept and re-asserted against `retail.badgeLabel`. The value assertion — the Retail tier must not read `product.price` — was never weakened.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A single-price product on sale shows the sale price on a picker-less surface | `test-sale-price.ts: a single-price product on sale shows the SALE price…` | unit | PASS |
| 2 | It carries the list price it was marked down from, plus a badge label | `…it carries the list price it was marked down from` | unit | PASS |
| 3 | No sale → list price, no compare-at | `…a product with no sale shows its list price and no compare-at` | unit | PASS |
| 4 | An enabled-but-blank discount is not a ₱0 sale | `…an enabled-but-unpriced discount shows the LIST price, not free` | unit | PASS |
| 5 | A variation product advertises no saving on a picker-less surface | `…a product WITH variations shows the base price and advertises NO saving` | unit | PASS |
| 6 | What a picker-less surface shows equals `checkout.unitPrice` | `…a picker-less surface shows the price the cart charges` | parity | PASS |
| 7 | The editorial featured band prices from the helper | `EditorialEdit.tsx …prices from the sale helper` | structural | PASS |
| 8 | The band renders a struck compare-at | `EditorialEdit.tsx …struck-through compare-at price` | structural | PASS |
| 9 | The reseller Retail tier prices from the helper and no longer reads `product.price` | `MerchantPage.tsx …prices from the sale helper` | structural | PASS |
| 10 | A running markdown is named on the reseller card | `MerchantPage.tsx …named on the card, not applied silently` | structural | PASS |

## Regression coverage run alongside

```
npm run test:cart                     → 20 passed, 0 failed
npm run test:variation-price-reveal   →  9 passed, 0 failed
npm run test:wholesale-pricing        → 25 passed, 0 failed
npm run test:variant-inventory        → 33 passed, 0 failed
npx tsc --noEmit                      → clean (exit 0)
```

## Known gaps

- **No coverage command.** This repo has no aggregate coverage tool; the suites are standalone `tsx` scripts, so the 80% figure could not be measured and is not claimed.
- Tests 7–10 are **structural** (source assertions), matching the idiom already used in this file for `Catalog.tsx`. They prove the surface consumes the helper; they do not render it. No component-render harness exists in this repo.
- **`MerchantPage.tsx` in the worktree carries unrelated in-flight reseller-session work** from a concurrent session. Only the pricing hunks were staged into `c04a5f2`; the rest remains uncommitted by design.
- Finding 1 is **not closed by this commit.** Until `main` is pushed and deployed, hpglow keeps seeing the original bug on its classic catalog.

## Checkpoint commits (branch `feat/made-to-order`)

| Stage | Commit | Evidence |
|---|---|---|
| RED | `8836439` `test: add reproducer for the sale price hidden on picker-less surfaces` | 27 passed, 10 failed |
| GREEN | `c04a5f2` `fix(storefront): show the sale price on the surfaces without a picker` | 37 passed, 0 failed |
