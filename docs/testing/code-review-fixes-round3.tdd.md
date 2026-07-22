# TDD Evidence — code-review round-3 fixes

**Source plan:** none — journeys derived from the `/code-review` findings reported
in this session (8 findings, ranked most-severe first). RED commit `97f5828`,
GREEN commit `202b646`.

## User journeys

1. As a store owner *without* the Reseller portal, my product edits leave the
   DB's dormant wholesale data untouched, so re-granting the feature restores
   prices exactly.
2. As a store owner running a *coversAll* group-buy round, my on-hand products
   keep their stock caps — a catalog-wide round never lets customers oversell
   physical stock.
3. As an operator, a failed subscription-window save surfaces an error (or an
   explicit "saved without the price" notice) instead of silently dropping the
   Monthly price due behind an ok.
4. As a shopper on an unentitled store, a mid-session catalog refresh never
   resurrects wholesale prices that checkout will re-price away.
5. As an operator, the "two ways to order" home is grantable only by me — a
   tenant-writable config key can't self-enable the paid feature.
6. As a shopper on the two-ways home, I pick a size for variation products and
   am charged that option's price (same as the classic catalog).
7. As a shopper on the GB page, the sticky bar's total matches what checkout
   charges — variation entries included.
8. (Cleanup) The tenant gate module stays the single owner of the bounce rules.

## Task report

| Finding | Fix | RED evidence | GREEN evidence |
|---|---|---|---|
| Reseller wipe via product edit | `preserveResellerMetadata` in `reseller-gate.ts`; wired into `saveProductAction` (update: existing row's `metadata.reseller` preserved when unentitled; create: incoming leg dropped) | `test:reseller-gate` — 6 failed (missing export + 2 wiring checks) | `test:reseller-gate` 14 passed |
| coversAll stock bypass | `isGroupBuyPreorder(product, scope)` — coversAll exempts only `productType === "gb"` (mirrors `unitPrice`); explicit assignment still wins; callers in `store.tsx` + `orders.ts` pass the product | `test:two-ways-cart` — 3 failed ("coversAll on-hand keeps its stock cap" et al.) | `test:two-ways-cart` 20 passed |
| Silent price drop on window save | `writeSubscriptionWindow` retries only on missing-column errors (P2022 or "column … does not exist"); `setSubscriptionWindowAction` returns `status: "without-price"`, `TenantDetailView` shows a notice | `test:subscription-window` — 1 failed ("transient first failure must NOT silently drop the price") | `test:subscription-window` 6 passed |
| Refresh action misses reseller strip | `getStorefrontProductsAction` strips via the same `stripResellerPricing` + `STORE_RESELLER_PORTAL` gate (demo + DB paths) | wiring check in `test:reseller-gate` failed | wiring check passes |
| homeLayout entitlement bypass | `resolveHomeLayout`: unentitled → always "classic"; config can only opt out; stale `types.ts` comment fixed | `test:two-ways-home` — "config alone must NOT bypass the grant" failed | `test:two-ways-home` 14 passed |
| Two-ways home drops variation picker | `OnHandRow` / `GbItemRow` components with `buildProductOptions` / `shouldShowOptionPicker` / `optionLabel`; GB options priced via checkout's `unitPrice` on the variation clone; option products use Add + "n in cart" (no base-id stepper) | source-wiring check in `test:two-ways-home` failed | wiring check passes; `tsc` clean on `src/` |
| Cart-bar total mispriced variations | `groupBuyCartSummary(lines, entries, currency)` — per-unit `{id, unit, regular}` entries priced by the caller with `unitPrice` (GroupBuyPage.tsx) | `test:group-buy-page` — 3 failed (entries API) | `test:group-buy-page` 29 passed |
| Dead null-tenant fallback | `getTenantId` bounces on `storefrontBouncePath` alone; comment documents the gate-owned invariant | behavior-preserving — covered by existing `test:tenant-unavailable` | `test:tenant-unavailable` 10 passed |

## Validation commands actually run

```
npm run test:two-ways-cart        # RED 17/3 → GREEN 20/0
npm run test:subscription-window  # RED 5/1  → GREEN 6/0
npm run test:two-ways-home        # RED 12/2 → GREEN 14/0
npm run test:reseller-gate        # RED 8/6  → GREEN 14/0
npm run test:group-buy-page       # RED 26/3 → GREEN 29/0
# regressions (all green, unchanged):
npm run test:two-ways             # 18/0
npm run test:group-buy-pricing    # 18/0
npm run test:tenant-unavailable   # 10/0
npm run test:tenant-suspend       # 21/0
npx tsc --noEmit                  # src/ clean; 3 pre-existing errors in one-off
                                  # scripts (fix-pepstack-reseller.ts,
                                  # remove-reseller-data.ts, untracked rebrand script)
```

## Coverage and known gaps

- The repo's harness is pure-core tsx scripts (no coverage tooling) — coverage
  percentages aren't measurable here; every changed pure function is exercised
  by the suites above.
- The TwoWaysHome picker is verified by type-check + source-wiring assertions,
  not a DOM test (no component test runner in the repo). Visual check in the
  browser recommended before deploy.
- Behavior notes: under a *coversAll* round, untagged (on-hand) products now
  keep stock caps AND still appear in the GB card at their regular price —
  pricing and stock now agree; mixing on-hand/GB in one cart under coversAll
  remains allowed (unchanged, since the round nominally covers everything).
- Demo-mode `saveProductAction` doesn't apply the reseller preserve (fixture
  data, no dormant wholesale data to protect).
- An entitled tenant's save still trusts the incoming reseller leg (unchanged,
  intended — that's the editing surface).
