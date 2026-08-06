# TDD evidence — the Featured row becomes an editable sort entry

**Date:** 2026-08-06
**Branch:** `feat/gb-pricing-tab`
**Source plan:** none. Journeys were derived during this TDD run from the user's
request: *"i want the sort to be editable just like the categories"*.

## Problem

Every row of the catalog sort menu was owner-editable except the first one.
`Sort: Featured` was hardcoded in `Catalog.tsx` as an unnamed
`<option value="">` sitting outside `branding.config.sortCategories`, so it
alone could not be renamed, reordered, hidden or deleted. A half-wired
`Brand.catalogSortLabel` field existed in `types.ts` but had no editor and no
save action anywhere, so the fallback string always won.

## User journeys

1. As a store owner, I want to rename the Featured row, so the menu uses my
   wording ("Our Picks") instead of the platform's.
2. As a store owner, I want to reorder or delete the Featured row, so the
   catalog rests on whichever arrangement I choose.
3. As a store owner, I want to re-add Featured after deleting it, so a mistake
   is recoverable.
4. As a shopper, I want the menu to keep working no matter how the owner has
   configured it, and I never want a sort to hide products from me.

## Migration risk

A read-only probe over all `Branding` rows found **0 of 14 brands** with a saved
`sortCategories` list — every store is still on the seed. Changing the seed
therefore reinterprets no stored data. No schema change, no `db:push`: the menu
lives in `branding.config` JSON.

## RED → GREEN

**RED** — `npm run test:sort-categories`, 13 new assertions added before any
production edit:

```
54 checks, 6 failure(s)
  ✗ a stored featured row survives normalization (the kind is recognised)
      expected [{"id":"featured",…,"kind":"featured"}], got [name, price-asc, price-desc]
  ✗ the classic seed LEADS with Featured, preserving today's resting menu
  ✗ the simple seed also leads with Featured
  ✗ picking Featured = featured pinned above the owner's category blocks
      expected ["d","c","b","a"], got ["a","b","c","d"]
  ✗ …which is Delta+Charlie (featured) then Bravo (Healing) then Alpha (tail)
  ✗ a renamed Featured row keeps its behavior, only its wording changes
```

Failures are caused by the missing `featured` kind — normalization drops the
unknown kind, the seeds lack the row, and `sortByCategory` finds no match and
degrades to name order. Not a syntax, setup or dependency failure.

**Implementation** — `featured` added as a built-in kind; seeded first in both
the classic and simple menus; `sortByCategory` maps it to
`pinFeatured(orderCatalogByCategories(...))`; `Catalog.tsx` drops the hardcoded
option and rests on the first enabled row; the admin palette gains `+ Featured`;
dead `Brand.catalogSortLabel` removed.

**GREEN** — `npm run test:sort-categories` → `54 checks, 0 failure(s)`.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A stored `featured` row survives normalization | `test-sort-categories.ts` "a stored featured row survives normalization" | unit | PASS |
| 2 | Both seeds lead with Featured, so no live menu changes on deploy | "the classic seed LEADS with Featured" / "the simple seed also leads with Featured" | unit | PASS |
| 3 | Picking Featured reproduces the old resting view exactly | "picking Featured = featured pinned above the owner's category blocks" | unit | PASS |
| 4 | Featured is never assignable to a product (a behavior, not a bucket) | "Featured is never assignable on the product form" | unit | PASS |
| 5 | Renaming Featured changes wording only, never behavior | "a renamed Featured row keeps its behavior" | unit | PASS |
| 6 | Deleting Featured leaves a usable menu and hides no products | "deleting Featured leaves a usable menu" / "deleting Featured hides no products" | unit | PASS |
| 7 | Disabling Featured removes it from the dropdown only | "a disabled Featured row leaves the dropdown" | unit | PASS |
| 8 | Sorting never mutates the catalog | "sorting by Featured does not mutate the catalog" | unit | PASS |
| 9 | The legacy sort surface is unregressed | `npm run test:catalog-sort` → 20 checks | unit | PASS |
| 10 | Whole project typechecks | `npx tsc --noEmit` → exit 0 | static | PASS |

## E2E — live browser against the Luminara storefront

Driven with chrome-devtools MCP against `http://luminara.lvh.me:3100/`
(Next.js dev server, real DB). Assertions read the rendered DOM; sort changes
dispatch a real `change` event through the React handler.

| # | Journey | Observed | Result |
|---|---|---|---|
| E1 | Menu renders the owner's list | 4 options: `featured`, `name`, `price-asc`, `price-desc`; `featured` selected by default | PASS |
| E2 | Featured view pins featured products | 6 featured products at indices 0–5, remainder alphabetical | PASS |
| E3 | Name sort is a true name sort | strict A→Z; featured scattered to 3,4,5,12,13,17 — deliberately not pinned | PASS |
| E4 | Price sorts reorder the shelf | `price-asc` and `price-desc` both reorder; featured not pinned | PASS |
| E5 | Returning to Featured is idempotent | identical order to E2 | PASS |
| E6 | Sorting never hides stock | product count stayed 19 across all five views | PASS |
| E7 | Filter narrows | "Weight Management" → 19 → 4 products | PASS |
| E8 | Filter + sort combine (two controls) | within the 4, name vs price orders differ but the set is identical | PASS |
| E9 | Filter survives a sort change | still 4 products after switching to Featured | PASS |
| E10 | Filter resets | "All Products" → back to 19 | PASS |
| E11 | No runtime errors | console error/warn/assert list empty | PASS |

## Coverage and known gaps

There is no `test:coverage` script in this project; the suites are
self-contained `tsx` gates, so no coverage percentage is quoted here rather
than inventing one. `src/lib/storefront/sort-categories.ts` has every exported
function exercised by `npm run test:sort-categories`.

Untested, stated plainly:

- **The admin editor was not exercised end-to-end.** `AdminSortCategories.tsx`
  (rename / reorder / delete / re-add) sits behind the store-admin
  email+password gate and no credentials were available in this session. Its
  behavior is covered at the module level via `normalizeSortCategories` and
  `saveSortCategoriesAction`'s server-side re-normalization, but the click path
  itself is unverified.
- **Price-sort ordering was verified as "order changed", not "prices ascend".**
  Most Luminara products use the variation price reveal and render
  "Select an option" instead of a number, so a numeric assertion on the
  rendered price would have been meaningless. Numeric price ordering is covered
  by the unit suite instead.
- **Priority ranking (1-2-3) is not implemented.** Design was agreed
  (open-ended rank in `metadata.priority`, applied on Featured and category
  views only) but no code was written.
