# TDD Evidence — K Glow "Two ways to order" (on-hand + group buy)

**Task:** Apply the `K Glow Store.dc.html` design to the `kglow` tenant, which needs
two ordering paths — **on-hand** (ships now) and **group buy** (live round, lower
prices). Plus: the store owner can **edit the slot-goal or turn it off** per round.

**Source:** journeys derived during this TDD run from the imported Claude Design
project `b7f87052-1e4d-4a30-8445-1c364e2a8599` (`K Glow Store.dc.html`) and the
user's confirmed scope: Group Buy MODULE round + per-product `gbPrice`, full K Glow
theme, editable/off slot-goal progress bar.

## User journeys

1. As a shopper, I see the catalog split into **On-Hand** (ships now) and **Group
   Buy** (each item shows the on-hand price, the GB price, and the saving).
2. As a shopper, when a group buy is live I see a slot-goal progress bar ("18 of 30
   slots · 60%") — unless the owner turned the goal off.
3. As a store owner, I tag a product as a **Group Buy product** and set its GB price.
4. As a store owner, I **set or clear the slot goal** on a round; clearing it hides
   the progress bar.
5. As the operator, I apply the **K Glow** theme to the kglow tenant.

## Task report

| Behavior | Validation command | RED → GREEN | Guarantee |
|---|---|---|---|
| Catalog split, GB pricing, slot progress (pure core) | `npm run test:two-ways` | RED: `Cannot find module '../src/lib/storefront/two-ways'` → GREEN: 18 passed | `splitTwoWays`/`groupBuyLine`/`slotProgress`/`isGroupBuyProduct` behave per spec incl. edge cases |
| Round + banner carry an editable slot goal | `npm run test:two-ways` | same RED (compile) → GREEN | `normalizeGroupBuy` defaults 0, floors positives, coerces invalid→0; `buildGroupBuyBanner` surfaces `slotGoal` |
| No regression to existing GB logic | `npm run test:gb-banner` (10✓), `test:gb-rounds` (13✓), `test:gb-report` (12✓), `test:gb-ratio` (19✓) | GREEN | slotGoal additions are additive |
| K Glow theme is accessible | `npm run test:themes` | `✓ kglow  [light/fun]`, PASS — 0 critical | WCAG-AA body/UI pairs clear for the K Glow palette |
| Whole project typechecks | `npx tsc --noEmit` | 0 errors | all new fields/types wire cleanly |

### RED evidence (Step 3)
```
> npm run test:two-ways
Error: Cannot find module '../src/lib/storefront/two-ways'
```
Valid compile-time RED: the test references the not-yet-created module; failure is
the intended missing implementation, not unrelated breakage.

### GREEN evidence (Step 5)
```
> npm run test:two-ways
18 passed, 0 failed
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | `productType "gb"` classifies as group-buy; else on-hand | `test-two-ways.ts:isGroupBuyProduct` | unit | PASS |
| 2 | GB price below list → correct saving; absent/0/≥list → no phantom saving | `test-two-ways.ts:groupBuyLine` | unit | PASS |
| 3 | Catalog splits into on-hand + GB lines, order preserved, input not mutated, product identity kept | `test-two-ways.ts:splitTwoWays` | unit | PASS |
| 4 | Slot bar off when goal ≤ 0; 18/30 → 60%; over-fill capped 100%; filled clamped/floored | `test-two-ways.ts:slotProgress` | unit | PASS |
| 5 | `normalizeGroupBuy.slotGoal` defaults 0, floors, coerces invalid→0 | `test-two-ways.ts:GroupBuy slot goal` | unit | PASS |
| 6 | Live banner surfaces the round's `slotGoal` | `test-two-ways.ts:buildGroupBuyBanner` | unit | PASS |

## Shipped in this run

- `src/lib/storefront/two-ways.ts` — pure core (split / GB pricing / slot progress).
- `slotGoal` on the Group Buy round: `group-buy.ts` (type, `normalizeGroupBuy`,
  `DbGroupBuyRow`, `dbGroupBuyToStorefront`, `groupBuyToDbWrite`),
  `group-buy-banner.ts` (banner field + build), `prisma/schema.prisma`
  (`slotGoal Int @default(0)`), Prisma client regenerated.
- Admin **Group Buys** modal: editable "Slot goal" number input; blank = 0 = off
  (turns the progress bar off) → flows through `saveGroupBuyAction`.
- Admin **Add/Edit Product**: "Group Buy product" toggle + "Group Buy Price"; wired
  into `normalizeProductInput` (the whitelist that previously dropped these) so they
  persist to product metadata.
- **K Glow** theme preset (pink `#C21E6C`, Playfair Display + DM Sans, 1rem radius),
  AA-verified.

## Known gaps / follow-ups (NOT done in this run)

- **Storefront render** — the actual two-section K Glow layout component (On-Hand
  list + Group Buy card with countdown from `endsAt`, delivery ETA, `slotProgress`
  bar, per-item regular-vs-GB pricing, join CTA) and its `storefront.css`, wired into
  `StorefrontApp` behind a brand flag, with `page.tsx` computing `filled` = count of
  orders attributed to the live round. `two-ways.ts` is built and tested to drive it.
- **Font loading** — ensure Playfair Display + DM Sans feed the storefront
  `googleFontsUrl` (see memory `storefront-font-loading`), else text falls back.
- **Live DB** — run `npm run db:push` to add the `group_buys.slotGoal` column on the
  live DB (see memory `live-db-state`); until then writes with a goal will error there.

## Checkpoint note

The working tree carried unrelated in-progress work (subscription-payments) and a
pre-modified `package.json`, so per the concurrent-session git hazard, RED/GREEN were
validated by test runs rather than sweeping checkpoint commits. The pre-existing
`test:onhand-gate` failure (1 of 9) was verified present on the committed baseline
(stash-check) and is unrelated to this change.
