# TDD evidence — two-ways cart rules (GB pre-order stock exemption + no mixed carts)

**Date:** 2026-07-22 · **Branch:** main · **Commits:** `b4487e2` (RED) → `b00bd87` (GREEN)

## Source plan

No `*.plan.md` — journeys derived during this TDD run from the user report:
"Join GB" on k-glow's Group buy pricing page (GHK-cu 100mg ₱700, Tirzepatide
15mg ₱850, Tirzepatide 30mg ₱1,050) did nothing, plus the requirement that
on-hand and group-buy products must never share a cart.

## Root cause (verified against the live DB)

The k-glow tenant's live round "june gb" covers exactly those 3 products — and
all three carry `stock: 0`. `addToCart` (store.tsx) capped every add at stock,
so each "Join GB" click silently bailed with an "out of stock" toast. The server
(`stockViolation` in actions/orders.ts) would have rejected the order the same
way. Group-buy items are pre-orders — the supplier order is placed after the
round closes — so on-hand stock must not gate them.

## User journeys

1. As a shopper, "Join GB" adds a live-round product to my cart even when its
   on-hand stock is 0, so I can join the round.
2. As a shopper, I can't mix on-hand (ships now) and group-buy (ships after
   close) items in one cart — each order stays one fulfilment path.
3. As the store, checkout re-enforces both rules server-side so a stale or
   tampered client can't bypass them.

## What changed

- **`src/lib/storefront/two-ways-cart.ts`** (new, pure): `gbScopeFromBanner`,
  `isGroupBuyPreorder` (stock exemption), `twoWaysAddViolation` /
  `twoWaysOrderViolation` (mixing rule), `TWO_WAYS_MIX_MESSAGES`.
- **`src/storefront/store.tsx`** `addToCart`: rejects a mixing add with a toast;
  in-scope round products skip the stock cap entirely.
- **`src/actions/orders.ts`** `placeStorefrontOrderAction` (demo + DB paths):
  `stockViolation` now exempts products inside the round's scope (the same
  `gbScope` `stampGroupBuy` derived server-side for re-pricing);
  `twoWaysOrderViolation` rejects mixed orders. The client banner is only a UX
  hint — the server derives its own scope at placement.

## RED evidence

```
$ npm run test:two-ways-cart        # at b4487e2, before the module existed
Error: Cannot find module '../src/lib/storefront/two-ways-cart'
code: 'MODULE_NOT_FOUND'
```

Intended missing-implementation failure (compile/resolve RED per workflow).

## GREEN evidence

```
$ npm run test:two-ways-cart
18 passed, 0 failed
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Null/absent banner → null scope; scoped/coversAll banners map faithfully | `scripts/test-two-ways-cart.ts` §gbScopeFromBanner (3 cases) | unit | PASS |
| 2 | In-scope product is stock-exempt; out-of-scope keeps the stock gate; no round → nothing exempt; coversAll → all exempt | §isGroupBuyPreorder (4 cases) | unit | PASS |
| 3 | Adding GB into an on-hand cart (and vice versa) is rejected with a message; same-path adds allowed; empty cart, no round, coversAll → rule off | §twoWaysAddViolation (7 cases) | unit | PASS |
| 4 | An order mixing GB and on-hand lines is rejected at placement; single-path orders and no-round orders pass | §twoWaysOrderViolation (4 cases) | unit | PASS |
| 5 | Join GB works end to end on the live page: 3 buttons render, click → qty 1, sticky bar ₱700, + → qty 2 (stock 0 never caps), bar "2 items ₱1,400" | playwright-core script against `k-glow.lvh.me:3100/#groupbuy` | e2e | PASS |

Regression suites after the change: `test:cart` 15/15, `test:two-ways` 18/18,
`test:two-ways-home` 13/13, `test:group-buy-page` 28/28,
`test:group-buy-pricing` 18/18, `test:gb-rounds` 13/13, `test:gb-banner` 10/10.
`tsc --noEmit`: no errors in any changed file.

## Coverage and known gaps

- The repo's test convention is per-feature tsx scripts (no coverage tooling);
  every branch of the new pure module is exercised by the 18 cases above.
- The mixing rule couldn't be exercised live on k-glow (its whole catalog is in
  the round → no on-hand item exists to mix); covered by unit cases 3–4.
- Pre-existing, unrelated: `test:onhand-gate` has one time-bomb fixture
  ("blocks the paused product through the real resolvers") whose round ends at
  a hardcoded 2026-07-17+24h while `evaluateOnHandGate` uses the real clock —
  failing since 2026-07-18. Fix: derive the fixture NOW from `new Date()` or
  thread `now` through `evaluateOnHandGate`.
- Pre-existing: 2 tsc errors in one-off scripts (`fix-pepstack-reseller.ts`,
  `remove-reseller-data.ts`).
- `coversAll` rounds make the entire catalog stock-exempt while live — the
  intended pre-order semantic (demand sizes the supplier order; see the
  supplier report's DEMAND definition in group-buy.ts).

## Merge evidence

Checkpoint commits kept on main (no squash): `b4487e2` RED → `b00bd87` GREEN.
