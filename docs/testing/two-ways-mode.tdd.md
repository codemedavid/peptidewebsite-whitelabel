# TDD evidence — per-way management of the "two ways to order" storefront

**Source plan**: inline `/ecc:plan` output in-session (no `*.plan.md` artifact was written).
**Branch**: `feat/gb-pricing-tab`
**Date**: 2026-08-03

## The ask

> "we have a tenant dragon peptide that wants groupbuy only so for our 2 way onhand
> and groupbuy we need a management where in to open or close the onhand or groupbuy
> or remove the onhand or groupbuy in the website storefront just to view one way to order"

Two axes were requested — **open/close** and **remove** — so each order path carries
one of three states:

| State | Storefront |
|---|---|
| `open` | today's behaviour: shown and buyable |
| `closed` | shown and marked closed; nothing addable to cart or checkoutable |
| `hidden` ("Removed" in the admin) | gone from the storefront; the store reads as a one-way store |

## User journeys

1. As a store owner selling group buys only, I want to remove the on-hand path from
   my storefront, so shoppers see one way to order.
2. As a store owner, I want to close a path temporarily without deleting it, so a
   seasonal pause is visible and explained rather than looking broken.
3. As a shopper, I must not be able to add — or check out — an item from a path the
   store isn't selling, even from a stale tab or a direct link.
4. As a platform operator, I must never be able to leave a store with no way to buy.
5. As a tenant that never touches this setting, my storefront must not change at all.

## Task report

| # | Task | RED evidence | GREEN evidence |
|---|---|---|---|
| 1 | Pure per-way core (`src/lib/storefront/two-ways-mode.ts`) | `npm run test:two-ways-mode` → `MODULE_NOT_FOUND` (commit `b2ecdb8`) | 39 passed, 0 failed (commit `5a25e43`) |
| 2 | Home view-model honours the mode (`two-ways-home.ts`) | `npm run test:two-ways-home` → 21 passed, **7 failed** (`e66da33`) | 28 passed, 0 failed (`ad4c284`) |
| 3 | Checkout gate (`on-hand-gate.ts`) | `npm run test:onhand-gate` → 13 passed, **11 failed** (`40f0eba`) | 24 passed, 0 failed (`50150b8`) |
| 4 | Server resolution + header/home rendering | `npm run test:two-ways-home` → 29 passed, **2 failed** (`764e02e`) | 31 passed, 0 failed (`0109900`) |
| 5 | Cart gate + `#groupbuy` route guard | `npm run test:two-ways-mode` → 39 passed, **2 failed** (`4e8f9f0`) | 41 passed, 0 failed (`c64b51b`) |
| 6 | Owner admin control + server action | `npm run test:two-ways-mode` → 41 passed, **2 failed** (`ab6cd9c`) | 43 passed, 0 failed (`db5f847`) |
| 7 | Operator script | n/a (no behaviour of its own; reuses the tested normalizer) | `npx tsc --noEmit` clean (`629bcdf`) |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Absent / junk / partial `branding.config.twoWaysMode` leaves both ways open, so no existing tenant moves | `test-two-ways-mode.ts` — normalize block | unit | PASS |
| 2 | Hiding **both** ways is refused and falls back to both-open | `test-two-ways-mode.ts` "hiding BOTH ways is refused" | unit | PASS |
| 3 | Closing both ways *is* allowed (a visibly paused store) | `test-two-ways-mode.ts` "closing both ways is allowed" | unit | PASS |
| 4 | The legacy live-round rule (`groupBuyAllowOnHand`) still closes on-hand, and never re-opens a way the owner shut | `test-two-ways-mode.ts` — `resolveWays` block | unit | PASS |
| 5 | `closed` and `hidden` are equally unbuyable and share one shopper-facing message that never leaks the internal state word | `test-two-ways-mode.ts` — buyability + block-message blocks | unit | PASS |
| 6 | A one-way store's heading never says "two" | `test-two-ways-mode.ts` `waysHeading` | unit | PASS |
| 7 | A hidden on-hand way empties the shelf; a closed one still lists it with every row unbuyable | `test-two-ways-home.ts` | unit | PASS |
| 8 | An out-of-stock line is unbuyable even while the way is open | `test-two-ways-home.ts` | unit | PASS |
| 9 | **Hiding the group-buy way does not spill the round's pre-orders onto the ships-now shelf** | `test-two-ways-home.ts` (+ the page-source anchor below) | unit | PASS |
| 10 | The storefront page never deletes `brand.groupBuyBanner` to hide the way | `test-two-ways-home.ts` wiring check | wiring | PASS |
| 11 | The header drops the "Group Buy" nav item when the way is hidden | `test-two-ways-home.ts` wiring check | wiring | PASS |
| 12 | Checkout refuses on-hand items for a group-buy-only store **with or without a live round** | `test-onhand-gate.ts` | integration | PASS |
| 13 | The gate FAILS CLOSED when it can't be evaluated while a way is shut | `test-onhand-gate.ts` | integration | PASS |
| 14 | An untouched config still costs **zero** DB reads at checkout | `test-onhand-gate.ts` spy-deps check | integration | PASS |
| 15 | Losing the Group Buy module leaves the mode unenforced rather than walling the store | `test-onhand-gate.ts` | integration | PASS |
| 16 | The legacy live-round block keeps its own per-product message | `test-onhand-gate.ts` | integration | PASS |
| 17 | The cart refuses adds from a way that isn't selling (same function the server runs) | `test-two-ways-mode.ts` wiring check on `store.tsx` | wiring | PASS |
| 18 | `#groupbuy` is not served when the way is hidden, including by direct link | `test-two-ways-mode.ts` wiring check on `StorefrontApp.tsx` | wiring | PASS |
| 19 | A gated server action persists the setting and re-normalizes it | `test-two-ways-mode.ts` wiring check on `actions/group-buys.ts` | wiring | PASS |
| 20 | The owner can manage both ways from Store Admin → Group Buys | `test-two-ways-mode.ts` wiring check on `AdminGroupBuys.tsx` | wiring | PASS |

### Commands actually run

```
npm run test:two-ways-mode     PASS (43 checks)
npm run test:two-ways-home     31 passed, 0 failed
npm run test:two-ways          18 passed, 0 failed
npm run test:two-ways-cart     20 passed, 0 failed
npm run test:onhand-gate       24 passed, 0 failed
npm run test:onhand-order      PASS
npm run test:group-buy-page    37 passed, 0 failed
npm run test:stock-gate        41 passed, 0 failed
npm run test:tenant-presets    46 passed, 0 failed
npm run test:gb-banner         10 passed, 0 failed
npm run test:gb-rounds         13 passed, 0 failed
npm run test:cart              15 passed, 0 failed
npm run test:product-cta       31 passed, 0 failed
npx tsc --noEmit               clean
```

## Design note — the trap this pinned shut

The obvious way to hide the group-buy path is to drop `brand.groupBuyBanner`
server-side. That is wrong, and tests #9/#10 exist to keep it wrong-proof: the banner
is what tells the home which products belong to the live round. Without it those
products stop being "in the round" and return to the ships-now shelf **at their
on-hand price with the wrong ship date**. The banner stays; the components gate on
the way state instead.

## Coverage and known gaps

- Every new pure function is covered. The React surfaces (`TwoWaysHome`,
  `Header`, `StorefrontApp`, `AdminGroupBuys`, `store.tsx`) are covered by
  source-level wiring anchors, matching this repo's existing convention — there is
  no component-test harness in the project.
- **No visual regression / Playwright pass was run.** The three storefront states
  (both ways, on-hand removed, on-hand closed) have not been screenshotted.
- **Not applied to dragon-peptides.** Verified read-only against the live DB:
  the tenant exists (`slug: dragon-peptides`) but has `homeLayout: undefined`,
  `twoWaysMode: undefined`, **no group-buy feature overrides and no group-buy plan
  features** — i.e. no Group Buy module and a classic (not two-ways) home. Setting
  `twoWaysMode` today would be a deliberate no-op, since both the storefront and the
  checkout gate leave it unenforced without the module. Making it live needs three
  operator decisions, none of which were taken here: grant the Group Buy module,
  grant `GB_TWO_WAYS_HOME` and set `homeLayout: "two-ways"`, then run
  `npx tsx scripts/configure-two-ways-mode.ts dragon-peptides hidden open`.

## Merge evidence

If these commits are squashed, the RED → GREEN pairs above are the record:
`b2ecdb8`→`5a25e43`, `e66da33`→`ad4c284`, `40f0eba`→`50150b8`,
`764e02e`→`0109900`, `4e8f9f0`→`c64b51b`, `ab6cd9c`→`db5f847`, plus `629bcdf`.
