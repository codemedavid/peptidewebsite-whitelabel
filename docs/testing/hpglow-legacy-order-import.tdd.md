# TDD evidence — importing HP GLOW's pre-whitelabel order history

**Source plan**: none — journeys were derived during this TDD run from the dump itself.
**Branch**: `feat/gb-pricing-tab`
**Date**: 2026-08-05

## The ask

> "can you check the @db_cluster-05-08-2026@01-12-58.backup we want to add the orders
> on the HP-GLOW tenant this is the old database of the hp glow and we just want the
> orders that they have before to have on the whitelabel now, can we do that?"

Yes. HP GLOW ran its own Supabase app until 2026-08 and the whitelabel tenant started
with **zero** orders, so eight months of history, revenue and demand were about to be
lost when the old app was retired.

## What the dump actually contained

Established before writing any code, because three of these changed the design:

| Finding | How it was checked | Consequence |
|---|---|---|
| 487 orders, 2025-11-24 → 2026-08-04 | `COPY public.orders` block, lines 4667–5155 | the full scope |
| Live tenant had **0** orders | Prisma probe on `storefront_orders` | a clean import, no merge |
| `scripts/hpglow-orders-seed.sql` was a stale **457**-order snapshot (to 2026-07-21) that was **never applied** | `git log`, row count, live DB count of 0 | superseded; removed |
| `total_price` == items subtotal on **all 487** rows (excludes shipping AND voucher) | reconciliation script over every row | never store the old total — carry the parts |
| All 469 proof URLs point at `rtsnxmatvbabdylsnuuh.supabase.co`, which is **NXDOMAIN** | `curl` + `nslookup`; `.rehost-backup/hpglow` holds only 52 product images | proofs are unrecoverable |
| Old item names map onto the 42-product live catalog | 56 distinct name+dose combos vs. catalog | lines can link to real `productId`s |
| Stock moves on status change, matched by `productId` **or exact name** | `applyStockMoveToProducts` in `lib/storefront/inventory.ts` | linking is unsafe without a guard |

The last two together are the crux: 432 of the imported orders are already `confirmed`,
so linking them to the live catalog — which we want, for Best Sellers and per-product
reporting — would let a later status change move live stock that was really consumed
months ago on a different system.

## Decisions (confirmed with the user)

1. **Payment proofs → dropped.** The images are gone; storing 469 dead URLs would only
   buy broken images in the proof viewer. `paymentProofUrl` is `NULL` on every row.
2. **Link to the catalog, and freeze stock.** New `StorefrontOrder.imported` flag;
   `inventoryMove()` refuses any deduct/restock on an imported order. History feeds
   analytics; live counts never move.
3. **Retired promo bundles stay unlinked.** 95 lines name monthly EXCLUSIVE tirzepatide
   bundles that no longer exist under that name. They import with their exact historical
   name, price and quantity — only per-product reporting misses them. Force-matching by
   stripping trailing parentheticals was rejected as a looser rule than the value earned.

## User journeys

1. As the HP GLOW owner, I want my eight months of past orders in the new store admin,
   so my history and revenue didn't reset when the site moved.
2. As the owner, I want past orders to show what the customer really paid — items,
   shipping and any voucher — not a subtotal that silently understates or overstates.
3. As the owner, I want Best Sellers and product reporting to see that history.
4. As the owner, changing an old order's status must never move my current stock.
5. As a buyer at checkout, my order must still deduct stock normally — nothing about
   the import may weaken the live path.
6. As the operator, re-running the import must never duplicate an order.

## Task report

| # | Task | RED evidence | GREEN evidence |
|---|---|---|---|
| 1 | Pure core: COPY parser, catalog resolution, row mapping, `imported` guard | `npm run test:legacy-import` → `MODULE_NOT_FOUND: ../src/lib/orders/legacy-import` (commit `b6dbe4a`) | 36 passed, 0 failed (commit `435db97`) |
| 2 | Persist the flag: `storefront_orders.imported`, `Order.imported`, all four `planStatusChange` sites | same RED — the flag did not exist, so an imported order would have moved stock | `npx tsc --noEmit` clean; `test:bulk-order-status` 27 passed; `db push` applied one additive column (`435db97`) |
| 3 | Dry-run-first importer script | n/a — I/O shell over the tested core | dry run: 487 parsed, 480/575 lines linked, ₱2,019,304.51 (commit `57d919f`) |
| 4 | Apply to the live tenant | n/a | 487 inserted; re-run inserted 0 (idempotent) |

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | The `public.orders` COPY block is read exactly, stopping at `\.` | `test-legacy-order-import.ts:reads exactly the orders block` | unit | PASS | `npm run test:legacy-import` |
| 2 | `\N` becomes `null`, never the literal string | `:\N becomes null` | unit | PASS | same |
| 3 | `\n` unescapes to a real newline inside a text field | `:\n unescapes to a real newline` | unit | PASS | same |
| 4 | A dump with no orders block yields `[]` instead of throwing | `:a dump with no orders block` | unit | PASS | same |
| 5 | A variation line links to the BASE product id and keeps its dose | `:a variation line resolves to the BASE product id` | unit | PASS | same |
| 6 | A dose baked into the old name folds back onto the matching variation | `:a dose baked into the old NAME folds back` | unit | PASS | same |
| 7 | A product whose dose IS its name links with no variation | `:a product whose dose IS its name` | unit | PASS | same |
| 8 | A discontinued product still imports, with name/qty/price intact and no `productId` | `:a discontinued product keeps its name and price` | unit | PASS | same |
| 9 | The legacy uuid becomes `clientId`, so a re-run cannot duplicate | `:the legacy uuid is carried as clientId` | unit | PASS | same |
| 10 | Dead Supabase proof URLs are never stored | `:the dead Supabase proof URL is dropped` | unit | PASS | same |
| 11 | `statusHistory` replays placement then the final status at its update time | `:statusHistory replays placement` | unit | PASS | same |
| 12 | Timestamps are preserved — orders date from when they were really placed | `:timestamps are preserved` | unit | PASS | same |
| 13 | A voucher becomes a snapshotted discount; none means no discount | `:a voucher becomes a snapshotted discount` | unit | PASS | same |
| 14 | The whitelabel total adds shipping and subtracts the voucher | `:the whitelabel total adds shipping` | unit | PASS | same |
| 15 | **An imported order moves no stock** when confirmed or cancelled | `:an IMPORTED confirmed order moves no stock`, `:an IMPORTED new order deducts nothing` | unit | PASS | same |
| 16 | A NORMAL order still deducts on confirm and restocks on cancel | `:a NORMAL confirmed order still restocks`, `:a NORMAL new order still deducts` | unit | PASS | same |
| 17 | Freezing stock does not freeze the order — status and journey still move | `:freezing stock does NOT freeze the order` | unit | PASS | same |
| 18 | `inventoryMove` itself honours the flag, so no caller can route around it | `:inventoryMove itself honours the flag` | unit | PASS | same |
| 19 | All 487 real rows parse, map, and reconcile on money | `:parses all 487`, `:every row maps without throwing` | integration | PASS | same (reads the real dump) |
| 20 | No real row keeps a proof URL; numbers and clientIds are unique | `:no imported order ever carries a proof URL`, `:order numbers are unique` | integration | PASS | same |

**No regression** (all re-run after the change):
`test:bulk-order-status` 27 passed · `test:order-detail` 17 passed ·
`test:admin-dashboard` 56 passed · `test:catalog-sort` 20 checks, 0 failures ·
`test:gb-report-orders` 22 passed · `test:checkout-total` 13 passed ·
`test:variant-inventory` 33 passed · `test:stock-gate` 41 passed ·
`npx tsc --noEmit` clean.

## Live result

```
rows: 487, imported: 487
range: 2025-11-24 → 2026-08-04
numbers: HPG-IMP-0001 … HPG-IMP-0487
revenue (non-cancelled): ₱2,019,304.51
top linked products by units sold:
   308  Tirzepatide
    84  Sungshim 31g x 8mm Insulin Syringe
    39  Tirzepatide 60mg (Free Shipping Nationwide)
    37  Glutathione
    27  GHK-CU
proofs stored: 0 (expect 0) | discounts: 51 (expect 51)
```

Re-running `--apply` inserted **0** new orders — idempotency confirmed against the live DB.

## Coverage and known gaps

- The pure core is fully covered; the importer script (`scripts/import-legacy-orders.ts`)
  is an I/O shell over it and is exercised by its own dry run rather than by a unit test.
- **95 order lines carry no `productId`** — the retired monthly EXCLUSIVE bundles and one
  discontinued syringe. Deliberate (see Decisions §3). Revenue and order history are
  unaffected; only per-product reporting misses them.
- **Payment proofs are permanently lost** for all 469 orders that had one. Nothing in this
  repo can recover them: the Supabase project is deleted and `.rehost-backup/hpglow` holds
  only the 52 product images rescued in 2026-07.
- `updatedAt` on imported rows is the import time, not the legacy update time — Prisma's
  `@updatedAt` owns that column. The real legacy update time is preserved inside
  `statusHistory`, which is what the Track page and the journey UI read.
- The dump is **not** committed (`*.backup` is git-ignored): it holds customer PII and
  `auth.users` password hashes.

## Merge evidence

If these commits are squashed, the RED/GREEN summary above is the record:

- RED  `b6dbe4a` — `npm run test:legacy-import` → MODULE_NOT_FOUND (no parser, no mapping,
  no `imported` flag, so an imported order would have moved live stock).
- GREEN `435db97` — 36 passed, 0 failed, including all 487 real rows.
- `57d919f` — dry-run-first importer.
- Refactor — removed the superseded `scripts/hpglow-orders-seed.sql`.
