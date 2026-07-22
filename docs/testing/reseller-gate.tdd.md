# TDD Evidence — Reseller pricing entitlement gate

**Date:** 2026-07-22 · **Branch:** main · **Commits:** `478ff21` (RED), `69e1d1b` (GREEN)

## Source plan

No `*.plan.md` — journeys derived during this TDD run from a live bug report
(screenshot: pepstack-davao cart showing "RESELLER · VIALS ONLY" at ₱2/ea).

## Bug

pepstack-davao has the Reseller portal feature **explicitly disabled**
(`TenantFeatureOverride { featureKey: storefront.reseller, enabled: false }`),
yet the storefront cart sold "GHK-Cu 50mg (Vial + 10ml Bac)" (retail ₱650) at
₱2/ea with the RESELLER badge once qty hit 10.

**Root cause (two parts):**

1. **Ungated pricing path.** `FEATURES.STORE_RESELLER_PORTAL` only gated the
   `#merchant` page and the store-admin Reseller view. The cart's bulk pricing
   (`checkout.ts` `unitPrice`/`isResellerQty`) is purely data-driven: any
   product with a `reseller` leg flips to wholesale at qty ≥ minQty — no
   entitlement check anywhere, including the server-authoritative re-price at
   placement (`orders.ts` → `authoritativeItemPrice`).
2. **Stray data.** The product's metadata carried a mis-entered wholesale leg:
   `reseller: { vialsOnly: 2, minQty: 10 }`.

## User journeys

- As a **store visitor** on an unentitled store, I never see reseller badges or
  wholesale prices, so the cart charges the retail price the catalog shows.
- As the **platform operator**, disabling the Reseller portal feature disables
  *all* reseller behavior — portal, admin view, **and pricing** — not just the
  pages.
- As a **store owner** whose feature is later re-granted, my saved wholesale
  prices come back untouched (the gate strips at read, never rewrites the DB).

## Fix

- New pure gate `src/lib/storefront/reseller-gate.ts` —
  `stripResellerPricing(products, entitled)`: identity when entitled, otherwise
  immutably removes each product's `reseller` tier.
- Wired at **every catalog boundary**:
  - `page.tsx` — rendered catalog (`stripResellerPricing(products, resellerEntitled)`)
  - `orders.ts` — both placement catalogs (demo + DB paths), each gated on a
    fresh `hasFeature(tenantId, FEATURES.STORE_RESELLER_PORTAL)` so a tampered
    client can't restore the wholesale price server-side.
- **Data cleanup** (`scripts/fix-pepstack-reseller.ts`): removed the stray
  `reseller` blob from the one affected product. Verified before/after with
  `scripts/inspect-pepstack-reseller.ts`: 1/22 → 0/22 products carry reseller
  data.

## Task report (RED → GREEN)

| Stage | Command | Result |
|---|---|---|
| RED (compile) | `npm run test:reseller-gate` | `MODULE_NOT_FOUND: src/lib/storefront/reseller-gate` — missing implementation |
| RED (runtime, after helper only) | `npm run test:reseller-gate` | 6 passed, **2 failed** — both wiring checks (page.tsx, orders.ts had no gate) |
| GREEN | `npm run test:reseller-gate` | **8 passed, 0 failed** |
| Typecheck | `npx tsc --noEmit` | clean |

## Test specification

| # | What is guaranteed | Test (scripts/test-reseller-gate.ts) | Type | Result |
|---|---|---|---|---|
| 1 | Unentitled: reseller legs stripped from every product | "unentitled: reseller legs are stripped…" | unit | PASS |
| 2 | Strip is immutable — inputs untouched | "…stripping is immutable…" | unit | PASS |
| 3 | All other product fields survive | "…every other field survives…" | unit | PASS |
| 4 | Entitled: catalog passes through unchanged | "entitled: products pass through…" | unit | PASS |
| 5 | Bug repro documented: ungated data prices ₱2 at qty 10 | "bug repro: WITH reseller data…" | unit | PASS |
| 6 | Gated product prices at retail in bulk; no badge | "gated: a stripped product prices at retail…" | unit | PASS |
| 7 | page.tsx gates the rendered catalog | wiring (source assertion) | integration | PASS |
| 8 | orders.ts gates BOTH placement catalogs on the entitlement | wiring (source assertion) | integration | PASS |

## Regressions checked

`test:cart` 15/15 · `test:checkout-total` 13/13 · `test:group-buy-pricing`
18/18 · `test:product-variations` 27/27 — all green.
`test:onhand-gate` shows 8/1; the failure **pre-exists** (verified by running
the same test in a worktree at the parent commit `6c03d19` → identical 8/1).

## Refactor

Skipped deliberately: the helper is 8 lines of pure code and the wiring is
three one-call insertions — nothing to consolidate.

## Coverage & known gaps

- Repo convention is per-feature `tsx` test scripts, not a coverage-instrumented
  runner; no coverage % is produced. The gate itself is fully exercised (both
  branches, immutability, pricing effect, wiring).
- Smart Checkout's "no mixed retail/reseller cart" rule now sees no reseller
  lines for unentitled tenants (consistent: the storefront shows none either).
- The store-admin Add Product form still shows reseller price inputs regardless
  of entitlement; with the gate this data is inert until granted. Follow-up
  candidate: hide those inputs behind `brand.showAdminReseller`.
- Live effect: the **data fix is immediate**; the **code gate protects all
  tenants after the next deploy**.
