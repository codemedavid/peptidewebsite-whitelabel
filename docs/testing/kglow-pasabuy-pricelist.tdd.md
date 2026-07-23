# TDD Evidence — kglow PasaBuy pricelist import

**Date:** 2026-07-23
**Source plan:** none — journey derived in-session from the owner's pricelist image
(53 catalog rows) plus four confirmed decisions: PESO column authoritative,
group rows by name into per-size variations, everything tagged group-buy
(`productType: "gb"`, no `gbPrice`), and the 3 pre-existing kglow products merged
away.

## User journey

> As the kglow store owner, I want my PasaBuy pricelist in the storefront as
> group-buy products with size options, so customers order at the printed ₱ prices.

## Task report

| Task | Summary | Validation command | Result |
|------|---------|--------------------|--------|
| Transcribe sheet | 53 rows (cat no / name / spec / USD / PESO) into `scripts/lib/kglow-pricelist.ts` | `npm run test:kglow-pricelist` | PASS (32 checks) |
| Group into products | 53 rows → 25 products, per-size variations, base = cheapest size | same gate | PASS |
| Seed DB | `npx tsx scripts/seed-kglow-products.ts --apply` | apply output | `✓ upserted 25 products — k-glow now has 25 products` |
| Verify round-trip | DB rows → `dbProductToStorefront` | inline tsx probe | 25 gb products, 53 size options, all PHP, old SKUs gone |
| Regressions | two-ways split + variations engine untouched | `npm run test:two-ways`, `scripts/test-product-variations.ts` | 18/18, 30/30 |

## RED → GREEN

- **RED** (`c913204`): `scripts/test-kglow-pricelist.ts` executed before the
  module existed — `Error: Cannot find module './lib/kglow-pricelist'`
  (missing-implementation failure, the intended RED).
- **GREEN** (`2e83ca2`): implementation added; the same gate reports
  `PASS — pricelist extraction & grouping verified` (32/32). `tsc --noEmit` clean.
- **Refactor:** none needed — data module + builder came out flat; no third commit.

## What the passing gate guarantees

| # | Guarantee | Check |
|---|-----------|-------|
| 1 | All 53 sheet rows transcribed, unique cat numbers, positive USD/₱ prices | row-level checks |
| 2 | Transcription-typo tripwire: every FX row's ₱ within 2% of USD×62 (the sheet's own FX wobble makes exact equality wrong) | FX cross-check |
| 3 | Tirzepatide = 9 FX-less tiers; pink specials TR15 ₱3,600 / TR30 ₱4,900 exact | spot checks |
| 4 | 25 grouped products, every row surfaces as exactly one uniquely-named variation | grouping checks |
| 5 | Base price = cheapest size and carried by a named variation, so `buildProductOptions` never renders a nameless "Standard" pill | option-builder contract |
| 6 | All products `productType: "gb"` with **no** `gbPrice` (printed ₱ is the PasaBuy price — no phantom savings) | type checks |
| 7 | Sheet quirks pinned: blank IP5/IP10 cell → Ipamorelin; BT2's duplicated spec → 2mg at ₱4,216 | inference guards |
| 8 | PHP integer centavos, ₱ symbol, unique SKUs/slugs per tenant | DB-write shape |

## Coverage & known gaps

- This repo gates with self-contained `tsx` scripts, not jest coverage; the new
  gate covers 100% of `scripts/lib/kglow-pricelist.ts`'s exported surface.
- The seed script's Prisma I/O is exercised by the real apply run (verified
  above), not by a mock harness — consistent with every other `seed-*.ts` here.
- Sheet oddities kept as printed and worth an owner double-check: Semaglutide
  15mg (₱4,650) is cheaper than 10mg (₱6,262) — the sheet prints $75 vs $101;
  BT2 and BT5 share ₱4,216.
- Product images not on the sheet — cards fall back to
  `branding.config.defaultProductImage` until the owner uploads per-product shots.
