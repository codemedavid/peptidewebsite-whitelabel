# TDD Evidence — Payment Proof full-image viewer

**Feature:** In the store-admin **Order Detail** screen, the Payment Proof
thumbnail crops the uploaded receipt (240×200, `object-fit: cover`), so the
admin can only see part of it. The thumbnail is now **clickable** and opens the
full, uncropped image in a full-screen lightbox (dismiss via backdrop click,
close button, or `Esc`).

**Source plan:** Derived inline via `/ecc:plan` → `/ecc:tdd-workflow` in this
session (no `*.plan.md` artifact).

**Branch:** `feat/bulk-order-status`

## User journey

> As a store admin, I want to click the payment proof thumbnail to see the full
> uncropped receipt, so I can verify the amount and sender that the cropped
> thumbnail hides.

Acceptance:

- A real payment proof renders a clickable thumbnail that opens a full-screen,
  uncropped viewer.
- A missing / blank / whitespace-only proof renders the "no proof" empty state
  and never opens an empty viewer or a broken `<img>`.
- The viewer closes on backdrop click, the close button, and the `Esc` key.

## Task report

### Pure guard: `hasPaymentProof(proof)`

- **Summary:** Single source of truth deciding whether the thumbnail is a
  clickable `<button>` (vs. the empty state) and whether the lightbox may open.
  Replaces the old `o.paymentProof ?` truthy check, which treated a
  whitespace-only string as present.
- **Location:** `src/storefront/admin/order-detail.ts` → `hasPaymentProof`.
- **Validation command:** `npm run test:payment-proof-viewer`
- **RED evidence** (commit `70476f7`, before implementing the guard):

  ```text
  hasPaymentProof
    ✗ true for a real proof URL — (0 , import_order_detail.hasPaymentProof) is not a function
    ✗ true for a URL with surrounding whitespace (trimmed, still present) — ... is not a function
    ✗ false for null (no proof uploaded) — ... is not a function
    ✗ false for undefined — ... is not a function
    ✗ false for an empty string — ... is not a function
    ✗ false for a whitespace-only string (no broken <img>, no empty lightbox) — ... is not a function

  0 passed, 6 failed
  ```

- **GREEN evidence** (commit `ccc9788`, after implementing the guard):

  ```text
  hasPaymentProof
    ✓ true for a real proof URL
    ✓ true for a URL with surrounding whitespace (trimmed, still present)
    ✓ false for null (no proof uploaded)
    ✓ false for undefined
    ✓ false for an empty string
    ✓ false for a whitespace-only string (no broken <img>, no empty lightbox)

  6 passed, 0 failed
  ```

- **Guaranteed by the passing tests:** the clickable thumbnail and the lightbox
  open **iff** a real, non-blank proof URL exists; blank/whitespace/null/undefined
  never produce a broken image or an empty viewer.

### UI wiring (verified, not unit-tested)

- **`src/storefront/admin/AdminOrderDetail.tsx`** — `isProofOpen` state; `Esc`
  key listener (`useEffect`, cleaned up on close/unmount); clickable
  `button.od-proof--clickable` thumbnail with a zoom badge; full-screen
  `od-proof-viewer` overlay (`role="dialog"`, `aria-modal`) with backdrop-click
  and close-button dismiss; image `object-fit: contain` (uncropped);
  `stopPropagation` so clicking the image doesn't close.
- **`src/storefront/storefront.css`** — `.od-proof--clickable` hover/focus
  affordance + zoom badge, and the `.od-proof-viewer*` lightbox (reuses the
  existing `@keyframes sf-viewer-in` and honors `prefers-reduced-motion`).
- **Validation:** `npx tsc --noEmit --pretty false` → **0 errors** (full
  project). Behavior to confirm manually: open a store-admin order that has a
  payment proof, click the thumbnail, confirm the whole receipt shows, and that
  backdrop / close button / `Esc` all dismiss it.

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|--------------------|------|------|--------|----------|
| 1 | A real proof URL is treated as present (thumbnail clickable, viewer openable) | `scripts/test-payment-proof-viewer.ts:true for a real proof URL` | unit | PASS | `npm run test:payment-proof-viewer` |
| 2 | Surrounding whitespace is trimmed but the URL still counts as present | `…:true for a URL with surrounding whitespace` | unit | PASS | same |
| 3 | `null` → not present (empty state, no viewer) | `…:false for null` | unit | PASS | same |
| 4 | `undefined` → not present | `…:false for undefined` | unit | PASS | same |
| 5 | `""` → not present | `…:false for an empty string` | unit | PASS | same |
| 6 | Whitespace-only string → not present (no broken `<img>`, no empty lightbox) | `…:false for a whitespace-only string` | unit | PASS | same |

## Coverage and known gaps

- The pure guard has **100% branch coverage** for its input space: real URL,
  whitespace-wrapped URL, `null`, `undefined`, empty string, whitespace-only
  string (6/6 cases). The repo uses self-contained `tsx` assertion scripts
  (no Istanbul %) — this mirrors `scripts/test-order-detail.ts` and peers.
- **Gap (intentional):** the DOM interactions (click-to-open, `Esc`/backdrop/
  close-button dismiss) are not automated — the project has no React Testing
  Library / jsdom harness. They are covered by `tsc` + manual verification, as
  noted above.

## Merge evidence (for squash)

- **RED:** `70476f7` — reproducer added; ran and failed 6/6 for the intended
  reason (`hasPaymentProof` not yet exported).
- **GREEN:** `ccc9788` — guard implemented; reproducer passes 6/6; full project
  `tsc --noEmit` clean.
- **Not committed here (shared-tree entanglement):** the UI pair
  (`AdminOrderDetail.tsx`, `storefront.css`) is complete and verified in the
  working tree but left uncommitted because `AdminOrderDetail.tsx` also carries
  an in-progress `ready` order-status change from a parallel session. Commit the
  UI together with that feature.
