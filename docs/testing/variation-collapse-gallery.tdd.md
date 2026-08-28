# TDD evidence — collapsed variation picker + per-variation photos

**Date:** 2026-08-28/29
**Tenant that prompted it:** `mstomato` (trial)
**Commits:** `efcccd6` (RED) → `29d5b5b` (GREEN)
**Source plan:** none on disk — journeys were derived during a `/ecc:plan` run in
the same session, from a read-only inspection of the live tenant.

## What the tenant actually looks like

A read-only query against `mstomato` (21 products) is what set the scope:

| Product group | Variations each | Product photos |
|---|---|---|
| Cartridge Spacer, Dual/Single Vial Cases, Hard Caps (13 products) | **81** | 0 |
| Soft Vial Caps – 3 mL / 10 mL | 46 | 0 |
| 3 mL Vial Topper | 3 | 0 |
| Sample Organizer / Pouch | 2 | 0 |

19 of 21 products carry variations; the variations are **colorways**
("Pastel Mint", "Silk Barbie", "Trans. Ocean", "Roseberry"), not doses. That is
the whole reason both halves of this change exist.

## User journeys

1. As a shopper browsing a store with many colorways, I want the card to stay a
   card, so I can read the price and reach Add to Cart without scrolling past
   eighty pills.
2. As a shopper, I want to see the colorway I am buying, so I want to swipe the
   product image through the colorways and have the one on screen be the one I
   am ordering.
3. As a shopper who picked a colorway from deep in the list, I want my pick to
   stay visible when the list collapses.
4. As a store owner, I want to attach a photo to each variation — and to do it
   for eighty of them without eighty separate file pickers.
5. As every other tenant, with 2-4 variations and no per-variation photos, I want
   nothing about my storefront to change.

## Task report

### Task 1 — collapse the picker

Execution: added `VARIATION_PREVIEW_COUNT` and `splitOptionsForCard` to
`src/lib/storefront/variations.ts`, and one shared `OptionPicker` in
`Catalog.tsx` rendered by both the card and the detail modal.

RED (`efcccd6`):

```
$ npm run test:variation-collapse
  ✗ … — (0 , import_variations.splitOptionsForCard) is not a function
0 passed, 20 failed
```

GREEN (`29d5b5b`): `20 passed, 0 failed`.

Guaranteed: a list at or under six options is returned whole with
`collapsible:false`; a longer one previews six and counts the rest; the selected
option is pulled out of the hidden tail and never duplicated; visible entries
carry their index into `buildProductOptions()`, including the `"Standard"`
offset.

### Task 2 — per-variation photos and the swipe gallery

Execution: new pure module `src/lib/storefront/product-gallery.ts`
(`buildProductGallery`, `hasGallery`); `image` added to the `Variation` type, to
`ProductMetadata.variations`, to the storefront `Product` type and to the MCP
product schema; `cleanVariations` normalizes it through the shared
`normalizeHostedImageUrl`; `ProductGallery` in `Catalog.tsx` renders a
scroll-snapped track bound both ways to the option picker.

RED (`efcccd6`):

```
$ npm run test:variation-gallery
Error: Cannot find module '../src/lib/storefront/product-gallery'
```

GREEN (`29d5b5b`): `28 passed, 0 failed`.

Guaranteed: a product with no variation photos yields ≤1 slide and therefore no
gallery at all; slide 0 is the base photo and selects nothing; `optionIndex` maps
through `buildProductOptions()` so the `"Standard"` offset can't mis-select;
un-photographed variations are skipped without renumbering those after them;
only `http(s)` URLs become slides; the photo round-trips through
`productToDbWrite` → `dbProductToStorefront`, and an unsafe one never persists.

### Task 3 — the admin editor

Execution: a photo cell per variation row (reusing `uploadProductImageAction`,
so the 10 MB cap, ImageKit folder and media-library row all come for free), plus
`assignVariationImages` — a bulk path that uploads a multi-select batch
sequentially and matches each file to a row by name
(`silk-barbie.jpg` → "Silk Barbie"), falling back to filling empty rows in order.

Covered by the structural guards in `test:variation-gallery`.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | ≤6 options render whole, with no reveal button | `test-variation-collapse.ts:short lists stay exactly as they are today` | unit | PASS |
| 2 | 7 options is the first collapsible list (boundary) | `test-variation-collapse.ts:one MORE than the preview count` | unit | PASS |
| 3 | 81 options preview 6 and count 75 hidden | `test-variation-collapse.ts:collapsed → only the preview count is rendered` | unit | PASS |
| 4 | A pick in the hidden tail stays visible, undoubled | `test-variation-collapse.ts:a picked option is never hidden` | unit | PASS |
| 5 | Visible entries keep their real option index (incl. the Standard offset) | `test-variation-collapse.ts:visible entries keep their ORIGINAL index` | unit | PASS |
| 6 | Card and modal both render the shared collapsing picker | `test-variation-collapse.ts:Catalog.tsx wiring` | structural | PASS |
| 7 | No variation photos → ≤1 slide, no gallery chrome | `test-variation-gallery.ts:products with no variation photos are untouched` | unit | PASS |
| 8 | Slide 0 selects nothing, so mounting reveals no price | `test-variation-gallery.ts:slide 0 is the base image and selects nothing` | unit | PASS |
| 9 | optionIndex maps through buildProductOptions | `test-variation-gallery.ts:optionIndex maps through buildProductOptions` | unit | PASS |
| 10 | Skipped (un-photographed) variations don't renumber later ones | `test-variation-gallery.ts:un-photographed variations are skipped WITHOUT shifting` | unit | PASS |
| 11 | `javascript:` / `data:` / relative / non-string photos are rejected | `test-variation-gallery.ts:only hosted http(s) photos become slides` | unit | PASS |
| 12 | The photo round-trips through the DB mapping; unsafe ones never persist | `test-variation-gallery.ts:persistence` | integration | PASS |
| 13 | Swipe uses scroll-snap + IntersectionObserver, never a scroll handler | `test-variation-gallery.ts:Catalog.tsx wiring` | structural | PASS |
| 14 | Reduced motion is honoured on pill-driven scrolling | `test-variation-gallery.ts:reduced motion is honoured` | structural | PASS |
| 15 | Admin has both a per-row and a bulk upload path, and saves the photo | `test-variation-gallery.ts:AdminAddProduct.tsx wiring` | structural | PASS |

## Regression sweep

`tsc --noEmit` → 0 errors. All re-run after the change:

```
variation-price-reveal  9/0    product-variations  30/0   product-detail     20/0
variant-inventory      33/0    variation-gb-pricing 17/0  cart               20/0
checkout-names         10/0    two-ways-home       37/0   boutique-home      42/0
editorial-home         55/0    gb-cart-doses       22/0   wholesale-pricing  25/0
wholesale-admin        14/0    currency-surfaces   pass   onhand-order       pass
sort-categories        54 checks, 0 failures
```

`test:variation-price-reveal` matters most here: it pins "no price until you
pick", which the gallery could have broken by auto-selecting on mount. It stayed
green because slide 0 carries `optionIndex: null` **and** the observer skips its
first batch.

## Honest notes

- **Three structural guards were rewritten between RED and GREEN.** They asserted
  an implementation shape I did not end up building, not a behaviour that failed:
  (a) "≥2 `splitOptionsForCard(` call sites" would have forced the collapse logic
  to be duplicated in the card and the modal — it now counts `<OptionPicker`
  render sites instead, which is the same intent against a DRY implementation;
  (b) the admin handler guard matched names I did not use
  (`uploadVariationImage` / `assignVariationImages` are the real ones);
  (c) the save-path guard's 700-character window fell just short of the added
  code. All three were verified against the source by hand before being changed,
  and every behavioural assertion is unchanged from the RED commit.
- **No migration.** `variations` already lives in `Product.metadata` (Json), so
  `image` needs no `prisma db push` — worth noting given the pending-push backlog.
- **Not covered by automated tests:** the actual touch-swipe gesture, and how the
  gallery looks inside the Card Studio `horizontal` / `overlay` layouts. Both need
  a browser. The CSS is appended at the end of `storefront.css` specifically
  because earlier small-screen blocks restyle `.product-card__media` at the same
  specificity.
- **Deliberately out of scope:** `TwoWaysHome` still renders its option rows
  uncapped. `mstomato` is on the `classic` home layout, so it is unaffected; a
  tenant on the two-ways home with a long option list would still see a long row.
- **Not yet measured:** DOM weight for a seller who photographs all 81 colorways
  (82 lazy `<img>` per card). Slides are `loading="lazy"` and ImageKit-transformed;
  windowed rendering is the escape hatch if the catalog page regresses.
