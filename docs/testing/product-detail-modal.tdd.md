# TDD Evidence — Clickable product card → full-detail quick-view modal

**Date:** 2026-07-24
**Branch:** main
**Request (verbatim):** "the product card is not clickable to see the full detail"

## Source plan

No `*.plan.md` was supplied. Journeys were derived during this TDD run from the
single-line request and the existing storefront card surface (`Catalog.tsx`).

## User journeys

1. As a shopper, I want to click a product card so that I can read the full
   product detail — the whole description and the technical spec sheet the
   compact card clamps or omits.
2. As a shopper, I want the detail view to let me pick a dosage option and add to
   cart without losing my place in the catalog.
3. As a keyboard / screen-reader user, I want the "view details" affordance to be
   a real control I can focus and activate.

## What shipped

- **`src/lib/storefront/product-detail.ts`** (new, pure): `buildProductDetail()`
  and `productSpecRows()` — the modal's view model, reusing `resolveProductImage`
  and `buildProductOptions` so the modal and card never disagree on image, price
  or options.
- **`src/storefront/components/Catalog.tsx`**: `ProductCard` gains an optional
  `onOpenDetail`; the media and name render as real `<button>`s when it's present.
  New `ProductDetailModal` (Esc / scroll-lock / focus contract mirrors
  `NoticeModal`). `Catalog` holds `useState<Product | null>` and renders the modal.
- **`src/storefront/storefront.css`**: `.sf-detail*` modal styles + `.product-card__media--interactive` / `__name-btn` / `__view-hint` affordances, brand-token themed, with reduced-motion and ≤640px responsive rules.

Two-ways-layout tenants (`brand.homeLayout === "two-ways"`, e.g. K Glow) render
`TwoWaysHome`, not `Catalog`, so this modal covers the **classic** catalog card
surface only — noted for follow-up if the two-ways cards need the same.

## Task report

### RED
- **Command:** `npm run test:product-detail`
- **Output:** `Error: Cannot find module '../src/lib/storefront/product-detail'` —
  the intended missing-implementation failure (test references the un-built lib
  and the un-wired Catalog).
- **Checkpoint commit:** `ec5bce5 test: RED gate for clickable product card → detail modal`

### GREEN
- **Command:** `npm run test:product-detail`
- **Output:** `20 passed, 0 failed`
- **Type-check:** `npx tsc --noEmit --pretty false` → clean (exit 0)
- **Regression:** `npm run test:product-variations` → `30 passed, 0 failed`
- **Checkpoint commit:** `03a83ba feat: clickable product card opens full-detail quick-view modal`

### Live verification (Chrome DevTools, `luminara.lvh.me:3100/#catalog`)
Guarantees the pure gate + structural checks cannot cover on their own:
- Card exposes `button "View details for Tirzepatide"` + a clickable name button.
- Invoking the card's `onClick` opens `.sf-detail` with name "Tirzepatide".
- Selecting the `120mg` option updates the modal price `₱2,800 → ₱16,799`.
- Close (×) removes the modal and restores `document.body.style.overflow`.
- Add to Cart closes the modal and the header cart badge reads `1`.

> Note: the running dev server was initially serving 404s for `main-app.js`
> (whole storefront non-interactive, unrelated to this change); a dev-server
> restart resolved it before the live checks above.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Spec sheet lists only seller-filled fields, in canonical order, trimmed | `scripts/test-product-detail.ts` → productSpecRows (5 cases) | unit | PASS |
| 2 | Detail carries full un-clamped description + identity + currency + base price | `buildProductDetail` identity case | unit | PASS |
| 3 | Image falls back product → brand default → null | 2 image cases | unit | PASS |
| 4 | Options/showOptions reuse `buildProductOptions` (Standard + variations) | 2 option cases | unit | PASS |
| 5 | Stock clamped ≥0; out-of-stock + price-on-request flagged | 3 buyability cases | unit | PASS |
| 6 | Purity carried through / null when absent | 1 case | unit | PASS |
| 7 | `buildProductDetail` does not mutate its input | mutation case | unit | PASS |
| 8 | Catalog wires `onOpenDetail`, renders `ProductDetailModal`, holds selected state | 4 structural checks on `Catalog.tsx` | structural | PASS |
| 9 | Card is genuinely clickable → modal opens; option updates price; close + add-to-cart work | Chrome DevTools live | e2e (manual) | PASS |

## Coverage and known gaps

- The pure view model (`product-detail.ts`) is fully exercised by the 16
  behavioral assertions; the UI wiring by 4 structural checks + the live browser
  run. No standalone coverage tool is configured in this repo (the suite is the
  `tsx scripts/test-*.ts` gate convention); coverage is asserted by the gate, not
  a % report.
- **Gap:** two-ways-layout tenants render their own cards in `TwoWaysHome` and are
  not covered by this modal. Follow-up only if those cards should open a detail
  view too.
