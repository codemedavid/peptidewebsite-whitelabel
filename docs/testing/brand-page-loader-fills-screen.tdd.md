# Branded page loader — fills the screen, mark sized for it

**Source plan:** none. Journeys derived from a screenshot of a live tenant
(GlowForm Lab) mid-navigation: the tenant's cream backdrop covered the top ~60%
of the window, plain site background filled the rest, and the logo sat small and
centred in that band rather than on the page.

## User journeys

1. As a shopper opening a store, I want the branded loading screen to cover the
   whole window, so the store looks like it is loading rather than half-painted.
2. As a shopper on a phone, I want the loader centred on what I can actually
   see, so browser chrome does not push the mark off-centre or add a scrollbar.
3. As a store owner, I want my logo shown at a size that reads as my brand, not
   as a thumbnail.

## Task report

**Diagnosis.** `.sf-splash-page` in `src/storefront/brand-splash.css` was written
as an inline, content-area band (`min-height: 60vh`), on the reasoning that a
full-viewport takeover on every route change would be heavier than the
navigation it covers. That reasoning holds for exactly one surface —
`products/[slug]/loading.tsx`, which renders inside the layout's
header/`<main>`/footer chrome. Every other caller renders it as the entire page:

- `src/app/(tenant)/(storefront)/loading.tsx` — the layout returns `children`
  bare on the storefront home (`isStorefrontHome`), with no chrome around it.
- 14 `next/dynamic` fallbacks in `src/storefront/StorefrontApp.tsx`, plus the
  admin-auth wall at `StorefrontApp.tsx:242`.

So on those surfaces the 60vh band was the whole visible loading state, which is
what the screenshot shows.

Two contributing details:

- `min-height` in `vh`. On mobile `100vh`/`60vh` measure the viewport at its
  tallest (URL bar retracted), so the box overshoots while the bar is showing.
- The mark was a `clamp(56px, 7vw, 104px)` **square** with
  `background-size: contain`. `contain` fits on the tightest axis, so a wide
  wordmark was sized by the box's width and painted at a fraction of its height
  — the "logo is small" half of the report.

**Fix** (`src/storefront/brand-splash.css`):

- `.sf-splash-page` → `min-height: 100vh` then `min-height: 100svh` (fallback
  first, svh wins where supported).
- new `main .sf-splash-page { min-height: 60svh }` — the chrome'd product route
  keeps a content-area band so the footer is not pushed off-screen.
- the mark becomes a rectangle: `width: min(320px, 64vw)`,
  `height: clamp(96px, 13vw, 180px)` — same viewport-tracking shape as the boot
  splash's `.sf-splash__logo`.
- the monogram pseudo-element drops `width: 100%` for `height: 100%` +
  `aspect-ratio: 1`, so it stays a tile inside the widened box, and its
  `font-size` scales to match (`clamp(28px, 3.4vw, 60px)`).

**Validation command:** `npm run test:brand-page-loader`

RED (before the fix, `f0e55ca`):

```
BRAND PAGE LOADER — the frame it fills
  ✗ the loader fills the screen on every surface where it IS the page
    the loader must fill the viewport, got: .sf-splash-page { … min-height: 60vh; … }
  ✗ the fill is expressed in svh, with a vh fallback under it
  ✗ a route that already carries chrome keeps the loader in the content area
  ✗ the mark is sized for a screen-filling loader, not as a thumbnail tile
    the mark's height floor must be at least 88px (was 56)
  ✗ the monogram tile stays square inside the widened mark box
22 passed, 5 failed
```

GREEN (after the fix, `751bf6d`): `27 passed, 0 failed`.

## Test specification

| # | What is guaranteed | Test file or command | Type | Result | Evidence |
|---|--------------------|----------------------|------|--------|----------|
| 1 | The base loader rule fills the viewport and carries no partial-height band | `scripts/test-brand-page-loader.ts:the loader fills the screen on every surface where it IS the page` | unit | PASS | `npm run test:brand-page-loader` |
| 2 | The fill is `100svh` with a `100vh` fallback declared before it | `scripts/test-brand-page-loader.ts:the fill is expressed in svh, with a vh fallback under it` | unit | PASS | same |
| 3 | A loader inside the layout's `<main>` chrome stays a content-area band | `scripts/test-brand-page-loader.ts:a route that already carries chrome keeps the loader in the content area` | unit | PASS | same |
| 4 | The mark's height floor is ≥ 88px and its box is not square | `scripts/test-brand-page-loader.ts:the mark is sized for a screen-filling loader, not as a thumbnail tile` | unit | PASS | same |
| 5 | The monogram holds 1:1 inside the widened mark box | `scripts/test-brand-page-loader.ts:the monogram tile stays square inside the widened mark box` | unit | PASS | same |

Existing guarantees re-run unchanged: `npm run test:brand-splash` (39 passed),
`npm run test:brand-splash-admin` (21 passed, reads the same stylesheet),
`npm run test:hero-flush` (22 passed — the storefront CSS cascade guard).
`npx tsc --noEmit --incremental` clean.

## Coverage and known gaps

- These are source-text assertions over the stylesheet, the established pattern
  for this file (there is no browser in the test harness). They pin the rules
  that produced the defect; they do not measure rendered pixels.
- **Not verified in a browser.** No screenshot pass at 320/768/1024/1440 was run
  for this change; the visual result should be eyeballed on the reported tenant.
- The boot splash (`.sf-splash`, `position: fixed; inset: 0`) was not touched —
  it already covers the viewport by construction, which is how the defect was
  localised to the page loader.
