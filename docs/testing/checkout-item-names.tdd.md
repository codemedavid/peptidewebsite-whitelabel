# TDD evidence — checkout line names carry the dose

**Source plan**: none. Journey derived during this TDD run from a live k-glow
report: *"for kglow website the checkout page is not showing the mg the name of
the product"*.

**Relation to [gb-card-dose-name.tdd.md](gb-card-dose-name.tdd.md)**: that change
put the dose on the group-buy *card* and explicitly logged the remaining
"no-dose/base-price **cart** bug" as a known gap. This is that gap, closed as far
as the data allows — see Known gaps for the part that still needs a product
decision.

## User journey

> As a k-glow customer reviewing my cart before I pay, I want each line to name
> the dose I am buying, so that I can confirm I am ordering 5mg and not 60mg —
> and so the seller who reads my order knows what to ship.

## Root cause

k-glow sellers put the dose in `metadata.variations`, not the product name — the
catalog row is `Semaglutide` and `5mg × 10 vials` is a variation.

The catalog card and the two-ways home render an option picker, so choosing one
clones the row through `makeVariationEntry` (`src/storefront/checkout.ts:72`),
which names the entry `Semaglutide — 5mg × 10 vials`. The dose survives.

The **group-buy page has no picker** (owner declined one, see the sibling
report). `src/storefront/pages/GroupBuyPage.tsx:160,177` calls `addToCart(p)`
with the raw catalog row, so `variantName` is never set and the entry keeps the
bare name. Three surfaces then read that bare name:

| Surface | Was |
|---|---|
| Checkout line + stepper labels | `CartCheckout.tsx:576,604-608` → `l.product.name` |
| Persisted order item | `CartCheckout.tsx:395` → `name: l.product.name` |
| Messaging handoff summary | `checkout.ts:327` → `• ${l.product.name} ×2 — ₱8,680` |

So the mg was gone from the customer's cart, the seller's order record, and the
WhatsApp/Telegram summary alike.

## The fix

`cartDisplayName(product)` in `src/storefront/checkout.ts` — the single name all
three surfaces now use. It appends the dose **only when the dose is actually
known**: exactly one buyable option (`buildProductOptions(product).length === 1`).

The deliberate non-appends matter as much as the appends:

- **Several options, none chosen** → stays bare. This string is persisted onto
  the order; `Tirzepatide 5mg / 10mg / 15mg` would tell the seller the customer
  ordered every dose at once. (This is why the card's `gbDisplayName`, which
  *does* join doses with `/`, is not reused here — a card advertises a range, an
  order line asserts a purchase.)
- **A distinct "Standard" base price beside one variation** → stays bare. The
  customer may have bought Standard, which is not the variation.
- **A chosen variation, or a name already carrying a dose** → left alone, so
  nothing is double-appended.

`DOSE_PATTERN` / `hasDoseToken` moved into `src/lib/storefront/variations.ts`, so
the group-buy card and the checkout line share one definition of "a dose" instead
of two copies of the regex.

The ratio-rule input at `CartCheckout.tsx:195` deliberately keeps the **raw**
name, commented in place — the ratio engine classifies unlabelled products by
name, and that is the name the owner's rules were written against.

## Task report

| Step | Command | Result |
|---|---|---|
| RED | `npx tsx scripts/test-checkout-item-names.ts` | `0 passed, 10 failed` — `cartDisplayName is not a function` |
| GREEN | `npm run test:checkout-names` | `10 passed, 0 failed` |
| Regression | 10 related suites (below) | `245 passed, 0 failed` |
| Typecheck | `npx tsc --noEmit --incremental` | exit 0, 0 diagnostics |
| Live data | read-only script over the k-glow catalog | 10 products gained the dose, 30 unchanged |

RED was a genuine business-logic gap, not a setup error: the module resolved and
the sibling imports (`makeVariationEntry`, `resolveLiveProduct`) loaded fine.

## Test specification

| # | What is guaranteed | Test | Result |
|---|---|---|---|
| 1 | A bare add of a single-variation product carries its dose | `test-checkout-item-names.ts` | PASS |
| 2 | A bare group-buy add is named identically to the same product added via a picker (one cart line, not two) | `test-checkout-item-names.ts` | PASS |
| 3 | A chosen variation is not double-appended | `test-checkout-item-names.ts` | PASS |
| 4 | A name already carrying its dose is left alone | `test-checkout-item-names.ts` | PASS |
| 5 | A product with no variations is left alone | `test-checkout-item-names.ts` | PASS |
| 6 | Several unchosen doses are never merged into one order line name | `test-checkout-item-names.ts` | PASS |
| 7 | A chosen dose survives on a multi-variation product | `test-checkout-item-names.ts` | PASS |
| 8 | A distinct "Standard" base price suppresses the append | `test-checkout-item-names.ts` | PASS |
| 9 | A live-re-hydrated cart entry still carries the dose | `test-checkout-item-names.ts` | PASS |
| 10 | An empty variation name never leaves a dangling separator | `test-checkout-item-names.ts` | PASS |

## Regression evidence

`test:cart` 15 · `test:group-buy-page` 37 · `test:group-buy-pricing` 18 ·
`test:gb-ratio` 34 · `test:two-ways-cart` 20 · `test:two-ways-home` 19 ·
`test:product-variations` 30 · `test:variant-inventory` 33 ·
`test:variation-price-reveal` 9 · `test:product-detail` 20 — **245 passed, 0
failed**.

### Why renaming an order item is safe

Every server-side lookup keys on `productId` first and only falls back to the
name (`orders.ts:168,202,221,263,375,415`; `checkout.ts:276`), and the client
always stamps `productId: baseProductId(l.product)` — so the fallback never
fires for orders placed through this checkout.

The one path that genuinely reads the name is ratio/rule classification, and it
matches on **substrings** — `/\bbac(?:teriostatic)?\s*water\b/i` and `/pept/i`
(`product-class.ts:21-23`). A ` — 5mg × 10 vials` suffix can neither introduce
nor remove either token, so classification is unchanged. `test:gb-ratio` (34
assertions) pins this.

## Live k-glow verification

A read-only pass over the tenant's 40 products (`cartDisplayName` against the
real catalog) — 10 gained the dose:

```
+  Semaglutide                 ->  Semaglutide — 5mg × 10 vials
+  PT-141                      ->  PT-141 — 10mg × 10 vials
+  MT-2 (Melanotan 2 Acetate)  ->  MT-2 (Melanotan 2 Acetate) — 10mg × 10 vials
+  Thymalin, Epithalon, DSIP, AOD-9604, AHK-CU, 5-Amino-1MQ, Mots C
```

## Coverage and known gaps

No repo-wide coverage tool is configured (the project uses targeted `tsx` suites
per feature, not a global runner), so no percentage is reported. The new module
boundary — `cartDisplayName` — is covered by all 10 assertions above, including
every branch: chosen variation, pre-dosed name, single option, multi option,
distinct Standard, no variations, and blank variation name.

**Known gap — multi-dose products still check out without a dose.** 17 of
k-glow's products offer several doses (Tirzepatide 9, Retatrutide 5, TB500 3,
Bacteriostatic Water 3, …). Bought from the group-buy page — which has no picker
— the customer never chose one, so the dose exists nowhere in the entry and no
naming rule can recover it. The line stays bare by design (guarantee #6) rather
than inventing one.

Closing that gap needs a **product decision, not a naming change**: a dose picker
on the group-buy card, the same one the owner declined when the card fix shipped.
Until then a k-glow order for "Tirzepatide" is genuinely ambiguous to the seller.

**Not covered**: no E2E test drives the real cart UI, so the wiring of
`cartDisplayName` into `CartCheckout.tsx` (render, aria-labels, order payload)
and into `buildOrderMessage` is verified by typecheck plus the live-catalog pass,
not by a browser assertion.
