# TDD Evidence — Always-Live Cart Pricing

**Date:** 2026-06-28
**Branch:** main
**Source plan:** `/ecc:plan` conversational output (no `.plan.md` file). Request:
> "i want the cart to be updated at all times to avoid the product prices not to be updated once inside the cart"

## Problem

Cart entries were **frozen snapshots** of the product taken at add-time (price,
discount, reseller tier, variation price). If the owner changed a price while a
customer was shopping, the cart kept charging the stale price — and
`placeStorefrontOrderAction` **trusted the client-sent `item.price`**, so the
stale/tampered price was stored verbatim (only shipping, admin fee and discount
were re-derived server-side).

## Decisions (confirmed with user before coding)

- **Price change → always show the live price**, with a subtle "prices updated"
  notice. (Not: reject at checkout; not: keep snapshot.)
- **Catalog refresh → on tab focus/visibility + when the cart/checkout opens.**
  (Not: interval polling; not: no refetch.)

## User Journeys

1. Owner changes a product's price mid-session → cart + checkout show the current price.
2. A variation in the cart tracks the live catalog option price.
3. A product removed/archived after adding → cart line keeps a safe fallback price, never crashes.
4. On placement, the server charges the current catalog price, discarding the client value (anti-stale + anti-tamper).

## What was built

| Layer | File | Change |
|---|---|---|
| Pure core | `src/storefront/checkout.ts` | `resolveLiveProduct`, `liveCartLines`, `authoritativeItemPrice` (additive) |
| Cart UI | `src/storefront/components/CartCheckout.tsx` | Prices from `liveCartLines(cart, products)`; "prices updated" notice; refresh on open |
| Refresh | `src/actions/products.ts` | `getStorefrontProductsAction` — public, tenant-scoped catalog read |
| Refresh | `src/storefront/store.tsx` | `refreshProducts()` + focus/visibility listeners; exposed on the store |
| Server authority | `src/actions/orders.ts` | `repriceItems()` re-prices every line from the live catalog (demo + live branches) before fee/discount stamps |
| Test | `scripts/test-cart-pricing.ts` + `package.json` (`test:cart`) | 15 pure-core tests |

## RED → GREEN

- **RED:** `npm run test:cart` with the three functions absent → **15 failed**
  (`import_checkout.resolveLiveProduct is not a function`, etc.). The failure was
  caused by the intended missing implementation, not unrelated breakage.
- **GREEN:** after implementing the helpers in `checkout.ts` →
  `npm run test:cart` → **15 passed, 0 failed**.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Live catalog price (raised) replaces the snapshot | `test-cart-pricing.ts` resolveLiveProduct | unit | PASS |
| 2 | Live catalog price (lowered) replaces the snapshot | same | unit | PASS |
| 3 | Live discount toggle is reflected in unit price | same | unit | PASS |
| 4 | Live reseller tier is reflected at bulk qty | same | unit | PASS |
| 5 | Variation re-reads the live option price (id/label preserved) | same | unit | PASS |
| 6 | Archived/deleted product falls back to the snapshot (no crash) | same | unit | PASS |
| 7 | Removed variation falls back to the snapshot | same | unit | PASS |
| 8 | Cart totals computed from live catalog; grouping/qty preserved | liveCartLines | unit | PASS |
| 9 | Variation line stays distinct from its base product, re-priced live | liveCartLines | unit | PASS |
| 10 | Server ignores client price, returns catalog price | authoritativeItemPrice | unit | PASS |
| 11 | Server matches by name for legacy lines without productId | same | unit | PASS |
| 12 | Server re-reads live variation price (base id + label) | same | unit | PASS |
| 13 | Server applies live reseller wholesale at bulk qty | same | unit | PASS |
| 14 | Unmatched product → null → caller keeps client price | same | unit | PASS |
| 15 | Removed variation → null → caller keeps client price | same | unit | PASS |

## Validation commands run

```
npm run test:cart              # 15 passed, 0 failed (RED then GREEN)
npm run typecheck              # tsc --noEmit — clean
npx tsx scripts/test-reseller-pricing.ts   # ALL PASSED (no regression in touched checkout.ts)
```

## Coverage / known gaps

- Pure pricing core (the behavior with real money risk) is fully branch-covered by the 15 tests.
- UI wiring (`CartCheckout`, `store.tsx` listeners) and server wiring (`orders.ts` branches) are integration glue exercised via the shared pure functions; this repo has no Next-runtime test harness, matching its existing pure-core script convention (`test:staff`, `test:reseller`, …).
- `npm run build` not run here (needs Prisma + DB env); the session Stop hook / CI covers production build verification.
- Server-side admin-fee validation rule may now reject a checkout when a percentage admin fee changes because items were re-priced — this is the intended "fees changed, please review" guard, unchanged in behavior.
