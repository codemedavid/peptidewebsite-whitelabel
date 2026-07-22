# TDD Evidence — "Standard" option duplicating a same-priced variation (hpglow)

**Date:** 2026-07-23 · **Branch:** main · **Commits:** RED `514c948`, GREEN `70fa430`

## Source plan

No `*.plan.md` — journeys derived during this TDD run from a user bug report
(screenshot of hpglow's Thymosin Alpha-1 card showing `STANDARD · PHP1,099`
alongside `5MG · PHP1,099` and `10MG · PHP2,099`).

## Root cause

Live-DB inspection (read-only scratchpad script against tenant `hpglow`)
showed **every** hpglow product re-enters its base price as the first named
variation, e.g.:

- Thymosin Alpha-1: base ₱1,099 + variations `5mg·1,099`, `10mg·2,099`
- Precision Pen: base ₱1,399 + variations `Black/Coral/Pink` all `1,399`

`buildProductOptions` (`src/lib/storefront/variations.ts`) unconditionally led
with a synthetic `Standard` option at the base price whenever variations
existed — duplicating the same price with no size/color info.

## User journey

As a shopper, when a product's base price is already represented by a named
variation, I should see only the named options — no nameless "Standard"
repeating the same price.

## Fix

`buildProductOptions` now includes `Standard` only when the base price is a
**distinct price point** — `price > 0` and no variation carries the same
price. Affects both consumers of the shared helper (`Catalog.tsx`,
`TwoWaysHome.tsx`); no data migration needed, generalizes across tenants.

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|--------------------|------|------|--------|----------|
| 1 | A variation matching the base price replaces "Standard" instead of duplicating it | `scripts/test-product-variations.ts` | unit | PASS (was RED) | `npm run test:product-variations` |
| 2 | All-variations-at-base-price (color options) never add a nameless duplicate | same | unit | PASS (was RED) | same |
| 3 | A base price distinct from every variation still leads as "Standard" | same | unit | PASS | same |
| 4 | Prior behaviors unchanged (no-variations → no options; ₱0 base skipped; cart clone reference kept) | same | unit | PASS | same |

## RED → GREEN

- **RED** (`514c948`): `npm run test:product-variations` → `28 passed, 2 failed`
  (both new duplicate-suppression cases failed for the intended reason: the
  old code emitted `{ name: "Standard", price: <base> }` first).
- **GREEN** (`70fa430`): same command → `30 passed, 0 failed`.
- Regression sweep: `test:cart` 15/15, `test:two-ways-home` 14/14,
  `test:two-ways-cart` 20/20, `test:group-buy-pricing` 18/18.
- `npx tsc --noEmit`: no errors in touched files (3 pre-existing Prisma-JSON
  errors in unrelated one-off scripts, untouched).

## Known gaps

- No E2E/screenshot pass this round; the shared pure helper is the single
  source for both card surfaces, and its unit suite covers the rule.
- Suppression keys on exact price equality — a seller who genuinely offers a
  differently-composed option at exactly the base price should name the base
  offering as its own variation.
