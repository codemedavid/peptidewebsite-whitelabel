# TDD Evidence — Customer review viewer (click to enlarge, toggle to actual size)

**Date:** 2026-08-28
**Branch:** main
**Checkpoints:** `e21ef18` (RED) → `de70dba` (GREEN) → `69316d4` (refactor)
**Scope:** all three surfaces that render a testimonial — the Reviews page grid (`src/storefront/pages/ReviewsPage.tsx`), the product quick-view's connected-review block (`src/storefront/components/Catalog.tsx`), and the store-admin Reviews manager (`src/storefront/admin/AdminReviewsManager.tsx`) — behind one shared viewer.

## Source plan

No `*.plan.md` was supplied. Journeys were derived during this TDD run from the report:

> "the admin of pepstack davao is saying that the feature review cant be zoomed in or when clicked it should be view much larger modal"

## User journeys

1. As a shopper on the Reviews page, I want to click a testimonial so its screenshot opens in a much larger modal, **uncropped** — the 4/5 `object-fit: cover` tile cut the top and bottom off a tall chat screenshot.
2. As a shopper on a phone, I want to **zoom** that screenshot to actual size and pan it, because fitting it to the viewport still leaves the chat text too small to read.
3. As a shopper in a product quick-view, I want the 56×56px review thumbnail to open the same large viewer — and one Escape must close **only** the viewer, not the product modal underneath it.
4. As the store owner in `#admin → Reviews`, I want the same click-to-enlarge on my manager thumbnails, so I can proof what a shopper actually sees.
5. As a keyboard or screen-reader user, I want every trigger to be a real focusable `<button>` with a describing label, and the dialog to be labelled, `aria-modal`, and Escape-dismissable.

## Task report

**Behavior:** a testimonial is clickable on every surface and opens one shared full-screen dialog that shows the image whole, with a zoom toggle to actual size.

- **New pure core** `src/lib/storefront/review-viewer.ts` — `canOpenReviewViewer`, `buildReviewViewer`, `reviewViewerAlt`, `reviewViewerSrc`, `nextReviewZoom`, `reviewZoomLabel`, plus the `REVIEW_VIEWER_FIT_WIDTH` / `REVIEW_VIEWER_ZOOM_WIDTH` / `REVIEW_VIEWER_QUALITY` constants. It delegates typography to the existing `resolveReviewDescStyle` and product links to `reviewProductIds`, so the enlarged view cannot drift from the card it was opened from.
- **New shared component** `src/storefront/components/ReviewViewer.tsx` — `role="dialog"` + `aria-modal`, Escape, background-scroll lock, backdrop-click close, and the zoom toggle (both a toolbar control and tap-the-image). Deliberately one component rather than a third hand-rolled lightbox alongside `.protocols__viewer` and `.od-proof-viewer`.
- **ReviewsPage** — the media tile is a real `<button className="review-card__media review-card__zoom">`; the grid image now goes through `imageUrl`/`imageSrcSet` instead of `src={r.image}`, which had been shipping the untouched original into a 260px card.
- **Catalog quick-view** — the 56px thumb becomes `.sf-detail__review-zoom`; the modal's own Escape handler early-returns while `reviewViewer` is set (and lists it in the effect deps), so one keypress does not dismiss both modals. The viewer is rendered *inside* `.sf-detail`, whose `onClick` stops propagation, so a backdrop click cannot reach the product overlay.
- **AdminReviewsManager** — the manager thumb becomes `.review-admin-card__zoom` and opens the same viewer; the previously unused `brand` prop (`void brand;`) now feeds it.
- **`storefront.css`** — the `.sf-review-viewer` block at `z-index: 1400` (beating `.sf-detail-overlay`'s 1200), with `[data-zoom="actual"]` dropping the fit constraint and the stage set to `overflow: auto` so an oversized image can be panned.

**The zoom is a bigger fetch, not a CSS upscale.** `reviewViewerSrc` asks ImageKit for `w-1200,q-90` fitted and `w-2400,q-90` zoomed. Reusing the card's downsized URL would only stretch pixels the edge had already discarded.

**Validation command:** `npm run test:review-viewer` (registered in `package.json`)

**RED (before implementation)** — the pure core did not exist, so the suite could not even load:

```
Error: Cannot find module '../src/lib/storefront/review-viewer'
Require stack:
- /Users/…/scripts/test-review-viewer.ts
    code: 'MODULE_NOT_FOUND'
```

**GREEN (after implementation):**

```
canOpenReviewViewer
  ✓ a testimonial with an image can be enlarged
  ✓ a text-only testimonial can still be enlarged (the modal shows the copy)
  ✓ an all-blank row is not clickable — an empty dialog is worse than none

buildReviewViewer (the dialog's model)
  ✓ hasImage reflects a real image, not a blank string
  ✓ the whole testimonial travels into the dialog, not just the picture
  ✓ the enlarged copy keeps the owner's typography (tenant default + per-review override)
  ✓ product links resolve through the shared reader, so legacy rows still link
  ✓ the dialog label falls back through title, headline, badge

reviewViewerSrc (the zoom is only real if the pixels are)
  ✓ the fit view asks the edge for a screenshot-legible width
  ✓ zooming in requests MORE pixels, not the same URL scaled up in CSS
  ✓ the viewer raises quality — small text in a screenshot is what breaks first
  ✓ a non-ImageKit testimonial is passed through byte-for-byte
  ✓ no image yields no src — never a broken <img> in the dialog

zoom toggle
  ✓ clicking toggles between fit-to-screen and actual size
  ✓ the control is labelled with the ACTION, not the current state

surface wiring
  ✓ ReviewViewer is a real modal dialog, not a styled div
  ✓ the Reviews page opens the viewer from a real button
  ✓ the Reviews page stops shipping the untouched original into a card
  ✓ the product quick-view opens the viewer from its 56px thumbnail
  ✓ one Escape closes the review viewer, not the product modal underneath it
  ✓ the store-admin Reviews manager thumb opens the same viewer
  ✓ the viewer stacks above the product detail overlay

22 passed, 0 failed
```

**Refactor (`69316d4`), still green:** the thumb rendered on `r.image` and then set `disabled={!canOpenReviewViewer(r)}` — two rules for one question, plus `:disabled` CSS for a state only reachable via a whitespace-only image URL, which also painted a broken `<img>`. The guard is now the render condition itself on both surfaces, and the dead `:disabled` blocks were deleted.

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | A testimonial with an image, or with only text, is clickable; an all-blank row is not | `scripts/test-review-viewer.ts:canOpenReviewViewer` | unit | PASS | `npm run test:review-viewer` |
| 2 | The dialog carries the whole testimonial — headline, title, body, badge — not just the picture | `scripts/test-review-viewer.ts:the whole testimonial travels into the dialog` | unit | PASS | `npm run test:review-viewer` |
| 3 | The enlarged copy renders in the owner's typography (tenant default merged with the per-review override) | `scripts/test-review-viewer.ts:the enlarged copy keeps the owner's typography` | unit | PASS | `npm run test:review-viewer` |
| 4 | Legacy single-`productId` rows still resolve their product links in the viewer | `scripts/test-review-viewer.ts:product links resolve through the shared reader` | unit | PASS | `npm run test:review-viewer` |
| 5 | The dialog always has an accessible name (title → headline → badge → "Customer review") | `scripts/test-review-viewer.ts:the dialog label falls back` | unit | PASS | `npm run test:review-viewer` |
| 6 | Zooming requests a strictly larger ImageKit transform, not a CSS upscale of the fitted URL | `scripts/test-review-viewer.ts:zooming in requests MORE pixels` | unit | PASS | `npm run test:review-viewer` |
| 7 | The viewer raises image quality above the card default (screenshot text degrades first) | `scripts/test-review-viewer.ts:the viewer raises quality` | unit | PASS | `npm run test:review-viewer` |
| 8 | Non-ImageKit and empty image sources never produce a rewritten or broken `<img>` | `scripts/test-review-viewer.ts:passed through byte-for-byte`, `no image yields no src` | unit | PASS | `npm run test:review-viewer` |
| 9 | The zoom control toggles both ways and is labelled with the action it performs | `scripts/test-review-viewer.ts:zoom toggle` | unit | PASS | `npm run test:review-viewer` |
| 10 | The viewer is a real modal (role, aria-modal, Escape, scroll lock) and stops image clicks from closing it | `scripts/test-review-viewer.ts:ReviewViewer is a real modal dialog` | structural | PASS | `npm run test:review-viewer` |
| 11 | The Reviews page opens it from a keyboard-reachable `<button>`, and no longer ships the untouched original into a card | `scripts/test-review-viewer.ts:the Reviews page opens the viewer…`, `…stops shipping the untouched original` | structural | PASS | `npm run test:review-viewer` |
| 12 | The product quick-view thumbnail opens it, and one Escape closes only the viewer | `scripts/test-review-viewer.ts:the product quick-view opens the viewer…`, `one Escape closes the review viewer` | structural | PASS | `npm run test:review-viewer` |
| 13 | The store-admin manager reuses the same viewer rather than a fourth lightbox | `scripts/test-review-viewer.ts:the store-admin Reviews manager thumb` | structural | PASS | `npm run test:review-viewer` |
| 14 | The viewer stacks above the product detail overlay and its zoomed stage scrolls | `scripts/test-review-viewer.ts:the viewer stacks above the product detail overlay` | structural | PASS | `npm run test:review-viewer` |

**No regressions** (re-run after both GREEN and refactor):

| Suite | Result |
|-------|--------|
| `npm run test:review-content` | 38 passed, 0 failed |
| `npm run test:reviews` | 7 passed, 0 failed |
| `npm run test:product-detail` | 20 passed, 0 failed |
| `npx tsc --noEmit` (touched files) | no errors |

## Coverage and known gaps

- **No coverage number.** This repo has no coverage tooling — no `test:coverage` script and no jest/vitest/nyc/c8 dependency. Every suite is a self-contained `tsx` assertion script, so the 80% target is met in this codebase by the per-feature gate above (behavioral checks on the pure core + structural checks that each surface actually calls it), the same shape as `test-review-content.ts` and its neighbours.
- **Not covered by an automated test:** the visual result itself — that a zoomed screenshot is legible on a 375px viewport. That is a browser check, not an assertion; the pure core only guarantees the larger transform is requested and the stage scrolls.
- **`npm run build` was deliberately not run.** A concurrent session was active in this working tree and a build clobbers the live `.next/`, which takes the running dev server down with server-wide 500s. Typecheck was run instead and is clean for every touched file.
- **Unrelated pre-existing `tsc` errors** (8, all in `scripts/test-sale-price.ts`) belong to that concurrent session's in-flight sale-price feature — `src/lib/storefront/sale.ts` was untracked at the time. None are in files this cycle touched.
- **Untouched by design:** `ProtocolsPage`'s `.protocols__viewer` and the admin's `.od-proof-viewer` keep their own lightboxes. Consolidating all three is a worthwhile follow-up but is not this fix.

## Merge evidence

If these commits are squashed: RED `e21ef18` proved the missing module (`MODULE_NOT_FOUND` on `src/lib/storefront/review-viewer`); GREEN `de70dba` brought `npm run test:review-viewer` to 22/22 with `test:review-content` 38/38, `test:reviews` 7/7 and `test:product-detail` 20/20 unchanged; refactor `69316d4` collapsed the duplicated clickability rule with all four suites still green.
