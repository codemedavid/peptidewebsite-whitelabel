# Image hero runs flush — TDD evidence

**Date:** 2026-08-18
**Source plan:** none. Journeys derived during this TDD run from an operator screenshot of
`skn-aesthetic-supply-co` at a 528px-wide viewport, showing a cream band above and below the
uploaded banner.

## User journey

> As a store owner who uploaded a hero banner, I want the image to meet the header and the
> section below it directly, so the top of my store reads as one continuous design instead of
> a picture floating in a box.

Acceptance: at **every** viewport width, an image hero (`.hero.hero--media`) resolves to zero
block padding — and the written hero keeps the breathing room it has always had.

## What was actually wrong

`storefront.css` already carried the intent:

```css
/* line ~1060 */
.sf-root .hero--media { padding: 0; background: none; }
```

…but ~60 lines further down, the small-screen polish block re-declared it:

```css
@media (max-width: 600px) {
  .sf-root .hero { padding-block: clamp(40px, 12vw, 72px); }
}
```

Both selectors are specificity **(0,2,0)**. Equal specificity → later wins. So below 600px the
image hero got `padding-block: clamp(40px, 12vw, 72px)` back. At the operator's 528px viewport
that is `12vw = 63.4px` — matching the ~63px bands measured top and bottom in the screenshot.

The bug was invisible on a laptop, which is why it survived: above 600px the reset held.

## Why the test resolves the cascade instead of grepping

A grep for `.hero--media { padding: 0 }` would have **passed** the whole time the bug was live.
The rule existed; it was just overridden. So `scripts/test-hero-media-flush.ts` implements a
small CSS resolver — specificity first, then source order, honouring `@media` width conditions
and `!important` — and asserts the *final computed* padding. Five self-check cases validate the
resolver against known cascade behaviour before it is trusted to judge the stylesheet.

## Task report

| Step | Summary | Command | Result |
|---|---|---|---|
| RED | Added the reproducer; it fails only below the 600px breakpoint | `npm run test:hero-flush` | **17 passed, 5 failed** |
| GREEN | Scoped the small-screen rule to `.hero:not(.hero--media)` | `npm run test:hero-flush` | **22 passed, 0 failed** |
| Regression | Ran every adjacent storefront/hero suite | see table below | all pass |
| Visual | Loaded the real tenant at 528px and 1280px | Chrome DevTools screenshot | bands gone, desktop unchanged |

### RED output (excerpt)

```
image hero is flush at every viewport
  ✗ no band above or below the banner at 320px — padding-top resolves to "clamp(40px, 12vw, 72px)" at 320px
  ✗ no band above or below the banner at 375px — padding-top resolves to "clamp(40px, 12vw, 72px)" at 375px
  ✗ no band above or below the banner at 414px — …
  ✗ no band above or below the banner at 560px — …
  ✗ no band above or below the banner at 600px — …
  ✓ no band above or below the banner at 768px
  ✓ no band above or below the banner at 1024px
  ✓ no band above or below the banner at 1440px

17 passed, 5 failed
```

The failure is the intended business bug: only the widths under the breakpoint fail, and the
reported value is the exact declaration that wins the cascade.

### The fix

`src/storefront/storefront.css` — one selector:

```css
@media (max-width: 600px) {
  .sf-root .hero:not(.hero--media) { padding-block: clamp(40px, 12vw, 72px); }
}
```

### GREEN output

```
22 passed, 0 failed
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A later same-specificity rule wins over an earlier one | `test-hero-media-flush.ts` engine self-check | unit | PASS |
| 2 | Higher specificity beats source order | same | unit | PASS |
| 3 | `:not()` excludes the element it names | same | unit | PASS |
| 4 | A `max-width` rule applies only below its breakpoint | same | unit | PASS |
| 5 | `padding-block` sets both sides; a second value sets the end alone | same | unit | PASS |
| 6 | Image hero has zero top/bottom padding at 320/375/414/560/600/768/1024/1440px | `npm run test:hero-flush` | integration (stylesheet) | PASS ×8 |
| 7 | Written hero keeps non-zero top/bottom padding at all 8 widths — the fix does not overreach | same | integration | PASS ×8 |
| 8 | `.hero__media` adds no inset of its own | same | integration | PASS |

## Regression suites run

| Suite | Result |
|---|---|
| `npm run test:storefront-css-vars` | 5 passed, 0 failed |
| `npm run test:hero-media` | 52 passed, 0 failed |
| `npm run test:hero-wordmark` | all checks passed |
| `npm run test:hero-links` | 25 passed, 0 failed |
| `npm run test:footer-style` | all checks passed |
| `npm run test:brand-border` | all checks passed |
| `npm run test:price-font` | all checks passed |
| `npm run test:header-logo` | all checks passed |

## Visual verification

`skn-aesthetic-supply-co.lvh.me:3100` on the running dev server:

- **528 × 748** (the reported viewport) — banner meets the header directly; the ALL PRODUCTS
  row sits immediately below the image. Both cream bands gone.
- **1280 × 800** — unchanged from before the fix, confirming the desktop path never regressed.

## Coverage and known gaps

- The resolver models the **width axis only**. `@media` conditions it cannot evaluate
  (`prefers-reduced-motion`, `hover`) are treated as not applying — no such rule pads the hero
  today, and one added later would go unnoticed by this test.
- Ancestor compounds are assumed satisfied (every storefront rule is scoped under `.sf-root`,
  and the hero always lives there). This errs toward counting *more* rules, so it cannot
  produce a false PASS.
- Margin and `gap` are out of scope; the reported symptom was padding, and the live screenshots
  confirm no residual gap from any other property.

## Merge evidence

Checkpoints on `main`:

- `1003a8b test: add reproducer for image hero padding below 600px` — RED (17 passed, 5 failed)
- `f7c1b2b fix(storefront): keep the image hero flush on phones` — GREEN (22 passed, 0 failed)
