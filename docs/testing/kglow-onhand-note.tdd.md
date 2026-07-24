# TDD Evidence — K Glow handwritten on-hand price note

**Task:** Extract the handwritten K Glow notebook image (a list of on-hand/ready-stock
peso prices) and add those products to the `k-glow` tenant. Companion to the PasaBuy
pricelist work (`kglow-pasabuy-pricelist.tdd.md`) — together they are K Glow's two ways
to order: **group-buy** (PasaBuy sheet) and **on-hand** (this note).

Journeys derived during this run (no `*.plan.md`):

- As the K Glow owner, I want my handwritten on-hand prices listed as ready-stock
  products so customers can buy them immediately (stock-gated, not pre-order).
- As a customer, I want on-hand items to appear separately from the group-buy
  catalog, priced at their own on-hand numbers.
- As the operator, I never want the on-hand Tirzepatide / GHK-CU rows to overwrite the
  existing group-buy Tirzepatide / GHK-CU products.

## Source data (owner-confirmed)

Two clarifications were confirmed before any code: the note = **on-hand stock prices**
(seed as non-group-buy products), and the transcription is **all correct as listed**.

| Code | Product | Size | ₱ | Note |
|------|---------|------|----|------|
| TR15 | Tirzepatide | 15mg | 3,200 | sheet was ₱3,600 |
| TR30 | Tirzepatide | 30mg | 4,900 | |
| TR60 | Tirzepatide | 60mg | 9,300 | sheet was ₱8,800 |
| GH100 | GHK-CU | 100mg | 2,880 | |
| GHK50 | GHK-CU | 50mg | 2,000 | base price |
| BAC3 | Bacteriostatic Water | 3ml | 488 | per bottle |
| BAC5 | Bacteriostatic Water | 5ml | 510 | per bottle |
| BAC10 | Bacteriostatic Water | 10ml | 732 | per bottle |
| KP10 | KPV | 10mg | 1,595 | |
| 5AM | 5-Amino-1MQ | 5mg | 2,800 | classified `other` |
| 5AD AOD | AOD-9604 | 5mg | 5,100 | |

11 lines → 6 products. Prices differ from the PasaBuy sheet, so these are **separate**
on-hand listings (their own `-OH` SKUs / `-on-hand` slugs), not edits to group-buy rows.

## Task report

| Step | Command | Result |
|------|---------|--------|
| RED | `npx tsx scripts/test-kglow-onhand.ts` (before lib existed) | FAIL — `Cannot find module './lib/kglow-onhand'` (intended: missing implementation) |
| GREEN | `npm run test:kglow-onhand` | PASS — 40/40 checks |
| Seed dry-run | `npx tsx scripts/seed-kglow-onhand.ts` | Printed 6-product plan, 0 writes |
| Seed apply | `npx tsx scripts/seed-kglow-onhand.ts --apply` | `✓ upserted 6 on-hand products — k-glow now has 31 products` |
| DB verify | ad-hoc query | 6 rows `type=onhand`, stock 10, active; GB `TIRZEPATIDE`/`GHKCU` intact with `type=gb` |

Guaranteed by the passing gate: correct transcription of all 11 lines, correct grouping
into 6 products, no group-buy tag on any on-hand product, positive seed stock (on-hand is
stock-gated), 10-vial kits vs. ml bottles, product classes (`peptide`/`bacWater`/`other`),
integer-cent PHP pricing, and SKU/slug collision guards vs. the group-buy namesakes.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | All 11 handwritten lines transcribed with owner-confirmed identities + prices | `scripts/test-kglow-onhand.ts` (row checks) | unit | PASS |
| 2 | 11 lines group into 6 on-hand products, names unique | grouping checks | unit | PASS |
| 3 | No on-hand product carries the group-buy tag | `no product is a group-buy listing` | unit | PASS |
| 4 | Every on-hand product seeds with positive stock (else unpurchasable) | `every product seeds with positive stock` | unit | PASS |
| 5 | Peptides = "size × 10 vials"; bac water = ml bottles | packaging checks | unit | PASS |
| 6 | Bac water → `bacWater`, 5-Amino-1MQ → `other`, Tirzepatide → `peptide` | class checks | unit | PASS |
| 7 | Base price = cheapest variation, carried by a named option | base-price checks | unit | PASS |
| 8 | Integer-cent PHP pricing with ₱ display symbol | DB-shape checks | unit | PASS |
| 9 | On-hand SKUs/slugs differ from GB `TIRZEPATIDE`/`GHKCU` (no overwrite) | collision-guard checks | unit | PASS |

## Coverage & known gaps / assumptions

- **Framework:** repo convention is a self-contained `tsx` assertion runner (no Jest), same
  as `test-kglow-pricelist.ts`. 40 assertions cover every row and every product invariant
  the seed depends on. No DB in the gate — the seed is exercised separately (dry-run + apply).
- **Assumption — packaging:** the note listed only codes + prices. Peptide codes mirror the
  PasaBuy sheet's 10-vial kits (prices are clearly per-kit, not per-vial), so peptide
  variations read "× 10 vials"; bacteriostatic water is per bottle by volume. Owner-adjustable.
- **Assumption — stock:** the note carried no counts. Every on-hand product seeds with a
  placeholder `stock = 10` so it is purchasable; the owner sets real counts in the store
  admin. Re-running the seed does **not** overwrite stock (protects owner edits).

## Merge evidence

- `test: RED gate for kglow handwritten on-hand price note extraction` (`d2799e0`) — RED.
- `feat: kglow handwritten on-hand note → 6 on-hand products (seed + verified extraction)`
  (`4dbefba`) — GREEN (40 checks) + additive idempotent seed.
- `docs: TDD evidence — kglow on-hand note` — this report.
