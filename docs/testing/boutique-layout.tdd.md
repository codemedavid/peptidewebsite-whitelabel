# TDD evidence — boutique storefront layout

**Source plan:** the inline plan in the `/ecc:plan` session of 2026-08-18 (no
`.plan.md` artifact was written). Journeys below were derived from that plan and
from the user's mid-implementation correction.

**Command:** `npm run test:boutique-home` → `scripts/test-boutique-home.ts`
**Commits:** `3fe3b45` (RED) → `8228baa` (GREEN) → `07363af` (composition fix)

## User journeys

1. As a **store owner**, I want to switch my storefront to an imagery-led,
   category-first layout myself, without asking the platform operator to grant
   anything.
2. As a **shopper**, I want the home to show me the shelves — with real product
   counts and real photos — and take me to the grid once I have chosen.
3. As a **store owner with a bare store** (no categories, no photos, no
   assurances), I want the layout to degrade to something coherent rather than
   render empty furniture.
4. As a **store owner**, I want the assurance strip to say what *I* promise —
   nothing is written for me.
5. As an **existing classic / two-ways tenant**, I want my storefront to be
   byte-identical after this ships.
6. As the **platform**, the layout must be reusable across tenants, brands and
   industries: no business name, logo, colour, product, category, hero image,
   contact detail, nav label or footer baked in.

## Task report

### Task 1 — the view-model (`src/lib/storefront/boutique-home.ts`)

Built `buildCategoryTiles`, `normalizeAssurances`, `normalizeBoutiqueConfig` and
`boutiqueSections` as a pure, JSON-safe module.

RED (`3fe3b45`):

```
$ npm run test:boutique-home
Error: Cannot find module '../src/lib/storefront/boutique-home'
```

GREEN (`8228baa`, extended in `07363af`):

```
$ npm run test:boutique-home
42 passed, 0 failed
```

**Guaranteed:** tile counts come from the tenant's own catalog and match the
grid; the synthetic `all` tab and empty categories never become tiles; the photo
falls back product → brand default → null (never a stock placeholder); inputs are
never mutated; malformed config rows are skipped, not thrown on; the assurance
strip is empty unless the owner typed something, and is bounded in both length
and item count.

### Task 2 — layout resolution (`resolveHomeLayout`)

Widened to a three-way union, checking `boutique` **first** so it needs no
entitlement while `two-ways` keeps its `FEATURES.GB_TWO_WAYS_HOME` grant.

**Guaranteed:** the full 8-row truth table, including that an ungranted
`two-ways` still collapses to `classic` and that an unrecognised value falls
through to the pre-boutique answer.

### Task 3 — config persistence (`branding-update.ts`)

`homeLayout` added to `LAYOUT_ENUMS`, spreading `HOME_LAYOUTS` so the allow-list
cannot drift from the type.

The first version of this test grepped the source line for string literals. That
was testing the implementation, not the behaviour, and it failed the moment the
allow-list was written as a spread — the *better* implementation. Replaced with a
behavioural test that drives `buildTenantBrandingUpdate` and asserts each layout
survives a patch round-trip.

**Guaranteed:** every `HOME_LAYOUTS` value can be saved; unknown and non-string
values are rejected rather than written through.

### Task 4 — stylesheet isolation (`src/storefront/boutique.css`)

A separate sheet, every rule scoped to `.sf-root[data-sf-home="boutique"]`.

This is a direct response to the flush-image-hero bug (`f7c1b2b`), where a later
same-specificity block in `storefront.css` silently re-declared padding the
earlier rule had removed. Two classes + an attribute outrank the base sheet's
`.sf-root .x` selectors, so the outcome no longer depends on stylesheet order.

**Guaranteed:** the test parses the sheet and fails on any selector missing the
scope (it would leak onto every tenant), and on any colour literal (`#hex`,
`rgb()`, `hsl()`) — a literal here would bake one tenant's palette into a shared
template.

### Task 5 — page composition (the user's correction)

The first implementation put the product grid on the home. That is not what the
reference storefront does. Corrected in `07363af`: the composition moved out of
JSX into `boutiqueSections()` so it is pinned by a test.

RED:

```
$ npm run test:boutique-home
  ✗ the catalog view leads with the category chips — 'catalog' == 'chips'
41 passed, 1 failed
```

GREEN: `42 passed, 0 failed`.

**Guaranteed:** the home never contains `catalog`; the home order is
hero → tiles → shop-all → assurances → contact; the catalog view leads with the
chips and does not repeat the home's discovery furniture; both views end on the
contact strip.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Boutique is owner-selectable — no operator grant | `boutique is owner-selectable — no entitlement needed` | unit | PASS |
| 2 | Two-ways still requires its grant; unknown values fail closed | `two-ways still requires the operator grant`, `an unknown/garbage value fails closed…` | unit | PASS |
| 3 | Tile counts match the grid they open | `counts the products actually in each category` | unit | PASS |
| 4 | No tile ever opens an empty shelf | `drops categories with no products…` | unit | PASS |
| 5 | Photo fallback chain product → brand default → null | 3 × `falls back…` | unit | PASS |
| 6 | An empty catalog or no categories hides the section | `an empty catalog yields no tiles…`, `no categories yields no tiles` | unit | PASS |
| 7 | Malformed config never throws | `tolerates malformed category rows…`, `ignores non-object rows` | unit | PASS |
| 8 | Nothing is invented for the assurance strip | `absent / non-array config yields no assurances…` | unit | PASS |
| 9 | The strip stays bounded | `caps the strip…`, `truncates over-long copy…` | unit | PASS |
| 10 | The home never lists products | `the home never renders the product grid` | unit | PASS |
| 11 | The catalog screen keeps the shopper oriented | `the catalog view leads with the category chips` | unit | PASS |
| 12 | Boutique CSS cannot leak onto other tenants | `every rule is scoped to [data-sf-home='boutique']` | static | PASS |
| 13 | The template bakes in no palette | `declares no literal brand colours — tokens only` | static | PASS |
| 14 | An owner's layout choice is actually saved | `every HOME_LAYOUTS value survives a branding patch` | integration | PASS |

## Regression

```
test:two-ways-home    37 passed, 0 failed
test:two-ways         18 passed, 0 failed
test:two-ways-mode    PASS — per-way two-ways management verified
test:catalog-sort     20 checks, 0 failure(s)
test:tenant-presets   65 passed, 0 failed
test:hero-flush       22 passed, 0 failed
test:banner           35 passed, 0 failed
npx tsc --noEmit      clean
```

## Browser verification

Run against a **throwaway route with synthetic brand + product data**, not a real
store: this repo's dev server points at the production database, so no live
tenant's `homeLayout` was flipped. The route was deleted after verification.

Confirmed at 1440px, 500px and 320px:

- home renders hero → tiles → shop-all → assurances → contact, with **no** grid;
- 5 tiles from 6 categories — the one with no products was correctly dropped;
- tile → `#catalog` filters to that shelf, the active chip matches the tile, and
  `2 Products` agrees with the 2 rendered cards;
- the contact strip appears only once channels are enabled;
- phone rules engage (`flex-wrap: wrap` on the bar, tile overlap dropped) with no
  horizontal overflow at any width.

## Known gaps

- **No automated visual regression.** The layout is verified by the screenshots
  described above, not by a stored baseline. This repo has no Playwright
  screenshot harness; adding one is out of scope here.
- **Component rendering is untested in isolation.** There is no component test
  runner in this repo; the section composition is covered through the pure
  `boutiqueSections` contract instead, which is what the components branch on.
- **Coverage percentage not measured.** There is no `test:coverage` script — the
  suite is a set of standalone `tsx` gates, per this project's existing
  convention.
- **Preset interaction.** `KGLOW_TWO_WAYS.off` stamps `homeLayout: "classic"`.
  Removing that preset from a tenant that has since switched to boutique would
  reset them to classic. Not reachable today (no tenant has both), but it should
  be guarded before the preset is applied more widely.
