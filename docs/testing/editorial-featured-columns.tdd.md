# Editorial featured band — operator-set columns per row

**Source plan:** none. Journey derived during this TDD run from the request:
"in the new layout the products in the featured list in homepage i want you to
allow super admin to edit whether its 2 or 3 per row" (reported against the
Glowform Lab storefront, `homeLayout: "editorial"`).

## User journey

> As a super admin styling a tenant's editorial storefront, I want to choose
> whether the homepage Featured band lays out **2 or 3** products per row, so the
> band matches the store's photography and SKU count instead of reflowing on
> whatever card width the viewport happens to allow.

## Task report

| Task | Summary |
|---|---|
| Store the choice | `branding.config.editorial.editColumns` — a new config slice mirroring `boutique`, normalized by `normalizeEditorialConfig` on save and at render. |
| Apply it | `EditorialEdit` hands the count to the grid as `--ed-edit-cols`; `editorial.css` reads `repeat(var(--ed-edit-cols, 3), minmax(0, 1fr))`. |
| Offer it | `BoutiqueEditor` (mounted only inside the operator console's `BrandingEditor` → Storefront tab) grows a "Featured per row" select, shown only when `offersEditColumns(layout)`. |
| Keep it honest | Option labels, the layout gate and the config writer live in `editorial-home.ts`, so the picker and the store cannot drift. |

**Validation command:** `npm run test:editorial-home`

```
RED  (after the reproducer, before any production edit):  42 passed, 13 failed
GREEN (after implementation):                             55 passed,  0 failed
```

RED excerpt:

```
editorial — the featured band's columns
  ✗ an unset column count is three … normalizeEditColumns is not a function
  ✗ the band renders the chosen count onto the grid — the grid does not carry the chosen column count
  ✗ the stylesheet takes the count from the variable and falls back to three
  ✗ the count collapses on small screens rather than crushing the cards
  ✗ the tweak panel drives the shared helpers rather than its own labels
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | An unset count renders 3 — every tenant that predates the control is unchanged | `test-editorial-home.ts:an unset column count is three` | unit | PASS |
| 2 | Both offered counts (2, 3) survive normalization | `…:both offered counts survive` | unit | PASS |
| 3 | Junk config (`0`, `4`, `2.5`, `"3"`, `NaN`, `{}`, …) falls back to 3 rather than emitting `repeat(NaN, …)` and dropping the band | `…:config drift falls back to the default` | unit | PASS |
| 4 | The config slice normalizes, drops unknown keys and never mutates the stored object | `…:the editorial config slice normalizes and never mutates its input` | unit | PASS |
| 5 | A missing/malformed slice still yields a complete config, so no render path repeats the fallback | `…:a missing or malformed editorial slice` | unit | PASS |
| 6 | `EditorialEdit` puts the chosen count on the grid element as `--ed-edit-cols` | `…:the band renders the chosen count onto the grid` | component | PASS |
| 7 | The sheet reads that variable with a `3` fallback | `…:the stylesheet takes the count from the variable` | css | PASS |
| 8 | A `max-width` block re-lays the band, so 3 cards never crush on a phone | `…:the count collapses on small screens` | css | PASS |
| 9 | The control is offered on `editorial` only — never on classic/boutique/two-ways, where there is no band | `…:the control is offered on the editorial layout only` | unit | PASS |
| 10 | Every picker option round-trips to a stored count | `…:the picker's options round-trip to a stored count` | unit | PASS |
| 11 | An unrecognised option (MCP/hand-edited config) leaves the stored count alone instead of blanking it | `…:an unrecognised pick leaves the stored count alone` | unit | PASS |
| 12 | Picking a count returns a new config; the old one is untouched | `…:picking a count never mutates the config it was handed` | unit | PASS |
| 13 | The tweak panel drives the shared helpers rather than its own literals | `…:the tweak panel drives the shared helpers` | source | PASS |

## Regression evidence

```
npx tsc --noEmit                 → exit 0
npm run test:editorial-home      → 55 passed, 0 failed
npm run test:boutique-home       → 42 passed, 0 failed
npm run test:two-ways-home       → 37 passed, 0 failed
npm run test:hero-flush          → 22 passed, 0 failed
npm run test:catalog-sort        → 20 checks, 0 failure(s)
npm run test:themes              → PASS — 0 critical violation(s)
```

## Known gaps

- **Responsive rendering is asserted at the stylesheet, not in a browser.** These
  suites are pure (no DOM). The 999px/599px collapse is verified as CSS text; a
  visual check at 375/768/1440 is still worth doing on a real tenant.
- **The cap is unchanged at `EDIT_MAX = 4`.** With 3 columns a store that
  features 4 products gets a 3 + 1 row. Deliberately out of scope — the request
  was the column count, and the old auto-fit grid already produced partial rows
  at most widths. Changing the cap would move merchandising for tenants who
  never asked.
- **The MCP connector cannot set this yet.** `buildTenantBrandingUpdate`'s
  allow-list covers flat layout keys; nested slices (`boutique`, and now
  `editorial`) are not patchable through the connector. `setEditColumns` already
  fails closed on an unknown option in anticipation.

## Merge evidence

Checkpoints on `main`, in order:

- `53ad84a` — test: reproducer, RED validated (42 passed / 13 failed)
- `c2dd263` — feat: implementation, GREEN validated (55 passed / 0 failed)

No separate refactor commit: the shared-helper extraction (`EDIT_COLUMNS_OPTIONS`,
`editColumnsOption`, `setEditColumns`, `offersEditColumns`) was driven by tests 9–13
and landed inside the GREEN commit.
