# TDD Evidence — GB Storefront Banner + "Explore GB #N" Scope Toggle (Phase 6c)

**Source plan:** ported access-gate + Group Buy spec — storefront surfacing of the live round. Companion docs: `gb-rounds-access-code.tdd.md`, `gate-heartbeat.tdd.md`.

## User journey

> As a store visitor, I want to see when a group buy is live and be able to
> filter the catalog to just that round's products, so I can shop the round
> without wading through the rest of the catalog — while still being free to
> browse everything by default.

## Design constraints

- The scope toggle **defaults OFF** — the normal experience is the full catalog.
- The filter is **presentation only**. It narrows what is *shown*; it never changes what can be *bought*. Buyability stays owned by the on-hand gate (`isOnHandBlocked` in the card + `evaluateOnHandGate` on the server).
- When the live round covers the whole catalog (no product assignment, or the tenant lacks the `productAssignment` capability), the toggle is meaningless and is hidden.

## Task report

| Task | Summary | Command | Result |
|---|---|---|---|
| RED | Reproducer for `buildGroupBuyBanner` + `scopedCatalog`; module absent | `npm run test:gb-banner` | FAIL — `Cannot find module '../src/lib/storefront/group-buy-banner'` (compile-time RED, commit `062bb0e`) |
| GREEN core | Pure banner + scope-filter | `npm run test:gb-banner` | PASS 10/10 (commit `719ba52`) |
| GREEN wiring | Brand field, page.tsx compute, banner UI, StorefrontApp scope state | `npx tsc --noEmit` / gb suites | 0 errors / gb-banner 10, gb-rounds 13, gb-report 11, plan-scope 19 (commit `e5da568`) |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | No live round → null banner | `test-gb-banner.ts` | unit | PASS |
| 2 | A live assigned round → banner scoped to its products (`coversAll` false) | `test-gb-banner.ts` | unit | PASS |
| 3 | Live round with no assignment → `coversAll` true (whole catalog) | `test-gb-banner.ts` | unit | PASS |
| 4 | Without the `productAssignment` capability → `coversAll` true | `test-gb-banner.ts` | unit | PASS |
| 5 | A round whose window has lapsed (effectively closed) → null | `test-gb-banner.ts` | unit | PASS |
| 6 | No banner → full catalog regardless of the toggle | `test-gb-banner.ts` | unit | PASS |
| 7 | Toggle OFF (default) → full catalog | `test-gb-banner.ts` | unit | PASS |
| 8 | Toggle ON with an assigned round → only the round's products | `test-gb-banner.ts` | unit | PASS |
| 9 | Toggle ON but the round covers the whole catalog → no-op | `test-gb-banner.ts` | unit | PASS |
| 10 | `scopedCatalog` never mutates its input array | `test-gb-banner.ts` | unit | PASS |

## Known gaps

- The banner component (`GroupBuyBanner.tsx`) and the `gbScope` wiring in `StorefrontApp` are presentational — covered by the pure `buildGroupBuyBanner` / `scopedCatalog` core and `tsc`, not by a DOM test (no jsdom/Playwright harness in this repo). All logic that decides *what shows* is unit-tested; the untested part is JSX and one `useState`.
