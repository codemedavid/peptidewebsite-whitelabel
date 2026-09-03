# Nova Lab — SRP pricelist entry (TDD evidence)

**Date:** 2026-09-04 · **Branch:** `feat/made-to-order`
**Commits:** `8df69e2` (RED) → `ef6f8a9` (GREEN)

## Source

No `*.plan.md`. The input was a screenshot of the owner's spreadsheet, columns
**Product Name** and **WEBSITE w/BAC SRP**. Journeys were derived during this
run. The transcription lives in `scripts/nova-lab-pricelist.ts` and is the
single source of truth shared by the seeder and the gate.

Two interpretation calls were put to the user before any write:

| Question | Decision |
|---|---|
| Sheet lists Tesamorelin **10 mg** / MOTS-C **20 mg**; store had 5 mg / 10 mg | Add the sheet's doses as new products, set the two superseded stubs to **draft** (not deleted — they keep their photos) |
| Name style | Clean title (`Tirzepatide 15mg`), benefit phrase moved into the description |

## User journeys

- As the Nova Lab owner, I want my SRP sheet to be the catalog, so shoppers see
  a real price instead of "price on request".
- As a shopper, I want the price shown to include what I actually receive, so
  the description states the bacteriostatic water is included.
- As a shopper, I want the category chip to filter, so a product filed under a
  category *label* must not silently match nothing.
- As the owner, I want the photos I already uploaded to survive a price update.

## Task report

**1 — Transcribe the sheet and gate the catalog against it.**
Added `scripts/nova-lab-pricelist.ts` (manifest) and
`scripts/test-nova-lab-catalog.ts` (DB gate), wired as
`npm run test:nova-lab-catalog`.

```
$ npm run test:nova-lab-catalog        # RED, before any data change
  ✗ BPC-157 10mg — price — expected 350000, got 0
  ✗ BPC-157 10mg — no longer price-on-request
  ✗ Ipamorelin 10mg exists — no product with slug "ipamorelin-10mg"
  ✗ no live product outside the pricelist — got ["mots-c-10mg","tesamorelin-5mg"]
  ✗ catalog category is the expected one — expected ["peptides"], got ["Peptides"]
70 checks, 42 failure(s)
```

Failure causes are all intended: nine products at ₱0 with `priceOnRequest`, six
sheet rows with no product at all, and the pre-existing category-label bug.

**2 — Enter the pricelist.**
Added `scripts/seed-nova-lab-pricelist.ts`; upserts by `(tenantId, slug)`
through the app's own `productToDbWrite`.

```
$ npx tsx scripts/seed-nova-lab-pricelist.ts
  ✓ Tirzepatide 15mg  ₱3,000   (new)     … 15 rows …
  ⊘ tesamorelin-5mg — hidden (superseded by the pricelist dose)
  ⊘ mots-c-10mg — hidden (superseded by the pricelist dose)
Done. 15 pricelist rows upserted — 15 live of 17 products for this tenant.

$ npm run test:nova-lab-catalog        # GREEN, same target
126 checks, 0 failure(s)
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Every sheet row exists as a Nova Lab product at its exact SRP in centavos | `test-nova-lab-catalog.ts: "— price"` | integration (DB) | PASS |
| 2 | Prices are PHP and display the ₱ symbol the owner typed | `"— currency"`, `"— display symbol"` | integration | PASS |
| 3 | No priced row is still `priceOnRequest` (which outranks the price on every surface) | `"— no longer price-on-request"` | integration | PASS |
| 4 | Every priced row is buyable — real stock or made-to-order | `"— buyable"` | integration | PASS |
| 5 | Descriptions carry the benefit phrase and the BAC inclusion | `"— description"` | integration | PASS |
| 6 | Doses the sheet supersedes are hidden from the storefront | `"superseded … hidden"` | integration | PASS |
| 7 | No live product is left at ₱0 | `"no live product left at ₱0"` | integration | PASS |
| 8 | No live product sits outside the pricelist | `"no live product outside the pricelist"` | integration | PASS |
| 9 | Every live product is filed under a real category **id**, so the chip filters | `"every live product filed under a real category id"` | integration | PASS |

## Coverage and known gaps

The repo has no global coverage runner (no `test:coverage` script); its
convention is per-feature `scripts/test-*.ts` gates, which is what this follows.
The gate covers every field the pricelist asserts, on live data.

Deliberate gaps:

- **The sheet's last row is not entered.** It is cut off at the bottom of the
  supplied screenshot (bacteriostatic water sold on its own) and its price is
  unreadable, so it was omitted rather than guessed. Adding it later is one line
  in `nova-lab-pricelist.ts` plus a re-run of the seeder.
- **Eight new products have no photo.** The seven pre-existing rows kept their
  uploaded ImageKit assets; the eight created here have none, and the tenant has
  no `defaultProductImage` configured, so they render the built-in placeholder
  until the owner uploads images.
- **No browser verification.** The storefront's `product.findMany` runs live
  inside `withTenant` (not `unstable_cache`), so the new prices appear without a
  restart, but that was reasoned from the code rather than observed in a browser.
