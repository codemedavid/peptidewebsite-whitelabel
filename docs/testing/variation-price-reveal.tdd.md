# TDD Evidence — Variation price reveal (name-only pills, price on click)

**Date:** 2026-07-26
**Branch:** main
**Scope:** Catalog product card + its full-detail quick-view modal (`src/storefront/components/Catalog.tsx`). The Two-Ways home / group-buy rows (`TwoWaysHome.tsx`) were **deliberately left unchanged** — the owner chose "Card + detail modal" only.

## Source plan

No `*.plan.md` was supplied. Journeys were derived during this TDD run from the request:

> "when the products have variation just show the name of the variation in the product card when variation is clicked thats just the time it will show its price"

## User journeys

1. As a customer browsing the catalog, when a product has variations, the option pills show only the variation **names** (no price), so the card stays clean.
2. As a customer, I see **no price** on a variation product until I click an option — the price then shown always names the option I chose.
3. As a customer, clicking a variation pill reveals **exactly that option's** price.
4. As a customer, I cannot add a variation product to the cart until I've picked an option (the CTA reads "Select an option" and is disabled).
5. As a customer viewing a single-price product (no variations), nothing changes — the price shows immediately and Add to Cart works.

## Task report

**Behavior:** a variation product reveals its price only after an option pill is clicked; the pills show names only. Single-price products are untouched.

- **New pure helper** `resolveSelectedPrice(product, selectedIndex)` in `src/lib/storefront/variations.ts` — returns the base price when the product has no options, `null` when it has options but none is picked (index `< 0` or past the end), and the chosen option's price otherwise. This is the source of truth for the reveal rule.
- **`ProductCard`** — option state now initializes to `-1` (nothing selected); pills render `{o.name}` instead of `optionLabel(...)`; the price area shows "Select an option" while `resolveSelectedPrice` is `null`; the Add-to-Cart CTA is disabled and reads "Select an option" until a pick.
- **`ProductDetailModal`** — same treatment (init `-1`, name-only pills, "Select an option" price + CTA), keeping the modal consistent with the card it opened from.
- `optionLabel` is retained (unchanged) because `TwoWaysHome.tsx` still uses inline name · price on its rows.

**Validation command:** `npm run test:variation-price-reveal`

**RED (before implementation):** helper did not exist and the component was not wired.

```
resolveSelectedPrice
  ✗ a single-price product always shows its base price (index ignored) — (0 , import_variations.resolveSelectedPrice) is not a function
  ✗ a variation product shows NO price until an option is picked (idx < 0 → null) — ... is not a function
  ✗ picking an option reveals exactly that option's price — ... is not a function
  ✗ an index past the end of the option list is treated as no selection — ... is not a function
  ✗ stays null for a variation product regardless of its base price — ... is not a function
Catalog.tsx card + modal
  ✗ the card + modal consume resolveSelectedPrice — Catalog.tsx never calls resolveSelectedPrice
  ✗ both option pickers start with nothing selected (useState(-1)) — expected the card AND modal to init optIdx to -1 (found 0)
  ✗ option pills no longer render optionLabel (name · price) — Catalog.tsx still calls optionLabel
  ✗ the CTA blocks purchase until an option is picked (Select an option) — no 'Select an option' affordance

0 passed, 9 failed
```

**GREEN (after implementation):**

```
9 passed, 0 failed
```

**What is guaranteed:** a variation product shows no price until a pill is clicked; the pill shows the name only; the revealed price is exactly the chosen option's; buying is blocked until a pick; single-price products keep their immediate price.

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | Single-price product always resolves to its base price (index ignored) | `scripts/test-variation-price-reveal.ts` → resolveSelectedPrice | unit | PASS | `npm run test:variation-price-reveal` |
| 2 | Variation product resolves to `null` (no price) when nothing is picked | same → resolveSelectedPrice | unit | PASS | same |
| 3 | Picking an option resolves to exactly that option's price | same → resolveSelectedPrice | unit | PASS | same |
| 4 | An index past the end of the option list counts as "no selection" | same → resolveSelectedPrice | unit | PASS | same |
| 5 | Card + modal actually call `resolveSelectedPrice` | same → Catalog.tsx guard | structural | PASS | same |
| 6 | Both pickers start with nothing selected (`useState(-1)`) | same → Catalog.tsx guard | structural | PASS | same |
| 7 | Pills no longer render `optionLabel` (name · price) | same → Catalog.tsx guard | structural | PASS | same |
| 8 | Purchase is blocked until a pick ("Select an option" present) | same → Catalog.tsx guard | structural | PASS | same |

## Coverage and known gaps

- This repo has no coverage instrument; tests are self-contained `tsx` assertion scripts. `resolveSelectedPrice`'s four branches (no-options / idx<0 / valid / past-end) are all exercised.
- Component behavior is covered structurally (the project has no React renderer in its test harness); the wiring assertions guard against regression of the four component-level rules.
- Regression sweep — all pass, no behavior drift: `test:product-variations` (30), `test:product-detail` (20), `test:variant-inventory` (33), `test:two-ways` (18), `test:two-ways-home` (14), `test:price-font`, `test:cart` (15), `test:catalog-sort` (20), `test:kglow-pricelist`, `test:checkout-total` (13).
- `npx tsc --noEmit` is clean for `Catalog.tsx` and `variations.ts`.
- **Out of scope by owner decision:** `TwoWaysHome.tsx` still shows name · price inline.

## Checkpoint / merge evidence

No git checkpoint commits were created: the working tree carried unrelated uncommitted changes from concurrent sessions (`Header.tsx`, `BrandTweaksForm.tsx`, `types.ts`, `subscription-info.ts`, a `test:header-logo` package.json line), and the user did not request a commit. RED/GREEN evidence is preserved in this report instead. Files changed by this task: `src/lib/storefront/variations.ts`, `src/storefront/components/Catalog.tsx`, `scripts/test-variation-price-reveal.ts`, `package.json` (one script line).
