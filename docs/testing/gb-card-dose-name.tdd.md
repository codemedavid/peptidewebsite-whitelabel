# TDD evidence — group-buy card names carry the dose

**Source plan**: none. Journeys derived during this TDD run from a live k-glow
report: "there's an open groupbuy but the mg is gone".

**Scope decision**: the owner was offered a dose *picker* on the group-buy card
(which would also fix the no-dose/base-price cart bug) and explicitly declined:
*"i just want the product name to have the mg too."* This change is display-only.
The picker gap is recorded under Known gaps below.

## User journey

> As a k-glow customer browsing the open group-buy round, I want each card to
> name the dose it is selling, so that I know whether I am joining for 5mg or
> 60mg before I hit "Join GB".

## Root cause

k-glow sellers put the dose in `metadata.variations`, not the product name — the
row is `Semaglutide` and `5mg × 10 vials` is a variation
(`src/lib/storefront/product-mapping.ts:180` maps it onto the storefront
`Product`).

Two surfaces render a live round's products:

| Surface | Renders variations? |
|---|---|
| `Catalog.tsx`, `TwoWaysHome.tsx` | yes — `buildProductOptions` / `shouldShowOptionPicker` |
| `GroupBuyPage.tsx` | **no picker at all** — rendered the bare `p.name` |

`TwoWaysHome` does not list group-buy products; it links to the group-buy page.
So the group-buy page is the *only* surface listing a round's products, and with
a round open every card read `Semaglutide` with the mg nowhere on it.

## Task report

**Task**: put the dose into the group-buy card's name.

- **Execution**: added the pure `gbDisplayName(name, variations)` to
  `src/lib/storefront/group-buy-page.ts`, surfaced it as `GroupBuyPageLine.displayName`,
  and rendered it from `GroupBuyPage.tsx` (card heading, image `alt`, stepper `aria-label`s).
- **Validation command**: `npm run test:group-buy-page`
- **RED** (commit `5e84836`, before any production edit):

  ```
  gbDisplayName — the card name carries the dose

    ✗ no variations → name unchanged — (0 , import_group_buy_page.gbDisplayName) is not a function
    ✗ one variation → its full name is appended (pack size kept) — … is not a function
    ✗ several variations → just the dose tokens, joined — … is not a function
    ✗ non-mg units (ml) are treated as doses too — … is not a function
    ✗ a name that ALREADY carries a dose is left alone (no duplication) — … is not a function
    ✗ variations with no dose token fall back to their full names — … is not a function
    ✗ blank / whitespace variation names are ignored — … is not a function
    ✗ the page view-model exposes displayName on every line — undefined == 'Semaglutide 5mg × 10 vials'
  ```

  8 failing for the intended reason (the function did not exist); the 29
  pre-existing checks in the same file passed throughout.

- **GREEN** (commit `f075bad`): `37 passed, 0 failed`.
- **Guaranteed by the passing tests**: a group-buy card never shows a doseless
  name when the seller recorded a dose on a variation, and never doubles a dose
  the seller already wrote into the name.

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | A product with no variations keeps its name verbatim | `scripts/test-group-buy-page.ts:no variations → name unchanged` | unit | PASS | `npm run test:group-buy-page` |
| 2 | One variation contributes its full name, so the pack size survives (`Semaglutide 5mg × 10 vials`) | `…:one variation → its full name is appended (pack size kept)` | unit | PASS | same |
| 3 | Several variations collapse to dose tokens only, so 9-dose Tirzepatide stays readable | `…:several variations → just the dose tokens, joined` | unit | PASS | same |
| 4 | ml/mcg/iu count as doses, not just mg | `…:non-mg units (ml) are treated as doses too` | unit | PASS | same |
| 5 | A name that already carries a dose is left alone — no `Lemon Bottle 10ml 10ml / 50ml` | `…:a name that ALREADY carries a dose is left alone (no duplication)` | unit | PASS | same |
| 6 | Non-dose option names (`Vials only`) are still shown, not silently dropped | `…:variations with no dose token fall back to their full names` | unit | PASS | same |
| 7 | Blank/whitespace variation names are ignored | `…:blank / whitespace variation names are ignored` | unit | PASS | same |
| 8 | Every page line exposes `displayName`, so the card cannot fall back to the bare name | `…:the page view-model exposes displayName on every line` | unit | PASS | same |

## Live-data verification

`npx tsx scripts/inspect-kglow-gb-names.ts k-glow` against the k-glow tenant
(round "check out now ☺️😘", 41 assigned products) — 24 products gain the dose:

```
GB →   Semaglutide   →  Semaglutide 5mg × 10 vials
GB →   Tirzepatide   →  Tirzepatide 5mg / 10mg / 15mg / 20mg / 30mg / 40mg / 45mg / 50mg / 60mg
GB →   GHK-CU        →  GHK-CU 100mg / 50mg
GB →   Retatrutide   →  Retatrutide 5mg / 10mg / 15mg / 20mg / 30mg
GB →   IGF-1LR3      →  IGF-1LR3 0.1mg / 1mg
GB     Lemon Bottle 10ml           (already dosed — untouched)
GB     BPC 10mg + TB 10mg          (already dosed — untouched)
GB     KPV                         (no variations — untouched)
```

## Regression suites

All run after the fix:

| Suite | Result |
|---|---|
| `test:group-buy-page` | 37 passed, 0 failed |
| `test:two-ways` | 18 passed, 0 failed |
| `test:two-ways-home` | 19 passed, 0 failed |
| `test:two-ways-cart` | 20 passed, 0 failed |
| `test:gb-e2e` | 50 passed, 0 failed |
| `test:gb-banner` | 10 passed, 0 failed |
| `test:gb-pricing` | 33 passed, 0 failed |
| `test:gb-content` | 31/31 checks passed |
| `test:gb-rounds` | 13 passed, 0 failed |
| `test:variant-inventory` | 33 passed, 0 failed |

`npx tsc --noEmit` — clean.

## Known gaps

- **No dose picker on the group-buy card.** `GroupBuyPage.tsx` still calls
  `addToCart(p)` with no variation, so a multi-dose product joins the round at
  the base `gbPrice` with no dose recorded on the line. 16 of the round's 41
  products have 2–9 variations. Deliberately out of scope — the owner asked for
  the name only. Fixing it means giving the card the picker `Catalog.tsx` and
  `TwoWaysHome.tsx` already build (`buildProductOptions` / `shouldShowOptionPicker`).
- No visual-regression coverage: the dose is appended to an existing
  `.gbpage__card-name` element, so a 9-dose name wraps to a second line on
  narrow viewports. Not screenshot-tested.
