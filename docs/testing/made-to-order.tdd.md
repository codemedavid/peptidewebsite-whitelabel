# Made-to-order products — TDD evidence

**Feature:** products manufactured after the order is placed sell with no inventory.
**Branch:** `feat/made-to-order`
**Source plan:** derived in-session (`/ecc:plan`), not from a `.plan.md` artifact.
**Suite:** `npm run test:made-to-order` → `scripts/test-made-to-order.ts`

## Why

Tenant `mstomato` sells vial cases and caps in up to 81 colourways, all
manufactured per order. It therefore holds no inventory, and all 21 of its
products sat at `stock = 0` — 17 of them `active`, carrying 1,233 untracked
colourway variations between them.

The stock gate read that correctly and shut the shop. Verified against the live
DB before any code was written:

| Layer | Site | Behaviour |
|---|---|---|
| Card badge | `Catalog.tsx:433` | "Out of stock" |
| CTA | `product-cta.ts:136` | "Sold out", disabled |
| Option pills | `Catalog.tsx:561` | all 81 struck through, `· out` |
| Add to cart | `store.tsx:583` | `room = 0`, refused |
| Cart drawer | `CartCheckout.tsx:298` | blocking violation |
| Placement | `orders.ts:1243` | server-side rejection |

The storefront could not take a single order.

## User journeys

1. As a made-to-order seller, I want my products to sell without stock, so a
   catalog I never restock is still buyable.
2. As the same seller, I want to keep stocked items stocked, so I can mix both
   in one store (most of my catalog is made to order, not all of it).
3. As the platform operator, I want this OFF for every other tenant, so nobody
   else's inventory safeguard weakens when this deploys.
4. As the seller, I want an ordinary product edit not to silently put a listing
   back on the stock gate.

## Design

`effectiveStock` answers `Infinity` for a made-to-order product. That is the
honest reading — units available genuinely are unbounded for an item made after
the order — and it is the same statement `cartLineRoom` already makes about a
group-buy pre-order (`isGroupBuyPreorder`). Because all six gates resolve
through that one number, none of them needed its own flag check.

Four readers touch the raw column on purpose and are handled explicitly:

| Reader | Treatment | Why not Infinity |
|---|---|---|
| `applyStockMovesToProducts` | returns the product untouched | a confirm would write a row to clamp 0 back to 0 |
| `productUnits` / `lowStockProducts` | `0`, and excluded from low-stock | the number is SUMMED into a dashboard tile |
| `two-ways-home` | shows the label | would render "Infinity in stock" |
| `AdminInventory` | own pill + excluded from counts | 19 listings would sit in "Out of stock" forever |

## Task report

| Task | Command | Result |
|---|---|---|
| RED — reproducer | `npm run test:made-to-order` | `Cannot find module '../src/lib/storefront/made-to-order'` (commit `9cdf213`) |
| GREEN — engine + wiring | `npm run test:made-to-order` | **32 passed, 0 failed** (commit `4bfe21c`) |
| Typecheck | `npx tsc --noEmit` | clean (pre-existing `test-inline-media` RED from separate in-flight work excluded) |

Two real defects the RED run exposed, both "the engine is right but a caller
bypasses it":

- `productOutOfStock`'s **no-variation branch** read `product.stock` raw, so a
  simple listing stayed sold out after the engine cleared it.
- `buildProductCta`'s **unselected fallback** did the same, so its final
  `stock <= 0` branch still said "Sold out".

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | `isMadeToOrder` is true only for an explicit `true` (never for `undefined`) | `test-made-to-order.ts` | unit | PASS |
| 2 | A made-to-order line reads as unbounded even at a zero column | " | unit | PASS |
| 3 | Its variations are unbounded whether or not they track stock | " | unit | PASS |
| 4 | An ordinary product's stock reading is completely unchanged | " | unit | PASS |
| 5 | mstomato's real shape (81 untracked colourways, stock 0) is buyable | " | unit | PASS |
| 6 | No colourway pill renders struck-through | " | unit | PASS |
| 7 | The same product WITHOUT the flag is still sold out | " | unit | PASS |
| 8 | CTA is "Add to Cart", enabled, with an uncapped qty stepper | " | unit | PASS |
| 9 | Closed shop / paused product / price-on-request each still win | " | unit | PASS |
| 10 | `cartLineRoom` unbounded; the cart's "+" never locks | " | unit | PASS |
| 11 | A made-to-order line never blocks the cart | " | unit | PASS |
| 12 | A normal sold-out line in the SAME cart still blocks | " | unit | PASS |
| 13 | Confirming an order does not churn its stock column | " | unit | PASS |
| 14 | A tracked made-to-order variation is not deducted either | " | unit | PASS |
| 15 | An ordinary product in the same batch still deducts | " | unit | PASS |
| 16 | `madeToOrder:true` survives the full save pipeline | " | integration | PASS |
| 17 | A stocked product never persists the key | " | integration | PASS |
| 18 | An ordinary admin save does not clear the flag | " | integration | PASS |
| 19 | An unentitled tenant's products gate exactly as today | " | unit | PASS |
| 20 | An entitled catalog is not needlessly copied | " | unit | PASS |
| 21 | Placement strips the flag before its stock guard | " | source | PASS |
| 22 | The storefront resolves the entitlement server-side | " | source | PASS |
| 23 | The feature is registered and outside every plan ceiling | " | source | PASS |
| 24 | The dashboard does not report these as low stock | " | source | PASS |
| 25 | Inventory labels them instead of "Out of stock" | " | source | PASS |
| 26 | The product editor can set the flag | " | source | PASS |

## Neighbours (no regressions)

`variant-inventory` 33 · `stock-gate` 41 · `product-add-gates` 23 ·
`product-detail` 20 · `admin-dashboard` 56 · `data-export` 38 ·
`two-ways-home` 37 · `bulk-status-batching` 26 · `product-variations` 31 ·
`plan-scope` 19 · `catalog-sort` 20 · `mcp-variations` — all passing.

## Rollout (not yet executed)

```bash
npm run db:sync-features                       # the Feature row does not exist yet
npx tsx --env-file=.env scripts/mark-mstomato-made-to-order.ts --dry   # marks ALL 21
npx tsx --env-file=.env scripts/mark-mstomato-made-to-order.ts        # --active-only to skip drafts
npx tsx --env-file=.env scripts/grant-feature.ts mstomato storefront.made_to_order on
```

Then the owner must press **Save** in the store admin (or the server restarted):
a direct-Prisma script cannot invalidate `unstable_cache`, so the storefront
keeps serving the old catalog until it turns over.

## Known gaps

- No coverage tool is configured in this repo; coverage is expressed as the
  behavioural table above, matching every neighbouring suite's convention.
- New products are NOT made-to-order by default; the owner ticks the box. A
  store-wide default was considered and deliberately left out (YAGNI) — revisit
  if mstomato adds products often enough for the tick to be a nuisance.
- `AdminInventory` still edits product-level stock only. A made-to-order row
  keeps its (unused) stepper rather than hiding it — display polish, no
  behavioural effect, since nothing reads the column for these products.
- Deduction reads the LIVE catalog, so un-marking a product later makes already
  pending orders deduct on confirm. Deliberate: it matches how every other
  catalog-driven rule behaves.

## Merge note

`page.tsx` and `orders.ts` wiring for this feature was swept into commit
`30c3755` by a concurrent session committing from the same working tree; the
`types.ts` in `4bfe21c` likewise carries that session's in-flight reseller
declarations. The behaviour is unaffected and all suites above were run against
the merged tree.
