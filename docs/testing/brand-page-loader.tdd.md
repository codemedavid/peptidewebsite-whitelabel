# TDD evidence — the branded loading screen on route changes

**Task:** "The load when going to another page or part of the website is not using the branded loading."
**Branch:** `main` · **Date:** 2026-08-24
**Suite:** `npm run test:brand-page-loader` (22 checks) (`scripts/test-brand-page-loader.ts`)

No `*.plan.md` was supplied. The journeys below were derived during this TDD run
from the reported symptom.

---

## 1. The defect

`BrandSplash` covers exactly one moment — the first server render of the
storefront layout. Every navigation after that fell back to unbranded chrome:

| Surface | What it rendered before |
|---|---|
| `StorefrontApp.tsx` — `PageSpinner` (14 code-split hash routes + the admin auth check) | a generic ring, brand-colored but with no mark |
| `src/app/(tenant)/(storefront)/loading.tsx` | a grey `Skeleton` hero + catalog wall |
| `src/app/(tenant)/(storefront)/products/[slug]/loading.tsx` | a grey `Skeleton` product wall |

So a shopper saw the store's own mark once, then stock chrome for the rest of the
visit — the exact failure the splash was built to end.

## 2. User journeys

1. As a shopper, when I open a sub-page (FAQ, COA, Group Buy, Track Order), I want the
   wait to carry the store's mark, so I can tell whose shop I am still in.
2. As a shopper on a slow connection, I want the wait to visibly *move*, so I can tell
   the page is arriving rather than having arrived empty.
3. As an operator, I want the splash design, colors and mark I configured to be what
   shoppers see mid-visit too, without configuring a second thing.
4. As an operator who turned the splash off, I want these surfaces left exactly as
   they were.

## 3. Why the config travels as CSS, not props

Neither surface can be handed props: a `loading.tsx` is a Suspense fallback Next
renders with no arguments, and `next/dynamic`'s `loading` receives only its own
status flags. Both *do* sit inside the storefront layout, so `brandLoaderVars` /
`brandLoaderDesign` paint the tenant's mark, colors and chosen indicator onto that
root, and one props-less `<BrandPageLoader />` (no `"use client"`) serves the
server walls and the client SPA fallback alike.

That makes an inline `style` attribute the trust boundary for two untrusted
strings — the tenant's logo URL and its store name — hence `cssUrl` (allowlist,
drops a hostile mark to the monogram) and `cssString` (escapes).

## 4. Task report

### 4.1 Carry the splash config to route-change surfaces

Added `src/lib/storefront/brand-loader.ts`, `src/storefront/components/BrandPageLoader.tsx`,
a `.sf-splash-page` block in `brand-splash.css` reusing the splash's own class names,
and wired the layout root, the SPA fallback and both `loading.tsx` walls.

**RED** (compile-time — the test newly references the module the fix must introduce):

```
$ npm run test:brand-page-loader
Error: Cannot find module '../src/lib/storefront/brand-loader'
```

**GREEN:**

```
$ npm run test:brand-page-loader
19 passed, 0 failed
```

### 4.2 The monogram tile painted over every uploaded logo

Found by looking at the real thing in a browser, not by the suite: the loader
rendered HP Glow as a plain gold square. `content: var(--splash-initials, "")`
still *generates* the pseudo-element — an empty string is a box, not an absent
one — so the accent tile covered the mark on every tenant that had a logo.

**RED:**

```
$ npm run test:brand-page-loader
✗ the stylesheet drives the loader off the root's data-splash-design
  the monogram pseudo-element must fall back to `none`, not "" — an empty
  string still paints its tile over the logo
18 passed, 1 failed
```

**GREEN** after changing the fallback to `none`, the only value that suppresses
the pseudo-element:

```
19 passed, 0 failed
```

### 4.3 A splash-disabled tenant got a blank box (found in code review)

Turning the splash off emits no vars and no `data-splash-design` — correct, that
is what keeps those tenants unbranded. But *every* visible part of the loader was
gated on that attribute (`.sf-splash__ring, .sf-splash__bar { display: none }` is
the global default), and the generic `PageSpinner` those tenants fell back to was
deleted in the same change. Result: an empty 60vh area on all 14 code-split routes
and both `loading.tsx` walls.

The suite did not catch it because §5 #19 asserted each design was *mentioned* in
the CSS. The ring was mentioned — and hidden.

**RED:**

```
$ npm run test:brand-page-loader
✗ a splash-disabled tenant still gets a VISIBLE loader, not a blank box
✗ the bar design swaps the ring out rather than relying on it being hidden
✗ reduced motion never blanks a splash-disabled tenant's loader
19 passed, 3 failed
```

**GREEN** after making the ring the un-gated default for `.sf-splash-page` (the
bar design now expresses only its *difference* from it), hiding the mark unless
the splash is enabled, and letting reduced motion drop the ring only while a mark
is left standing:

```
22 passed, 0 failed
```

### 4.4 Refactor

Dropped the `PageSpinner = BrandPageLoader` alias; the 14 code-split routes and
the admin auth check now name `BrandPageLoader` directly. The old name promised a
spinner, but the fallback renders whichever indicator the operator picked. Suite
still 19/19, `tsc --noEmit` clean.

## 5. Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A disabled splash emits nothing, so those surfaces keep today's plain spinner | `brandLoaderVars` / `brandLoaderDesign` | unit | PASS |
| 2 | An unconfigured tenant still gets a branded loader (fails ON, like the splash) | `normalizeBrandSplash(undefined)` | unit | PASS |
| 3 | The operator's splash mark wins over the header logo | `brandLoaderVars` | unit | PASS |
| 4 | No splash mark falls through to the header logo | `brandLoaderVars` | unit | PASS |
| 5 | Exactly one of `--splash-logo` / `--splash-initials` is ever emitted | `brandLoaderVars` | unit | PASS |
| 6 | A logo URL that could break out of `url()` is dropped, not emitted | `cssUrl` via `brandLoaderVars` | unit (security) | PASS |
| 7 | A store name is escaped into a CSS string | `cssString` via `brandLoaderVars` | unit (security) | PASS |
| 8 | Unset colors emit no var, so the loader inherits the tenant's theme | `brandLoaderVars` | unit | PASS |
| 9 | Set colors are carried through | `brandLoaderVars` | unit | PASS |
| 10 | The input splash config is never mutated | `brandLoaderVars` / `brandLoaderDesign` | unit | PASS |
| 11 | `ring` and `bar` are honoured as chosen | `brandLoaderDesign` | unit | PASS |
| 12 | Indicator-less designs fall back to one that moves | `brandLoaderDesign` | unit | PASS |
| 13 | `monogramInitials` is the rule `<Monogram>` renders | shared module + source check | unit | PASS |
| 14 | The layout puts the loader vars + design on the storefront root | `layout.tsx` source | wiring | PASS |
| 15 | The SPA's lazy-page fallback renders the branded loader | `StorefrontApp.tsx` source | wiring | PASS |
| 16 | Both `loading.tsx` walls render it, not a grey skeleton | both files' source | wiring | PASS |
| 17 | The loader takes no props, so a server `loading.tsx` can render it | `BrandPageLoader.tsx` source | wiring | PASS |
| 18 | The loader reuses the splash's class names, so the two cannot drift | `BrandPageLoader.tsx` source | wiring | PASS |
| 19 | Each indicator actually resolves to `display: block`, and the monogram falls back to `none` | `brand-splash.css` source | wiring | PASS |
| 20 | A splash-disabled tenant still gets a visible loader, not a blank box | `brand-splash.css` source | wiring (regression) | PASS |
| 21 | The `bar` design swaps the ring out rather than relying on it being hidden | `brand-splash.css` source | wiring | PASS |
| 22 | Reduced motion never blanks a splash-disabled tenant's loader | `brand-splash.css` source | wiring | PASS |

## 6. Browser verification

Dev server on `hpglow.lvh.me:3100`, loader markup rendered inside the real layout root:

- Root HTML carries `data-splash-design="ring"` and `--splash-logo:url("https://ik.imagekit.io/…")` on both `hpglow` and `k-glow`.
- **Splash disabled** (no attribute, no vars): mark `display: none`, ring `display: block` + `sf-splash-spin` — a centered plain spinner, exactly what these tenants had before.
- **Bar design:** ring `display: none`, bar `display: block`.
- **Logo branch:** HP Glow's real ImageKit mark paints; ring `display: block`, `animation: sf-splash-spin`, `border-top-color: rgb(200,163,76)` — the tenant's gold. Bar stays `display: none` (design is `ring`).
- **Monogram branch** (`--splash-logo` removed, `--splash-initials: "KG"`): tile paints `rgb(200,163,76)` with white initials, no logo box.

## 7. Adjacent suites

All green after the change: `brand-splash` (39), `brand-splash-admin` (21),
`storefront-css-vars` (5), `branding-update`, `icon-fallback` (6),
`two-ways-home` (37), `boutique-home` (42), `editorial-home` (37),
`group-buy-page` (51), `product-detail` (20), `hero-flush` (22), `hero-media` (52),
`footer-style`, `logo-curve` (15), `notice-modal` (18), `store-status`.
`npx tsc --noEmit` clean.

## 8. Coverage and known gaps

- **No coverage number.** This repo has no coverage tooling — the suites are
  self-contained `tsx` scripts, not jest/vitest — so the 80% line-coverage target
  is not measurable here. Coverage of the *change* is per-behavior instead: every
  exported function in `brand-loader.ts` and every wiring point has a check above.
- **Not covered by an automated test:** that the loader *looks* right. Both real
  defects here — the `content: ""` overlay (§4.2) and the blank disabled-tenant
  box (§4.3) — passed every source-level assertion at the time. One was caught in
  a browser, one in code review; neither by the suite. §6 is the standing
  evidence, and there is no visual-regression harness in this repo to pin it.
  Source-text CSS checks can prove a rule *exists*; they cannot prove it *wins*.
- **Out of scope:** the platform admin's own `loading.tsx` files under
  `src/app/(platform)/admin/**` keep their skeletons. They are the operator
  console, not a white-labeled storefront, and have no tenant to brand for.
- **Left dead deliberately:** the `.sf-page-spinner` wrapper rule in
  `storefront.css` is now unreferenced, but its paired `.sf-page-spinner__ring` is
  still used by `AdminAddProduct.tsx`. Deleting half the pair was not worth it.
- **Pre-existing failure, not from this work:** `npm run test:header-logo` fails
  its "letter-tile fallback sits behind the gate" check. Caused by `d8541ae`
  (the concurrent image-optimization commit) adding `srcSet`/`sizes`/dimensions to
  the header logo `<img>`, which pushed `site-header__logo-mark` past that test's
  400-character search window. `Header.tsx` is untouched by this task's commits.

## 9. Merge evidence

Checkpoints on `main`, in order:

| Commit | Stage |
|---|---|
| `ea3dab4` | `test(storefront): reproducer …` — RED (compile-time) |
| `d7f6a2c` | `fix(storefront): use the branded loading screen on route changes too` — GREEN |
| `ccbef0a` | `fix(storefront): stop the monogram tile painting over the tenant's logo` — RED → GREEN |
| `167eac1` | `refactor(storefront): drop the PageSpinner alias` — green throughout |
| `b85e86f` | `fix(storefront): stop a splash-disabled tenant getting a blank loading box` — RED → GREEN |

If these are squashed, this file is the surviving record.
