# TDD evidence — the sale price is visible while browsing

**Date:** 2026-08-28
**Source plan:** none. Journeys were derived during this TDD run from the store
owner's report: *"Yung mga naka sale na products di lumalabas agad. :( tska lang
malaman na sale siya pag nasa cart na."*

## User journeys

1. As a shopper, I want to see that a product is discounted **while I am browsing
   the catalog**, so the saving can influence what I decide to buy — instead of
   discovering it after I have already chosen and opened the cart.
2. As a shopper, I want to see the price it was marked down **from**, so I can
   judge whether the saving is worth acting on.
3. As a store owner, I want the price my storefront advertises to be the price my
   customer is actually charged, so nobody is surprised at checkout in either
   direction.
4. As a store owner, I want a discount I toggled on but never priced to do
   nothing, rather than give my stock away.

## The defect

`checkout.unitPrice` consulted `discountPrice`. **Nothing else did.** The catalog
card, the quick-view modal and the two-ways ships-now shelf all printed
`product.price`, so a markdown was invisible until the item reached the cart.

HP Glow ships ~8 such products today (`scripts/hpglow-tenant-seed.sql`), e.g.
`hpglow-p-015` Retatrutide 30mg: listed ₱4,299, charged ₱3,899.

## Task report

### RED — reproduce

Ran against shipped code only, before any fix:

```
card / catalog shows : 4299
cart actually charges: 3899
agree?               : false

enabled discount, price left blank -> cart charges: 0
```

The second line was found while writing the reproducer: `discountEnabled` with an
empty price is saved as `Number("") || 0`, and the old rule
(`discountEnabled && typeof discountPrice === "number"`) read that blank field as
a **₱0 sale the cart would have honoured**.

`npm run test:sale-price` then failed to resolve `src/lib/storefront/sale` — the
shared rule did not exist. Checkpoint: `3b25651`.

### GREEN — fix

New `src/lib/storefront/sale.ts` holds one rule:

- `effectiveBasePrice` — what one unit costs: an active markdown, else list.
  `checkout.ts` and `wholesale.ts` now both price from it.
- `resolveSaleView(product, selectedIndex)` — what a browsing surface renders:
  price, `compareAt`, `percentOff`, `badgeLabel`. Every browsing surface uses it.

A discount is now active only when it is **positive and below list**. Anything
else falls back to the list price — the only safe direction to err.

The markdown belongs to the base price alone. `makeVariationEntry` deliberately
clears `discountEnabled`/`discountPrice` when cloning a chosen variation into the
cart, so advertising a saving on a variation would advertise a price the cart
refuses to charge — the same bug pointed the other way.

Checkpoints: `8ae8890`; the `Catalog.tsx` + `storefront.css` half landed in
`de70dba`, swept in by a concurrent session working in those two files.

### Verification — rendered markup

`ProductCard` server-rendered with the real HP Glow figures:

```
ON SALE (4299 -> 3899)
  badge: 9% off
  price: ₱3,899<s class="product-card__compare"><span class="sf-sr-only">Was </span>₱4,299</s>

NO SALE
  badge: Featured
  price: ₱4,299

DISCOUNT TOGGLED ON, PRICE LEFT BLANK
  badge: Featured
  price: ₱4,299
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | A discount below list, with the toggle on, is a real sale | `test-sale-price.ts:isDiscountActive` | unit | PASS |
| 2 | A toggled-on discount with a blank (0) price is NOT a sale — never sells at zero | `test-sale-price.ts:the toggle with an unset (0) discount price` | unit | PASS |
| 3 | A "discount" at or above list is ignored — a sale never raises the price | `test-sale-price.ts:a discount at or ABOVE the list price` | unit | PASS |
| 4 | A single-price product shows its sale price with no interaction | `test-sale-price.ts:shows the SALE price immediately` | unit | PASS |
| 5 | The struck list price it was marked down from is exposed as `compareAt` | `test-sale-price.ts:comes back as compareAt` | unit | PASS |
| 6 | The saving is a whole percent for the badge (4299→3899 = 9%) | `test-sale-price.ts:expressed as a whole percent` | unit | PASS |
| 7 | Reveal-on-click survives: a variation product shows no price until a pill is picked | `test-sale-price.ts:nothing picked yet` | unit | PASS |
| 8 | The base "Standard" option carries the markdown | `test-sale-price.ts:picking the base 'Standard' option` | unit | PASS |
| 9 | A real variation shows its own price and no sale | `test-sale-price.ts:picking a real variation` | unit | PASS |
| 10 | **The advertised price equals `checkout.unitPrice`** — 5 cases | `test-sale-price.ts:parity with checkout.unitPrice` | integration | PASS |
| 11 | The card and the modal both price from `resolveSaleView` | `test-sale-price.ts:Catalog.tsx card + quick-view modal` | structural | PASS |
| 12 | Both surfaces render a struck compare-at price and a sale badge | `test-sale-price.ts:both surfaces render a struck-through` | structural | PASS |
| 13 | The two-ways ships-now shelf advertises the sale price + compare-at | `test-sale-price.ts:the shelf advertises the sale price` | unit | PASS |
| 14 | A product with no sale exposes no compare-at anywhere | `test-sale-price.ts:no sale exposes no compare-at` | unit | PASS |

`npm run test:sale-price` → **27 passed, 0 failed.**

### Regression sweep

All green after the change:

```
cart 20/0 · two-ways 18/0 · two-ways-home 37/0 · two-ways-cart 20/0
wholesale-pricing 25/0 · variation-price-reveal 9/0 · product-detail 20/0
group-buy-pricing 19/0 · group-buy-page 51/0 · checkout-total 13/0
variant-inventory 33/0 · kglow-onhand PASS · onhand-order PASS
```

`npx tsc --noEmit` reports no errors in any file touched here.

`scripts/test-variation-price-reveal.ts` needed one guard updated: it asserted
`Catalog.tsx` calls `resolveSelectedPrice` **by name**. The card now reaches that
same function through `resolveSaleView`, which wraps it. The behaviour the guard
protects (no price until a pill is clicked) is unchanged and is re-pinned by
row 7 above; only the name of the function the card calls moved.

## Coverage and known gaps

- **No coverage number.** This repo has no coverage tooling — no Vitest, Jest or
  `test:coverage` script. Verification is the ~90 targeted `scripts/test-*.ts`
  suites. Quoting a percentage here would be inventing one.
- **No screenshot.** A dev server starts, but the Supabase pooler is unreachable
  from this machine, so no tenant catalog could be loaded. Verified instead by
  server-rendering `ProductCard` directly (markup above). A visual pass at
  320/768/1440 is still worth doing once the database is reachable.
- **Untouched surface:** the gated reseller/wholesale page (`#merchant`) shows
  wholesale prices only and never displayed a retail markdown, so it is unchanged.
- **Found, not fixed:** HP Glow's `hpglow-p-006` Glutathione carries a ₱999
  discount on a ₱1,499 base, but its only variation is *also* priced ₱1,499. The
  cart has always charged ₱1,499 there (a chosen variation drops the promo), and
  the storefront now honestly shows ₱1,499 rather than a saving it would not
  honour. The owner's ₱999 almost certainly means something and never applied —
  worth a warning in the product editor, which is a separate change.
