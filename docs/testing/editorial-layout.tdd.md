# Editorial storefront layout — TDD evidence

**Reference design:** `SKN Storefront.dc.html` (Claude Design project
`802c4693-e63c-4f22-a101-aac2df434874`), imported via the `claude_design` MCP.
**Source plan:** none — journeys were derived during this TDD run from the
imported design plus the standing white-label constraint the user set when the
boutique layout was built ("must be a reusable layout template … do NOT
hardcode business name, logo, colors, products, categories, hero image, contact
details, navigation labels, footer").

**Commits (branch `main`, in order):**

| Stage | Commit | What it proves |
|---|---|---|
| RED | `043d898` | reproducer added; failed to resolve the unwritten modules |
| GREEN | `92c3d6e` | layout implemented; 36/0 plus a clean regression sweep |
| RED→GREEN | `b2f6289` | browser-found token bug reproduced by a new check, then fixed |

## What the layout is

A fourth `homeLayout` beside `classic` / `two-ways` / `boutique`. Two things
distinguish it from the boutique layout, both taken from the reference design:

- **chrome** — a persistent left rail (268px) replaces the top header, and
  collapses to a compact bar plus off-canvas drawer below 1000px;
- **discovery** — the tenant's categories are set as a typographic *index*
  (one full-width line each, display type + live count, hairline-ruled) rather
  than a grid of photographic tiles. An index scales to many shelves and to a
  catalog whose products are not all photographed.

Composition, pinned in `editorialSections()` rather than in JSX:

- home → `hero, index, edit, assurances, contact` — **no product grid**
- `#catalog` → `chips, catalog, contact`

## User journeys

1. As a store owner, I want to switch my storefront to the editorial layout
   myself, so that I do not have to buy a module or ask the operator.
2. As a store owner, I want the layout to use my own categories, products,
   photos, palette and nav, so that it does not look like someone else's shop.
3. As a shopper, I want the home page to help me choose a shelf, so that I am
   not dropped into an undifferentiated grid.
4. As a shopper arriving at the grid from an index row, I want to see which
   shelf I am on and get back to the others.
5. As an operator, I want a tenant who did not choose this layout to be
   completely unaffected by it.

## Task report

### 1. The layout enum grows a fourth value

`HOME_LAYOUTS` and `isBoutiqueLayout` lived in `boutique-home.ts`. With four
layouts the boutique module is the wrong owner, so both moved to
`src/lib/storefront/home-layout.ts` alongside the new `isEditorialLayout`. Four
importers updated. This is a move, not a duplicate — no definition exists twice.

- Validation: `npm run test:editorial-home`, `npm run test:boutique-home`
- Guarantee: the enum lists exactly the four layouts; the two owner-selectable
  predicates never both claim one value; anything outside the list is rejected
  by the `branding.config` allow-list.

`test-boutique-home.ts` had pinned the enum at exactly three values. That
assertion now belongs to the editorial test, so the boutique test was narrowed
to what the *boutique* layout actually depends on (`includes("boutique")`,
`[0] === "classic"`) — a fifth layout can no longer fail a boutique test that
has nothing to say about it.

### 2. Owner-selectable, without opening the two-ways module

`resolveHomeLayout` gains one branch, checked *before* the entitlement.

- Validation: `npm run test:editorial-home`, `npm run test:two-ways-home`
- Guarantee: `resolveHomeLayout(false, "editorial") === "editorial"` — no grant
  needed; and `resolveHomeLayout(false, "two-ways") === "classic"` still holds,
  so the new branch is not a back door into the sold module. Unknown values
  still fail closed to `classic`.

### 3. Composition — the home carries no product grid

The section list is data (`editorialSections`), not JSX, so it can be asserted.

- Guarantee: `editorialSections("home")` contains neither `catalog` nor
  `chips`; the catalog view leads with `chips` so an arrival from an index row
  can see its filter and reach the rest of the catalog (journey 4); callers get
  a fresh array they cannot use to corrupt the next answer.

### 4. Everything on the page is the tenant's own

- `buildCategoryIndex` — labels and counts derived from the tenant's catalog;
  the synthetic `all` tab is never a row; a category with zero products is
  dropped; the owner's category order is preserved; a category saved without a
  label falls back to its id; malformed config rows are skipped, not thrown on;
  inputs are never mutated.
- `buildEditRow` — the owner's own `featured` flag, capped at `EDIT_MAX`. A
  store that featured nothing gets an **empty** row, so the band is not
  rendered at all rather than promoting a selection this template chose. A
  nonsense cap falls back to the default instead of emptying the band.
- The notices strip reuses the boutique layout's assurance lines
  (`branding.config.boutique.assurances`), so an owner who typed them once
  keeps them across a layout switch. Ships empty.

### 5. One nav, two surfaces

The rail is a second nav surface. The header's auto-surfacing rules (Group Buy
first, Resellers when opted in, Calculator before Reviews, drop links to
toggled-off pages) were inline in `Header.tsx`; a copy in the rail could only
drift. Extracted to `buildStorefrontNav`.

- Guarantee: toggled-off pages are dropped; each auto-link appears only when
  available and is never duplicated when the owner already linked it; the
  brand's stored nav array is never mutated.
- `test-two-ways-home.ts` grepped `Header.tsx` for
  `isPageVisible(brand, "groupbuy")`. The rule moved, not changed, so the check
  was retargeted at `nav.ts` **and** strengthened to assert the header keeps no
  copy of the rule.

### 6. The stylesheet cannot leak, and cannot paint nothing

`src/storefront/editorial.css` is its own sheet, every rule scoped to
`.sf-root[data-sf-home="editorial"]` — which outranks `storefront.css`'s
`.sf-root .x` selectors, so source order cannot silently undo it (the hazard
that broke the flush image hero, `f7c1b2b`).

- Guarantee: a CSS parser in the test walks every rule and fails on any
  unscoped selector; no `#hex` / `rgb()` / `hsl()` literal may appear; the
  reference brand's name may not appear outside comments.

## The bug the suite missed

Browser verification showed the rail rendering with **no background at all**.
`editorial.css` referenced `--brand-primary` and `--brand-on-accent`; neither
is a storefront token. The colour-literal ban passed it, because
`var(--brand-invented)` is not a literal — it simply paints nothing, on every
tenant.

Fixed by adding the missing guard first:

```
✗ references only --brand-* tokens the storefront actually defines
  — undefined token(s) — these paint nothing: --brand-on-accent, --brand-primary
```

then switching both surfaces to `--brand-main` with `--brand-button-text` on
top — the tenant's own deepest brand tone and the colour their palette already
guarantees is readable against it. Re-run: `37 passed, 0 failed`.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | The four layouts are the enum, and the allow-list saves each one | `test-editorial-home.ts` → "HOME_LAYOUTS carries editorial…", "every HOME_LAYOUTS value survives a branding patch" | unit | PASS |
| 2 | Editorial needs no grant; two-ways still does | "an unentitled tenant may select editorial", "adding editorial did not open a back door…" | unit | PASS |
| 3 | The home shows no product grid and no chips | "the home carries NO product grid" | unit | PASS |
| 4 | The catalog screen leads with the chips | "the catalog screen leads with the chips, then the grid" | unit | PASS |
| 5 | Index rows/counts derive from the tenant's catalog and never advertise an empty shelf | 8 `buildCategoryIndex` checks | unit | PASS |
| 6 | The edit band is the owner's featured flag, capped, empty-by-default | 5 `buildEditRow` checks | unit | PASS |
| 7 | The header and the rail render one identical nav | 5 `buildStorefrontNav` checks | unit | PASS |
| 8 | `editorial.css` cannot touch a tenant that did not opt in | "every rule is scoped to [data-sf-home='editorial']" | unit | PASS |
| 9 | The sheet carries no tenant palette or copy | "declares no literal brand colours", "carries no tenant copy" | unit | PASS |
| 10 | Every token the sheet reads actually exists | "references only --brand-* tokens the storefront actually defines" | unit | PASS |

Regression sweep, all after the change:

```
editorial-home     37 passed, 0 failed
boutique-home      42 passed, 0 failed
two-ways-home      37 passed, 0 failed
two-ways           18 passed, 0 failed
tenant-presets     65 passed, 0 failed
hero-flush         22 passed, 0 failed
catalog-sort       20 checks, 0 failure(s)
banner             35 passed, 0 failed
themes             PASS — 0 critical violation(s), 2 warning(s)
```

`npx tsc --noEmit` — clean.

## Browser verification

The dev server points at the **production** Supabase instance, so no live
tenant's `homeLayout` was changed. Verification ran on a throwaway route with
synthetic brand/products (5 categories, one deliberately empty; 11 products, 3
featured; 3 assurance lines), deleted afterwards — it is in no commit.

Confirmed at 1440×1000:

- rail fixed at 268px, page content inset by exactly that; no horizontal overflow
- index rendered 4 rows from 5 categories — the empty one dropped — with counts
  3 + 3 + 3 + 2 = the 11 products
- home carried no product grid
- clicking "Weight Management" routed to `#catalog`, the matching chip was
  active and the grid reported "3 PRODUCTS", agreeing with the index row
- inverted edit band showed the 3 featured products; imageless products drew
  the monogram fallback
- contact strip self-hid (the synthetic brand has no channels)

At 390 wide: the rail translates off-screen and is `visibility: hidden`, the
compact bar shows, root padding-left drops to 0, no horizontal overflow. The
burger opens the drawer (`transform: none`, visible), renders the scrim and
locks body scroll.

## Coverage and known gaps

There is no component test runner in this repo, so coverage is behavioural
rather than a percentage: the layout's decisions live in pure functions
(`editorialSections`, `buildCategoryIndex`, `buildEditRow`,
`buildStorefrontNav`, `resolveHomeLayout`) which are fully covered, and the
components above them only draw what those functions return. The stylesheet is
covered structurally by the CSS parser checks.

Deliberate gaps:

- The rail's drawer behaviour (translate, scrim, scroll-lock) is verified in
  the browser above, not by an automated test.
- No tenant has been switched to this layout. Doing so is a live-storefront
  change and needs the user's explicit go-ahead.
- ⚠️ `KGLOW_TWO_WAYS.off` in `src/lib/tenant/presets.ts` stamps
  `homeLayout: "classic"`, so removing that preset from a tenant that later
  chose editorial would reset them. Not reachable today (no tenant has both);
  same pre-existing caveat as the boutique layout.
