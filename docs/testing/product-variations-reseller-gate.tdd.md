# Product editor — reseller-pricing gate + variation presets

**Branch:** `feat/trial-system`
**Test command:** `npm run test:product-variations`
**Source plan:** none — journeys derived during this TDD run from the user's report.

## Context

Two changes to the store-admin product editor (`AdminAddProduct.tsx`), shipped
together because they touch the same screen:

1. **Bug fix.** The `🤝 Reseller / Wholesale Pricing` card rendered
   unconditionally. Every other reseller surface already derives from
   `brand.showAdminReseller` (projected server-side at
   `src/app/(tenant)/(storefront)/page.tsx:69` from
   `FEATURES.STORE_RESELLER_PORTAL`, consumed via
   `isAdminViewVisible(brand, "reseller")`) — the product editor was the one
   place that skipped the gate. Unentitled tenants therefore saw the card and
   could enter wholesale prices that no storefront surface would ever sell.

2. **New feature.** Quick-fill `+ Vials only` / `+ Complete set` buttons in the
   Variations editor. Sellers were retyping the same two options on nearly every
   product, letting the labels drift (`vials only`, `Vials Only`, `Vial only`)
   straight onto the customer-facing picker.

Explicitly **not** done, per the user: the wholesale block was neither removed
nor rewritten, and hiding it is display-only.

## User journeys

1. As a tenant **without** the Reseller Portal feature, I don't want to see
   wholesale pricing fields in the product editor, so that I'm not filling in
   prices nothing will ever use.
2. As a tenant **with** the Reseller Portal, I want the wholesale fields exactly
   where they were, so that nothing about my workflow changes.
3. As an operator, I want re-granting the Reseller Portal to restore a tenant's
   previously saved wholesale prices, so that toggling the feature is not
   destructive.
4. As a peptide seller, I want one click to add a "Vials only" or "Complete set"
   option, so that the labels stay consistent across my catalogue.
5. As a customer, I want to pick between those options on the storefront — which
   the pre-existing variations pipeline already delivers (`Catalog.tsx:39` →
   `makeVariationEntry` → cart).

## Task report

### Task 1 — gate the wholesale card

Added `isResellerPricingVisible(brand)` to `src/storefront/visibility.ts`,
delegating to `isAdminViewVisible(brand, "reseller")` rather than re-reading the
flag, so the card and the portal manager view cannot drift apart. Wrapped the
card in `AdminAddProduct.tsx` with it.

RED (`npm run test:product-variations`):

```
Error: Cannot find module '../src/storefront/admin/variation-presets'
```

GREEN: all 5 `isResellerPricingVisible` cases pass, including the structural
check that the editor source actually wraps the card in the gate.

**Preservation is by construction, not by extra code:** the `resellerVials` /
`resellerSet` / `resellerMin` state still seeds from `initial?.reseller` and is
still included in the save payload while the card is hidden, so values
round-trip untouched.

### Task 2 — variation presets

Added `src/storefront/admin/variation-presets.ts` with `VARIATION_PRESETS` and
`applyVariationPreset(items, preset)` — immutable, case-insensitive de-dupe,
reuses a blank row rather than stranding one. `AdminAddProduct.tsx` renders a
button per preset, retiring each once it's in the list (a button that silently
no-ops is worse than no button).

GREEN: all 8 `applyVariationPreset` cases pass.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Wholesale card is hidden when `showAdminReseller === false` | `hidden when the tenant's Reseller Portal entitlement is off` | unit | PASS |
| 2 | Wholesale card is shown when the tenant is entitled | `shown when the tenant is entitled to the Reseller Portal` | unit | PASS |
| 3 | Legacy brand blobs (flag `undefined`) keep the card — no accidental hiding | `shown for a legacy brand blob that predates the flag` | unit | PASS |
| 4 | The card and the Reseller Portal manager view never diverge | `agrees with the Reseller Portal manager view — one entitlement, no drift` | unit | PASS |
| 5 | The editor JSX actually applies the gate (catches the original bug) | `the editor actually gates its wholesale card on the helper` | structural | PASS |
| 6 | The two seller-facing presets exist and are spelled consistently | `exposes the two presets peptide sellers use` | unit | PASS |
| 7 | A preset appends with a blank price ready to type into | `appends the preset with a blank price ready to type into` | unit | PASS |
| 8 | Adding a preset never disturbs existing variation rows | `keeps existing rows untouched when appending` | unit | PASS |
| 9 | The helper is immutable (project rule) | `does not mutate the input array` | unit | PASS |
| 10 | A blank row is named rather than leaving an empty row stranded | `fills the first blank row instead of stacking another empty one` | unit | PASS |
| 11 | A price already typed into a blank row survives the fill | `preserves a price already typed into the blank row it fills` | unit | PASS |
| 12 | Double-clicking a preset can't create a duplicate option | `is a no-op when the preset is already in the list` | unit | PASS |
| 13 | De-dupe ignores case and stray whitespace | `matches an existing preset case-insensitively and ignores stray whitespace` | unit | PASS |

## Verification

```
npm run test:product-variations   → 13 passed, 0 failed
npx tsc --noEmit                  → clean
npm run test:cart                 → 15 passed, 0 failed
npm run test:feature-disclosure   → 11 passed, 0 failed
npm run test:trial-gating         → 18 passed, 0 failed
npm run test:onhand-gate          → 8 passed, 1 failed  (PRE-EXISTING)
```

`test:onhand-gate` is the intentional fail-closed reproducer added in `012bdd2`
(Phase 2 of the GB/access-gate port, still outstanding). It imports only
`on-hand-gate.ts` and `group-buy.ts`, neither of which this work touches.

## Known gaps

- **No browser-level check** that the card disappears for an unentitled tenant.
  Test #5 asserts the gate on the source rather than on a render, so a
  hypothetical refactor that keeps the literal `isResellerPricingVisible(brand) &&`
  text but breaks the JSX would slip through. The repo has no React test runtime
  (all suites are pure `tsx` scripts), so this matches the existing convention
  rather than introducing one.
- **No new storefront coverage** for the picker itself — the variations pipeline
  is pre-existing and unchanged; presets only pre-fill the same `name`/`price`
  rows the editor already produced.

## Merge evidence

- RED: `e33a335` — `test: reseller-pricing gate + variation presets in the product editor (RED)`
- GREEN: `dc84eaa` — `fix: gate product-editor wholesale card on the Reseller Portal entitlement`
- Refactor: none needed; the implementation landed at its final shape.
