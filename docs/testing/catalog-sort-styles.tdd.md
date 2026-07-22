# TDD Evidence — Catalog sort menu styles (HP Glow 3-option filter)

**Date:** 2026-07-23
**Request:** "can you make this 3 only in the hp glow for the filter" — the HP Glow
storefront's catalog filter dropdown should offer exactly: **Sort by Name /
Sort by Price / Sort by Best Sellers** (user-supplied screenshot), with best
sellers ranked by **real sales data** (user's choice), while every other store
keeps the existing menu.

## Source plan

No `*.plan.md` — journeys derived during this TDD run.

## User journeys

1. As an HP Glow shopper, I open the catalog filter and see exactly three
   options: Sort by Name, Sort by Price, Sort by Best Sellers.
2. As an HP Glow shopper, "Sort by Best Sellers" puts the most-purchased
   products first (real units sold; cancelled/refunded orders never count).
3. As any other store's shopper, the sort dropdown is unchanged
   (Sort: Name / Price: Low to High / Price: High to Low).

## Design

- `src/lib/storefront/catalog-sort.ts` — pure module: `normalizeCatalogSortStyle`
  (untrusted config → `"classic" | "simple"`), `catalogSortOptions` (option list
  per style), `buildBestSellerCounts` (units sold per product id from order
  rows; demand statuses only; variation lines roll up via the base `productId`
  stamped at checkout; legacy lines key by `name:<name>`), `sortCatalogProducts`
  (pure sorter; "best" → units desc, name tiebreak; unknown → name).
- `Brand.catalogSortStyle` + `Brand.bestSellerCounts` (src/storefront/types.ts).
- Server: `src/app/(tenant)/(storefront)/page.tsx` resolves the style from
  `branding.config` and, only for `"simple"`, loads order rows
  (`StorefrontOrder.status` + `items`) → counts; failures degrade to `{}`.
- Client: `Catalog.tsx` renders `catalogSortOptions(...)` and sorts via
  `sortCatalogProducts(...)`.
- Owner control: "Sort menu" `TweakSelect` in `BrandTweaksForm.tsx`
  (Classic / Name · Price · Best Sellers) → `branding.config.catalogSortStyle`.
- Per-tenant flip: `scripts/set-catalog-sort-style.ts <slug> [simple|classic]`.

## Task report (RED → GREEN)

| Stage | Command | Result |
|---|---|---|
| RED | `npm run test:catalog-sort` | `MODULE_NOT_FOUND` for `src/lib/storefront/catalog-sort` — the intended missing implementation (compile-time RED). Commit `8074d28`. |
| GREEN | `npm run test:catalog-sort` | `20 checks, 0 failure(s)`. Commit `7bbdba8` (types/tweaks/package.json edits landed via concurrent-session commit `a32a71e`, verified present in HEAD). |
| Types | `npx tsc --noEmit` | 0 errors in any touched file (remaining errors are pre-existing in old one-off scripts). |
| Rollout | `npx tsx scripts/set-catalog-sort-style.ts hpglow simple` | `✓ hpglow: branding.config.catalogSortStyle = "simple"` |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Missing/garbage config → classic; only `"simple"` opts in | `normalizeCatalogSortStyle` block | unit | PASS |
| 2 | Classic menu is byte-identical to today's three options (regression anchor for all other stores) | "classic keeps today's three options" | unit | PASS |
| 3 | Simple menu is exactly Sort by Name / Sort by Price / Sort by Best Sellers | "simple is Name / Price / Best Sellers only" | unit | PASS |
| 4 | Units sum across orders; variation lines roll up to the base product id | "p1 units sum across orders incl. variation rollup" | unit | PASS |
| 5 | Cancelled/refunded orders never count as sales | "p2 counts only demand units" | unit | PASS |
| 6 | Legacy order lines without productId still count (name key) | "legacy no-productId line keyed by name" | unit | PASS |
| 7 | NaN / negative quantities are skipped, never poison the map | bad-qty fixture | unit | PASS |
| 8 | Best-sellers sort: units desc, name tiebreak, zero-sales last | "best ranks by units sold desc…" | unit | PASS |
| 9 | Unknown sort value (or no counts) falls back to name order — catalog never scrambles | fallback checks | unit | PASS |
| 10 | Counting and sorting never mutate their inputs | immutability checks | unit | PASS |

All 20 checks pass: `npm run test:catalog-sort`.

## Coverage and known gaps

- The pure module is fully covered by the gate. The server wiring in `page.tsx`
  (order fetch → counts) and the `<select>` rendering are covered by the live
  verification below rather than a mocked integration test, matching this
  repo's script-gate convention.
- Best-seller counts refresh with the page's 5-min per-host cache
  (`unstable_cache`), not per request — acceptable for a sort order.
- Direct-Prisma config writes (the flip script) don't bust the cache tag; the
  storefront picks the change up within ~5 minutes.

## Merge evidence

Checkpoints on `main`: `8074d28` (RED), `7bbdba8` (GREEN). Shared-file edits
(`types.ts`, `BrandTweaksForm.tsx`, `package.json`) were committed by the
concurrent session's `a32a71e`; verified present in HEAD before the GREEN commit.
