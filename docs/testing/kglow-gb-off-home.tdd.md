# TDD evidence — an open group buy never shares the home page with on-hand (k-glow)

**Branch:** `feat/gb-pricing-tab` · **Date:** 2026-07-30
**Commits:** `020f9d4` (RED) → `ac79789` (GREEN)

## Source plan

No `*.plan.md`. Journeys were derived during this TDD run from the request:

> "for the tenant kglow if theres an open groupbuy it should not be in the same page as the onhand"

**Clarified with the owner before writing tests.** Three splits were offered; the
owner chose **"GB leaves the home"**:

| | HOME (round open) | `#groupbuy` page |
|---|---|---|
| | hero, two-way cards, **on-hand shelf**, GB *teaser*, how-it-works | round banner, countdown/slots, **GB product list**, checkout bar |

## User journeys

1. As a K Glow shopper, when a round is open I want the home to show only what
   ships today, so the shelf I'm browsing has one fulfilment promise.
2. As a K Glow shopper, I want the open round still advertised on the home
   (name, countdown, slots, item count) with one tap to its own page, so I don't
   miss it.
3. As the store owner, I want a shopper unable to build a mixed on-hand +
   group-buy cart from a single screen, since such an order is rejected at
   placement (`two-ways-cart.ts` `twoWaysOrderViolation`).

## Task report

### Task 1 — the home view-model stops carrying the round's products

`buildTwoWaysHomeView` returned `gb.lines: GbHomeLine[]` (each product priced
regular-vs-gb with a save badge). It now returns `gb.productIds: string[]` +
`gb.count`; the `GbHomeLine` type is replaced by `GbHomeTeaser`. On-hand
membership is unchanged — a product in the live round's scope leaves the on-hand
shelf, exactly as before, so nothing lands in both lists.

- **Validation command:** `npm run test:two-ways-home`
- **RED:** `16 passed, 4 failed` — `✗ a live round contributes NO product lines to the home view — the home must not carry group-buy product lines`
- **GREEN:** `19 passed, 0 failed`

### Task 2 — the component stops rendering the round's item rows

`TwoWaysHome.tsx`: the `<ul className="sf-twh__gb-items">` block and the
`GbItemRow` component (name, gb price, save badge, variation picker, Join /
stepper) are removed, along with their now-dead CSS
(`sf-twh__gb-item*`, `gb-add`, `gb-save`, `opts--gb`, `incart--gb`, `stepper--gb`).
The pink round card keeps its pill, countdown, name, terms and slot bar, and
gains a `sf-twh__gb-count` line ("12 items in this round — browse them on the
group buy page"). The existing CTA (`groupBuyCtaTarget`) and the "Group Buy ·
Open now" way card already routed to `#groupbuy`; both are retained, so the
round is never a dead end. The on-hand empty state no longer says "check the
group buy above".

- **Validation command:** `npm run test:two-ways-home` (source assertion)
- **RED:** `✗ TwoWaysHome renders no group-buy item rows and routes to the group-buy page — the home must not render a group-buy item list`
- **GREEN:** pass

### Task 3 — the home and the group-buy page still agree on the round

The cross-check in `scripts/test-group-buy-page.ts` (which caught the historical
"open on the home, empty on the page" bug) compared `page.lines` against
`home.gb.lines`. It now compares against `home.gb.productIds` — the same
invariant, expressed through the surviving field.

- **Validation command:** `npm run test:group-buy-page`
- **GREEN:** `29 passed, 0 failed`

### Obsolete assertions retired

Three home tests pinned the behavior the owner changed:

- *"scoped round routes assigned products to group buy, rest on-hand"* → rewritten
  as **"scoped round claims assigned products, rest stay on-hand"** (asserts
  `onHand` ids + `gb.productIds`).
- *"scoped round narrows the group-buy list to assigned products"* → rewritten as
  **"scoped round claims only assigned products, even among gb-tagged ones"**
  (also asserts the out-of-round gb-tagged product stays on-hand).
- *"group-buy line surfaces regular vs gb price and the saving"* → **deleted**;
  per-item GB pricing is no longer a home concern and is already pinned by
  `test:group-buy-page` → *"each line exposes gb price, regular price and the
  saving, all labelled"*. A comment in the home gate points there.

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | A live round contributes no product lines to the home view-model | `scripts/test-two-ways-home.ts:a live round contributes NO product lines to the home view` | unit | PASS | `npm run test:two-ways-home` |
| 2 | The round's products are absent from the home's on-hand shelf too (in no list at all) | `scripts/test-two-ways-home.ts:the round's products are absent from the home's on-hand shelf too` | unit | PASS | same |
| 3 | The home still reports the round's ids + count for the teaser | `scripts/test-two-ways-home.ts:the home still names the round's products so the page cross-check holds` | unit | PASS | same |
| 4 | A catalog-wide round empties the on-hand shelf and the home still lists nothing itself | `scripts/test-two-ways-home.ts:a catalog-wide round empties the home's on-hand shelf, listing nothing itself` | unit | PASS | same |
| 5 | The home keeps the round chrome (open, name, countdown, ETA, slot %) | `scripts/test-two-ways-home.ts:the home keeps the round chrome so the teaser can link to the group-buy page` | unit | PASS | same |
| 6 | The component renders no GB item rows and routes to `#groupbuy` | `scripts/test-two-ways-home.ts:TwoWaysHome renders no group-buy item rows and routes to the group-buy page` | wiring | PASS | same |
| 7 | A gb-tagged product outside the round stays on the on-hand shelf (round, not tag, is membership) | `scripts/test-two-ways-home.ts:scoped round claims only assigned products, even among gb-tagged ones` | unit | PASS | same |
| 8 | The home and the group-buy page agree on round membership | `scripts/test-group-buy-page.ts:the page and the two-ways home agree on which products are in the round` | integration | PASS | `npm run test:group-buy-page` |

## Regression gates run

| Gate | Result |
|---|---|
| `npm run test:two-ways-home` | 19 passed, 0 failed |
| `npm run test:group-buy-page` | 29 passed, 0 failed |
| `npm run test:two-ways` | 18 passed, 0 failed |
| `npm run test:two-ways-cart` | 20 passed, 0 failed |
| `npm run test:onhand-order` | PASS |
| `npm run test:default-product-image` | 19 passed, 0 failed |
| `npm run test:kglow-pricelist` | PASS |
| `npx tsc --noEmit` | `src/` clean |

## Coverage and known gaps

- No coverage tool is configured in this repo; the gates above are the project's
  standard evidence form (hand-rolled `check()` scripts under `scripts/`).
- **No browser/visual check was run.** The rendered home at
  `k-glow.lvh.me:3100` has not been re-screenshotted since the GB card lost its
  item rows. Worth a look before shipping — the pink card is now noticeably
  shorter.
- **No config or DB change was needed.** The rule applies to the two-ways home
  layout itself (`brand.homeLayout === "two-ways"`), which today is granted only
  to `k-glow` via `groupbuy.two_ways_home`. No tenant slug is hardcoded — any
  future tenant granted the layout inherits the same split.
- `npx tsc --noEmit` also reports a pre-existing error in the untracked
  `scripts/kglow-test-gb.ts` (a concurrent session's file) and in
  `scripts/test-two-ways.ts:176`; both predate this work and live outside the
  Next build.

## Merge evidence

If these commits are squashed, preserve:

- **RED** (`020f9d4`, `npm run test:two-ways-home`): 16 passed, **4 failed** —
  the home carried `gb.lines` and `TwoWaysHome.tsx` rendered `sf-twh__gb-items`.
- **GREEN** (`ac79789`, same command): **19 passed, 0 failed**, with six new
  guarantees and seven neighbouring gates green.
- **Refactor:** folded into the GREEN commit — dead `GbItemRow` + GB-item CSS
  removed, unused imports (`unitPrice`, `makeVariationEntry`, `gbScopeFromBanner`,
  `GroupBuyPriceScope`) dropped, module header comments rewritten to the new rule.
