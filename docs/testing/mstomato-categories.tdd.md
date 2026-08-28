# TDD evidence — mstomato category re-file

**Date:** 2026-08-29
**Tenant:** `mstomato` (trial)
**Commits:** `fa5c107` (RED) → `ee1227f` (GREEN)
**Source plan:** none — journeys derived during this TDD run from a read-only
inspection of the live tenant, plus two clarifying answers from the owner.

## The request, and what was actually wrong

> "can you delete all the existing categories of tenant mstomato and instead
> create vial caps and vial case category and connect the products at its own
> respective categories"

Inspection turned up two separate faults:

1. **`branding.config.categories` was `null`.** `store.tsx:240` reads
   `brandSeed.categories ?? SEED_CATEGORIES`, so a store selling vial caps was
   advertising "Peptides", "Weight Management", "GLP-1 Agonists", "Insulin Pens".
   Nothing had ever been saved — so "delete the existing categories" meant
   *displacing a seed fallback*, not deleting owner data. No destructive delete
   was performed or needed.
2. **Every product's `metadata.category` held a human LABEL** ("Vial Cases",
   "Sample Products") while `Catalog.tsx:986` filters with
   `p.category === category`, where `category` is a category **id**. No chip
   could ever match a product. This is the identical bug
   `scripts/fix-peppies-categories.ts` was written to fix for another tenant.

## Owner decisions (asked before any write)

Seven products are neither a vial cap nor a vial case. Rather than guess:

- **Odd products** → *"Add an Accessories category"* (three categories total).
- **The four "Sample …" items** → *"Keep and categorize them."*

## User journeys

1. As the owner, I want my storefront chips to name what I actually sell.
2. As a shopper, I want clicking "Vial Caps" to show vial caps — today every
   chip shows nothing, because chips and products speak different keys.
3. As the owner, I want every product reachable from some chip, not stranded.
4. As the owner, I want re-running the fix to be safe.

## Task report

### Task 1 — the classifier (pure, tested)

`scripts/lib/mstomato-categories.ts`: `classifyMstomatoProduct`,
`buildMstomatoCategories`, and the three label constants.

RED (`fa5c107`):

```
$ npm run test:mstomato-categories
Error: Cannot find module './lib/mstomato-categories'
```

GREEN (`ee1227f`): `36 passed, 0 failed`.

Guaranteed: the 21-name live roster maps 4/10/7; the phrase match beats a
substring match on the three near-misses; unknown and blank names fall back to a
real shelf; the persisted list leads with the synthetic `all` tab and has unique
ids.

**Why a pure module rather than the peppies-style inline map:**
`fix-peppies-categories.ts` hardcodes `ASSIGNMENTS` inside the migration, so its
mapping can only be checked by clicking chips on the live storefront. Splitting
the rule out is what let the classification be proven before touching the DB.

### Task 2 — the migration

`scripts/fix-mstomato-categories.ts`, mirroring the peppies script's shape
(`--dry`, `withRetry`, `DIRECT_URL`, read-modify-write on metadata).

```
$ npx tsx --env-file=.env scripts/fix-mstomato-categories.ts --dry
Existing saved categories: none (storefront was showing the SEED peptide chips)
  → Hard Cartridge Caps – Pen Cartridge   "Cartridge" ⇒ Accessories
  → Single Vial Case – 3 mL               "Vial Cases" ⇒ Vial Cases
  … 21 rows …
Vial Caps 4 / Vial Cases 10 / Accessories 7
Would update 21 product(s) and would write 3 categories.

$ npx tsx --env-file=.env scripts/fix-mstomato-categories.ts
Updated 21 product(s) and wrote 3 categories.
```

Post-migration verification against the live DB:

```
SAVED CATEGORIES:
  All Products   all
  Vial Caps      cat1787942756855_zh8yi
  Vial Cases     cat1787942756855_pqsg9
  Accessories    cat1787942756855_m2e65
PRODUCTS PER CHIP:  Accessories 7 / Vial Caps 4 / Vial Cases 10
total=21  orphans=0
config keys=74  heroLine1="Simple. Trusted."  defaultProductImage set=true
```

Idempotency — re-running `--dry` reports **21/21 already correct**.

### Task 3 — end-to-end in a browser

After restarting the dev server (see the cache gap below), driving
`mstomato.lvh.me:3100` with Playwright:

```
CHIPS: ["All Products","Vial Caps","Vial Cases","Accessories"]
  All Products     → 17 cards
  Vial Caps        → 4 cards
  Vial Cases       → 10 cards
  Accessories      → 3 cards
```

The seed peptide chips are gone from the HTML (`GLP-1 Agonists` = 0 matches).

**The 17-vs-21 and 3-vs-7 gap is pre-existing, not a regression.** The four
"Sample …" products are `status=draft, active=false`, so the storefront hides
them by design. They *are* filed under Accessories in the DB as the owner asked;
publishing them would make Accessories read 7.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | All 21 live product names map to their intended shelf | `test-mstomato-categories.ts:every live product lands in the right category` | unit | PASS |
| 2 | The roster splits 4 caps / 10 cases / 7 accessories | `…:the roster splits 4 caps / 10 cases / 7 accessories` | unit | PASS |
| 3 | "Hard Cartridge Caps" is not filed under Vial Caps | `…:near-misses that a substring match would get wrong` | unit | PASS |
| 4 | "Vial Topper" / "Cartridge Spacer" are not filed as caps or cases | `…:near-misses…` | unit | PASS |
| 5 | Classification ignores case and whitespace | `…:robustness` | unit | PASS |
| 6 | An unknown or blank name still yields a real shelf, never "" | `…:robustness` | unit | PASS |
| 7 | The persisted list leads with the synthetic `all` tab | `…:buildMstomatoCategories` | unit | PASS |
| 8 | Category ids are unique and none collides with `all` | `…:buildMstomatoCategories` | unit | PASS |
| 9 | Live DB: 21 products, 0 orphans, 4/10/7 | verification script (output above) | integration | PASS |
| 10 | Re-running the migration changes nothing | `fix-mstomato-categories.ts --dry` → 21/21 `=` | integration | PASS |
| 11 | Branding config survives the write | 74 keys, `heroLine1` + `defaultProductImage` intact | integration | PASS |
| 12 | Chips filter to the right products in a browser | Playwright run (output above) | e2e | PASS |

## Honest notes and known gaps

- **Cache staleness is a real operational gap, now surfaced.** The storefront
  reads branding through `unstable_cache` keyed on `lib/tenant/cache-tags.ts`,
  and `revalidateTag` only works inside a Next request — a standalone script
  cannot call it. Immediately after the migration the live page still served the
  OLD chips despite a correct DB; it only updated after a server restart. The
  script now prints this as a required NEXT STEP (save in admin, or redeploy).
  **`fix-peppies-categories.ts` has the same silent gap** and does not say so.
- **The pre-write backup helper failed** (top-level `await` in a CJS-loaded
  `.ts`) and no backup file was produced. The migration had not run yet, and the
  `--dry` output above records every product's before-value, so a rollback is
  fully reconstructible — but the intended safety net did not exist at write
  time. Worth fixing before the next live migration.
- **`npm run typecheck` reports 1 pre-existing error** in
  `scripts/test-mcp-variations.ts` (missing `variation-plan` module) from a
  concurrent session's RED commit `3e588cf`. Not caused by, and not fixed by,
  this work.
- **Not automated:** the classifier's roster is a hand-maintained snapshot of 21
  names. A product renamed or added on the live store will silently land in
  Accessories; the test roster is the thing to update when that happens.
- **Not done:** the four draft "Sample …" products were left unpublished. The
  owner asked to keep and categorize them, not to publish them.
