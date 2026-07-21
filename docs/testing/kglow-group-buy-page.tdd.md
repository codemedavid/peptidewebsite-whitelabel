# K Glow — Group Buy Page (TDD evidence)

**Feature:** The dedicated storefront **Group Buy page** for the `kglow` tenant,
implementing the imported design `Group Buy Page.dc.html` (Claude Design project
`b7f87052-1e4d-4a30-8445-1c364e2a8599`). Route `#groupbuy`, gated on a live round.

**Source plan:** none — journeys derived during this TDD run from the design +
the existing two-ways core ([[kglow-two-ways]]).

## Decision that shaped the build

The design showed each product at its group-buy price with the on-hand price
struck through + a "save ₱X" badge. Checkout is server-authoritative and re-prices
from the regular `price`, **not** `gbPrice` — so advertising savings would be a
"shown-a-price-we-don't-charge" defect. The user chose:

1. **Charge `gbPrice` at checkout** while a round is live (so the shown price is real), and
2. **Do not display the on-hand-vs-GB difference** — one price per product.

Result: the page shows a single price (the `gbPrice`); the cart drawer, the sticky
bar and the server all charge that same price. Display == charge, everywhere.

## User journeys

1. A K Glow customer opens the Group Buy page and sees the live round's status —
   name, "Closes in N days", "18 of 30 slots filled" progress, delivery terms.
2. They see the round's group-buy products at one price each (the price they pay).
3. They Join (add to cart), adjust quantity, and check out at the group price.
4. A "how it works" strip explains the pay-now / ships-after-close flow.

## Task report

| Behavior | Validation | Result |
|---|---|---|
| Pure page core + GB-live pricing | `npm run test:group-buy-page` | **RED** first (module missing), then **GREEN** 21/21 |
| Two-ways core unaffected | `npm run test:two-ways` | GREEN 18/18 |
| Cart pricing (incl. new `groupBuyLive` flag, default off = unchanged) | `npm run test:cart` | GREEN 15/15 |
| Banner (now carries `endsAt`/`filled`) | `npm run test:gb-banner` | GREEN 10/10 |
| GB rounds / on-hand gate literals updated for `slotGoal` | `npm run test:gb-rounds` | GREEN 13/13 |
| Production typecheck | `npx tsc --noEmit` | 0 errors in `src/` (see notes) |

### RED evidence
`npm run test:group-buy-page` → `Error: Cannot find module '../src/lib/storefront/group-buy-page'`
(the intended missing-implementation failure — no production code edited before this).

### GREEN evidence
After implementing `src/lib/storefront/group-buy-page.ts` + the `groupBuyLive`
pricing flag in `src/storefront/checkout.ts`: `21 passed, 0 failed`.

## Test specification

| # | Guarantee | Test | Type | Result |
|---|---|---|---|---|
| 1 | `gbCountdownLabel` → ""/"Closes in N days"/"Closes in 1 day"/"Closed" from `endsAt` | `test-group-buy-page.ts` | unit | PASS |
| 2 | `productInitial` → first letter uppercased, "•" when blank | `test-group-buy-page.ts` | unit | PASS |
| 3 | `formatGbMoney` → "₱1,200", negatives clamped to 0 | `test-group-buy-page.ts` | unit | PASS |
| 4 | `unitPrice(p,q,true)` charges `gbPrice` for a GB product; regular otherwise; invalid gbPrice → regular; on-hand never GB-priced | `test-group-buy-page.ts` | unit | PASS |
| 5 | `cartTotal` / `authoritativeItemPrice` honour the live GB price (server twin) | `test-group-buy-page.ts` | unit | PASS |
| 6 | `buildGroupBuyBanner` surfaces `endsAt`; `filled` defaults 0 | `test-group-buy-page.ts` | unit | PASS |
| 7 | `buildGroupBuyPageView` lists only the round's GB products (scoped/covers-all), priced at gbPrice, with round chrome; null banner → not-live empty shell | `test-group-buy-page.ts` | unit | PASS |

## Wiring (not unit-tested — integration surfaces)

- `src/storefront/pages/GroupBuyPage.tsx` — the page (status banner, product grid,
  how-it-works, sticky checkout bar). White-label via `--brand-*` vars; K Glow's
  pink theme fills them. Empty/not-live state included.
- `StorefrontApp.tsx` — `#groupbuy` route + dynamic import; `visibility.ts` gates
  the route + nav link on `brand.groupBuyBanner`; `Header.tsx` auto-surfaces a
  "Group Buy" nav link while a round is live.
- `orders.ts` — `stampGroupBuy` now runs BEFORE `repriceItems`, which charges
  `gbPrice` when the order is attributed to a live round (both demo + real paths).
- `CartCheckout.tsx` — prices lines with `groupBuyLive = !!brand.groupBuyBanner`.
- `page.tsx` — counts the round's demand orders (`StorefrontOrder.groupBuyId`) into
  `brand.groupBuyBanner.filled` for the slot-progress bar.

## Coverage / known gaps

- **`npm run db:push` still pending** on the live DB for the `slotGoal` column
  ([[live-db-state]]); `endsAt`/`filled` need no schema change (`endsAt` already on
  `GroupBuy`; `filled` is derived from the existing `StorefrontOrder.groupBuyId`).
- **Pre-existing, not introduced here:** `npm run test:onhand-gate` has 1 failing
  assertion and `tsc` flags `test-two-ways.ts:176` (`slotGoal: "abc"` invalid-input
  test). `src/lib/storefront/group-buy.ts` was already `M` at session start; these
  live in `scripts/` (excluded from the Next production build) and are unrelated to
  this feature.
- Playwright/visual regression of the rendered page not run this session.
