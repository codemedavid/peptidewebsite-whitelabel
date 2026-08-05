# TDD Evidence — Admin-Managed Sort Categories + Order Confirmation Page

**Date:** 2026-08-05
**Branch:** `feat/gb-pricing-tab`
**Source plan:** produced inline via `/ecc:plan` in this session (no `*.plan.md` artifact was written; the request arrived as free-form text plus a screenshot of the storefront's `Sort: Name` dropdown).

The screenshot is what settled the plan's central ambiguity: "sort categories" means
the **sort dropdown**, not the existing category filter chips. The chips
(`branding.config.categories`, `AdminCategoriesManager`) are untouched.

---

## User journeys

1. As a store owner, I want to create, rename, reorder, enable/disable and delete the
   entries in my shop's Sort menu, so I can offer "Weight Loss" or "Anti-Aging" without
   asking a developer to change code.
2. As a store owner, I want to assign a product to one sort category when I add or edit
   it, so choosing that category brings my products to the front.
3. As a store owner, I want to flag a product as featured so it sits at the very top of
   my catalog.
4. As a shopper, I want the catalog to reflect the owner's arrangement the moment they
   change it.
5. As a customer, I want to review my whole order — reference, contact details, shipping
   address, courier, every line, and the total — before I message the store, instead of
   being thrown straight into WhatsApp.

---

## Task report

### Task 1 — `sort-categories` pure core

Replaced the hardcoded `CLASSIC_OPTIONS` / `SIMPLE_OPTIONS` menus with an
owner-editable list in `branding.config.sortCategories`.

| Stage | Evidence |
|---|---|
| RED | `npm run test:sort-categories` → `Error: Cannot find module '../src/lib/storefront/sort-categories'` … `code: 'MODULE_NOT_FOUND'`. Compile-time RED: the test references the missing implementation. Commit `e34cdda`. |
| GREEN | `npm run test:sort-categories` → `41 checks, 0 failure(s)`. Commit `af3c678`. |

Two assertions failed on the first GREEN run — both were **wrong expectations in the
test**, not defects: the "Weight Loss" fixture members are Beta (`p2`) and Delta (`p4`),
so name order within a group is `p2, p4`; the test had them reversed. Corrected the test
and re-ran to green. No production code was changed to accommodate a test.

Guarantees: `normalizeSortCategories` can never return an empty menu (mirroring
`resolveSelectableCategories` in `categories.ts`); a disabled or deleted group never
hides its products; picking a group sorts rather than filters; `seedSortCategories`
derives each tenant's starting menu from their legacy `catalogSortStyle`.

### Task 2 — Admin → Product Sort Categories

`AdminSortCategories.tsx` plus registration in the four registries a store-admin view
needs (`admin-nav`, `AdminPage`, `staff-permissions`, the `Store` context) and
`saveSortCategoriesAction`, which re-normalizes server-side.

| Check | Result |
|---|---|
| `npx tsc --noEmit --pretty false` | clean (no output) |
| `npm run test:admin-dashboard` | `56 passed, 0 failed` |
| `npm run test:staff` | `PASS — 51 passed, 0 failed` |

Commit `7a466f7`. These two suites are the registry gates: they fail if a nav entry is
not a gated module or a view escapes the permission registry.

### Task 3 + 4 — product field, feature tag, catalog wiring

Optional **Sort Category** select on the product form (same orphan rule as Category, so a
deleted group never silently refiles a product); `metadata.sortCategory` persistence;
`createdAt` mapped through for "New Arrivals"; the Featured checkbox relabelled
"Featured — pin to top"; the catalog builds its dropdown from the owner's list and orders
by it.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds |
| `npm run test:sort-categories` | `41 checks, 0 failure(s)` |
| `npm run test:catalog-sort` | `20 checks, 0 failure(s)` — regression anchor |

Commit `70a389a`. `grep -rn "sortCatalogProducts\|catalogSortOptions"` over `src/`
confirms **no storefront code reads the hardcoded menu any more**; `catalogSortStyle`
survives only as the seed for tenants who have not opened the new screen.

### Task 5 — Order Confirmed review page

| Stage | Evidence |
|---|---|
| RED | `npm run test:order-confirmation` → `Error: Cannot find module '../src/lib/storefront/order-confirmation'` … `MODULE_NOT_FOUND`. Commit `c611755`. |
| GREEN | `npm run test:order-confirmation` → `34 checks, 0 failure(s)`. Commit `806b041`. |

Page, route and checkout reroute in commit `b48b5ac`.

---

## Test specification

| # | What is guaranteed | Test file / command | Type | Result |
|---|---|---|---|---|
| 1 | Broken or absent sort config still yields a usable menu | `scripts/test-sort-categories.ts` "a list of nothing BUT garbage → default menu" | unit | PASS |
| 2 | An owner cannot disable their way into an empty dropdown | same: "a list with every entry disabled still yields a usable menu" | unit | PASS |
| 3 | Duplicate ids are dropped, first wins; unknown kinds rejected | same: "garbage rows dropped, first duplicate id wins" | unit | PASS |
| 4 | Every live store's menu is unchanged on deploy day | same: `seedSortCategories` block (classic / simple / unset) | unit | PASS |
| 5 | Picking a group sorts, never filters — the catalog stays whole | same: "the whole catalog is still present (sort, not filter)" | unit | PASS |
| 6 | A disabled or deleted group never hides products | same: "a disabled group never hides products" | unit | PASS |
| 7 | Reordering the admin list reorders the storefront | same: "moving Healing to the top moves its products to the top" | unit | PASS |
| 8 | Featured pins to the top, stably, without mutating input | same: `pinFeatured` block | unit | PASS |
| 9 | A stale saved sort degrades to name order, never a blank shelf | same: "an unknown category id degrades to name order" | unit | PASS |
| 10 | The confirmation screen shows the server-assigned reference | `scripts/test-order-confirmation.ts` "shows the server-assigned order number" | unit | PASS |
| 11 | Address renders as one clean line, blank parts skipped | same: "blank address parts are skipped, not left as empty commas" | unit | PASS |
| 12 | Purity is joined from the catalog by productId | same: "purity is joined from the catalog" | unit | PASS |
| 13 | A deleted product still lists on the order, just without purity | same: "a line whose product was since deleted still lists" | unit | PASS |
| 14 | Total = subtotal − discount + shipping + fee | same: "grand total = subtotal − discount + shipping + fee" | unit | PASS |
| 15 | An over-large discount floors the total at zero, as in the chat message | same: "a discount bigger than the cart floors the total at zero" | unit | PASS |
| 16 | Missing contact fields render as a dash, never "undefined" | same: "a missing field renders as a dash" | unit | PASS |
| 17 | A new admin view cannot escape the nav/permission registries | `npm run test:admin-dashboard`, `npm run test:staff` | integration | PASS |
| 18 | The existing checkout hand-off is unbroken | `test:cart`, `test:checkout-names`, `test:two-ways-cart`, `test:gb-cart-doses` | integration | PASS |

Full suite run at completion:

```
sort-categories        41 checks, 0 failure(s)
order-confirmation     34 checks, 0 failure(s)
catalog-sort           20 checks, 0 failure(s)
cart                   15 passed, 0 failed
checkout-names         10 passed, 0 failed
order-detail           17 passed, 0 failed
two-ways-cart          20 passed, 0 failed
gb-cart-doses          22 passed, 0 failed
```

Plus `npx tsc --noEmit` clean and `npm run build` succeeding.

---

## Coverage and known gaps

The project has no global coverage instrument; its convention is per-feature pure test
gates under `scripts/`, and both new modules are covered that way end to end. Deliberate
gaps, none of them silent:

- **No automated UI test** for `AdminSortCategories` or `OrderConfirmedPage`. Both are
  React surfaces over fully covered pure cores; the repo has no component-test harness.
  Manual checks worth doing: drag-reorder persists; the review page survives a reload;
  each channel button opens the right app.
- **`branding.config` revalidation was not re-verified end to end.**
  `saveSortCategoriesAction` calls `revalidateTenant` exactly as `saveCategoriesAction`
  does, so it inherits a proven path, but the "storefront updates automatically"
  criterion was confirmed by code inspection rather than a live run.
- **`featured` semantics changed** — it now pins as well as badges. A tenant with many
  featured products will see a different catalog order. Intentional and flagged in the UI
  copy, but it is a visible behavior change for existing stores.
- **No migration needed or run.** Both features live in JSON columns
  (`branding.config.sortCategories`, `products.metadata.sortCategory`), so no `db:push`
  is pending.

## Merge evidence

Checkpoint commits on `feat/gb-pricing-tab`, oldest first:

| Commit | Stage |
|---|---|
| `e34cdda` | RED — sort categories reproducer |
| `af3c678` | GREEN — sort-categories core, 41 checks |
| `7a466f7` | Admin screen + registries; tsc, admin-dashboard, staff green |
| `70a389a` | Product field + catalog wiring; tsc + build green |
| `c611755` | RED — order confirmation reproducer |
| `806b041` | GREEN — order-confirmation view-model, 34 checks |
| `b48b5ac` | Confirmation page, route, checkout reroute; full suite green |

If these are squashed, this table and the suite output above are the surviving record of
what was verified and how.
