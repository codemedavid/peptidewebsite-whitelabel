# TDD Evidence — Order Ratio Control (peptide ↔ bacteriostatic water)

**Branch:** `feat/trial-system` · **Feature:** GB Order Ratio Control
**Test:** `npm run test:gb-ratio` (19 tests, all green)

## What it does

A store-wide **ratio floor**: every peptide vial in the cart requires N bacteriostatic
water (default 1 → 1:1, configurable for 2:1 / 3:1 …). Three enforcement modes:

| Mode | Cart | Checkout |
|---|---|---|
| **strict** | shows blocking message | server rejects the order |
| **auto_add** | cart auto-injects the shortfall of the default bac-water product | server rejects only a residual gap (e.g. bac water sold out) |
| **warn** | soft message | order still goes through |

Products are classified **peptide / bacWater / other** by the storefront admin's
per-product tag (`metadata.productClass`), falling back to a name/sequence
heuristic when untagged. Accessories ("other") never count toward the ratio.

## Why extend, not add a table

The spec suggested a new "Product Pairing" model. Grounded in the repo, the existing
`group-buy-rules.ts` engine already classified bac water and had cart/checkout
validation toggles — but was **fully dormant** (no admin editor, not in the cart, and
its server hook `groupBuyViolation` was dead code). This feature adds a `ratio` block
to that engine and finishes the wiring end-to-end. No schema change — it rides
`branding.config.groupBuyRules` and `Product.metadata.productClass`.

## RED → GREEN

1. RED: `scripts/test-gb-ratio.ts` imported `product-class.ts` + the new `ratio*`
   exports (module-not-found). GREEN after implementing the classifier + engine.
2. A test-only bug surfaced the whole point of the feature: real peptide names
   ("Semaglutide") don't contain the literal "pept", so the name heuristic returns
   "other" — the reason the admin tag exists. Peptide lines were tagged explicitly.

## Files

- `src/lib/storefront/product-class.ts` — shared classifier (tag > name heuristic)
- `src/lib/storefront/group-buy-rules.ts` — `GroupBuyRatio` type, `normalizeRatio`,
  `ratioCounts`, `requiredBacWater`, `ratioViolation`, `autoAddPlan`
- `src/lib/storefront/product-mapping.ts` + `src/storefront/types.ts` — round-trip
  `productClass`
- `src/storefront/admin/AdminGroupBuyRules.tsx` — new "Order Ratio Control" panel
- `src/storefront/admin/AdminAddProduct.tsx` — per-product "Order ratio class" selector
- `src/actions/storefront-admin.ts` — `saveGroupBuyRulesAction`
- `src/actions/orders.ts` — server enforcement (both demo + real branches, gated on
  `FEATURES.GB_RULES`; only a **blocking** violation rejects)
- `src/storefront/components/CartCheckout.tsx` — live cart violation + blocking
- `src/storefront/store.tsx` — auto-add reconcile effect
- `AdminPage.tsx` + `staff-permissions.ts` — view route, tile, `groupbuy` permission

## Verification

- `npm run test:gb-ratio` → 19 passed, 0 failed
- `tsc --noEmit` → clean
- Regression: `test:gb-rounds` (13), `test:cart` (15), `test:checkout-total` (13),
  `test:product-variations` (27) all green. (`test:onhand-gate` has 1 pre-existing
  failure using real DB resolvers — unrelated, `on-hand-gate.ts` untouched.)

## Notes / follow-ups

- **Entitlement gate:** everything hangs off `FEATURES.GB_RULES` (default OFF).
  `page.tsx` strips `brand.groupBuyRules` when unentitled, so a revoked feature both
  hides the editor and stops enforcement.
- **auto_add** reconciles the default bac-water line to *exactly* the requirement
  (adds up to stock, trims surplus). Converges in one render; a residual shortfall is
  caught by the blocking checkout violation.
- **Overlap:** Smart Checkout's `bacWaterValidation` is a *presence* check on a
  separate feature gate; the ratio floor is stricter. Operators shouldn't enable both
  for the same intent (documented, not code-enforced).
- Live DB needs no migration for this feature.
