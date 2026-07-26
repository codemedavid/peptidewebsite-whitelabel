# Product-add gates — TDD evidence

**Source plan:** none. Journeys were derived during this TDD run from an incident
investigation: *"analyze why tenant kglow couldn't add product"* (2026-07-26).

## Incident: why K Glow could not add a product

Tenant slug is **`k-glow`** (not `kglow`), plan **Enterprise**, status active. No
entitlement gate was involved — `branding.config.trialDowngrade` is `null`, so the
10-product Starter cap (`starter-downgrade.ts`) never applied.

**Root cause: the tenant had zero *selectable* categories, and Category is
required on both the client and the server.**

Read-only DB timeline (queried via a throwaway script against `DIRECT_URL`):

| When (UTC) | What |
|---|---|
| 2026-07-21 03:10 | Tenant created |
| 2026-07-23 03:59:05–15 | 25 products written by seed script (sub-second burst), **no category** |
| 2026-07-24 06:11:53–55 | 6 on-hand products seeded, **no category** |
| **2026-07-26 06:32:26** | **First category ever created** (`cat1785047546396_q617v` → "pep") |
| 2026-07-26 06:35:02 | **First product ever saved through the admin UI** (`TIRZEPATIDE-30MG`) — 2.5 min later |
| 2026-07-26 07:27:11–16 | Three more categories, all labelled "New Category" (repeated clicks) |
| 2026-07-26 07:40:30 | Second UI product (`TIRZEPATIDE-15MG`) |

Category ids are millisecond timestamps, so they date themselves. Category
histogram across all 33 products: `cat1785047546396_q617v: 2`, `(none): 31` — every
pre-existing product came from a script that writes `metadata` directly.

**Mechanism.** `AdminCategoriesManager` lets the owner delete *every* category, and
its `persist` always re-stamps the synthetic "all" tab:

```ts
const persist = (next: Category[]) =>
  setCategories([{ id: "all", label: "All Products" }, ...next]);
```

So the saved value becomes exactly `[{id:"all"}]`. Being **non-null**, it defeats
the fallback in `store.tsx:227` (`brandSeed.categories ?? SEED_CATEGORIES` — `??`
only catches null/undefined). `AdminAddProduct` then computed
`selectableCats = categories.filter(c => c.id !== "all")` → length 0, so:

- `canSave` (`AdminAddProduct.tsx:267`) requires `category`, which stayed `""` →
  **the Save button was permanently disabled and clicking it did nothing**
  (`save()` early-returns at line 311).
- `saveProductAction` would also have rejected it: `if (!p.category) return { error: "Please choose a category." }`.

The store sat with a 31-product catalog and a dead Save button for five days. The
owner self-resolved it at 06:32 by finding the Categories manager; the four stray
"New Category" rows are the fumbling.

### Second defect found during the investigation

`saveProductAction` silently discarded the editor's **"Order ratio class"**.
`normalizeProductInput` built an explicit object literal with no `productClass`
key, so by the time `productToDbWrite` read `p.productClass`
(`product-mapping.ts:286`) it was always `undefined`. Consequences, both live for
k-glow (which runs `groupBuyRules.ratio.mode: "strict"`):

- the dropdown was a no-op — a class set in the UI was never persisted;
- **editing a seeded product wiped its existing class** (`AOD9604-OH: "peptide"`,
  `5AMINO1MQ-OH: "other"`), falling Order Ratio Control back to the name regex.

## User journeys

1. As a store owner whose catalog was seeded by script, I want to add a product
   through the admin, so that I can extend my catalog without running scripts.
2. As a store owner who deleted the demo categories that didn't fit my store, I
   want Add Product to still work, so that tidying categories can't brick it.
3. As a store owner running Order Ratio Control, I want the "Order ratio class" I
   pick to persist, so that the peptide↔bac-water floor uses my classification.
4. As a store owner editing an already-classified product, I want its class kept,
   so that a routine price edit doesn't silently re-classify it.

## Task report

### Task 1 — Category can never be a dead end

Added `src/lib/storefront/categories.ts` (`resolveSelectableCategories`,
`UNCATEGORIZED_CATEGORY`, `ALL_CATEGORY_ID`): strips the synthetic "all" tab and
returns a single `Uncategorized` fallback when the tenant has no real categories.
Wired into `AdminAddProduct.tsx` for both the initial `category` state and
`selectableCats`. The now-unreachable "No categories yet" `<option>` and hint were
removed.

- **RED** (`npm run test:product-add-gates`, before `categories.ts` existed) —
  compile-time RED, the module the test targets did not exist:

  ```
  Error: Cannot find module '../src/lib/storefront/categories'
  code: 'MODULE_NOT_FOUND'
  ```

- **GREEN** — 6/6 category assertions pass (see the table below).

### Task 2 — `productClass` survives the save pipeline

`normalizeProductInput` was first **moved verbatim** out of the `"use server"`
module `src/actions/products.ts` into the new pure module
`src/lib/storefront/product-input.ts` (a `"use server"` file may only export async
functions, so the normalizer could not be unit-tested in place). That move was
behavior-preserving and is *not* the fix. Only then was the test run, and only
after it went RED was `productClass: toProductClass(o.productClass)` added.

- **RED** (`npm run test:product-add-gates`, after `categories.ts`, before the
  fix) — genuine runtime failure caused by the intended bug:

  ```
  normalizeProductInput — the editor's Order ratio class must survive
    ✗ productClass 'peptide' survives normalization — undefined == 'peptide'
    ✗ productClass 'bacWater' survives normalization — undefined == 'bacWater'
    ✗ productClass 'other' survives normalization — undefined == 'other'
    ✓ an unknown productClass is dropped, not passed through raw
    ✓ an absent productClass stays undefined (name heuristic still decides)
    ✗ productClass reaches the DB metadata through the full save pipeline — undefined == 'other'
    ✗ editing a classified product does not wipe its class — undefined == 'peptide'

  8 passed, 5 failed
  ```

- **GREEN** (same command, after the fix): `13 passed, 0 failed`.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | The exact k-glow state (`[{id:"all"}]`) still yields one assignable category | `test-product-add-gates.ts:the k-glow state ([all] only) still yields one assignable category` | unit | PASS |
| 2 | An empty category list yields the `Uncategorized` fallback | `…:a completely empty list yields the fallback` | unit | PASS |
| 3 | An absent/undefined category list yields the fallback | `…:an absent/undefined list yields the fallback` | unit | PASS |
| 4 | The synthetic "all" tab is never assignable to a product | `…:the synthetic 'all' tab is never assignable` | unit | PASS |
| 5 | Real categories are returned untouched, with no fallback injected | `…:real categories are returned untouched, with no fallback injected` | unit | PASS |
| 6 | The fallback id is truthy and survives normalization, so the server accepts it | `…:the fallback id is a real, saveable category id` | unit | PASS |
| 7 | `productClass: "peptide"` survives normalization | `…:productClass 'peptide' survives normalization` | unit | PASS |
| 8 | `productClass: "bacWater"` survives normalization | `…:productClass 'bacWater' survives normalization` | unit | PASS |
| 9 | `productClass: "other"` survives on a peptide-sounding name (the override the heuristic gets wrong) | `…:productClass 'other' survives normalization` | unit | PASS |
| 10 | An unknown `productClass` is dropped, not passed through raw | `…:an unknown productClass is dropped, not passed through raw` | unit | PASS |
| 11 | An absent `productClass` stays undefined so the name heuristic still decides | `…:an absent productClass stays undefined (name heuristic still decides)` | unit | PASS |
| 12 | `productClass` reaches `metadata.productClass` through `normalizeProductInput → productToDbWrite` | `…:productClass reaches the DB metadata through the full save pipeline` | unit | PASS |
| 13 | Re-saving an already-classified product does not wipe its class | `…:editing a classified product does not wipe its class` | unit | PASS |

Evidence command for all rows: `npm run test:product-add-gates` → `13 passed, 0 failed`.

## Regression evidence

`npx tsc --noEmit` → exit 0, no output.

| Suite | Result |
|---|---|
| `npm run test:product-add-gates` | 13 passed, 0 failed |
| `npm run test:gb-ratio` | 19 passed, 0 failed |
| `npm run test:product-variations` | 30 passed, 0 failed |
| `npm run test:variant-inventory` | 33 passed, 0 failed |
| `npm run test:reseller-gate` | 14 passed, 0 failed |
| `npm run test:kglow-onhand` | PASS |
| `npm run test:two-ways-cart` | 20 passed, 0 failed |

`test:reseller-gate` matters specifically: it reads `src/actions/products.ts` as
raw text and asserts on its source, so it confirms the `normalizeProductInput`
extraction did not disturb the reseller-gating call sites.

## Coverage and known gaps

This repo has no coverage instrumentation (`test:*` scripts are standalone `tsx`
assertion runners), so no percentage is reported. Deliberate gaps:

- **No test drives the real browser form.** `canSave` and the `<select>` render are
  asserted only indirectly, through the pure `resolveSelectableCategories` the
  component now uses. A regression that stopped *calling* the resolver would not
  be caught.
- **No backfill was run.** Any k-glow product whose seeded `productClass` was
  already wiped by an admin edit before this fix stays wiped. `TIRZEPATIDE-30MG`
  (updated 2026-07-26 07:41) is the known candidate. The user chose "Yes — TDD fix
  now" over "Fix + backfill", so this is intentionally outstanding.
- **The storefront category chips were not changed.** A product saved under
  `uncategorized` has no chip of its own and shows under "All Products" — the same
  documented orphan behaviour as a product whose category was deleted
  (`AdminCategoriesManager.tsx:57`).
- **`AdminCategoriesManager` still allows deleting every category.** The fallback
  makes that harmless for Add Product, but the manager itself was not changed.

## Merge evidence

RED (compile-time, category module absent) → `MODULE_NOT_FOUND`.
RED (runtime, `productClass` dropped) → `8 passed, 5 failed`.
GREEN → `13 passed, 0 failed`; `tsc --noEmit` exit 0; six related suites green.
No refactor stage beyond the behavior-preserving extraction described in Task 2.
