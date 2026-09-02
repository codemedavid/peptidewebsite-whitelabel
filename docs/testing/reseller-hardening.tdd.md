# TDD evidence — reseller placement, portal hardening, inline media

**Source plan:** the five-phase plan agreed in-session after the `/code-review`
findings (no `*.plan.md` artifact). **Branch:** `main`.
**Commits:** `a320bc6` (RED) → `30c3755` (GREEN) → `ee4f16f` (RED) → `89f3e8d`
(GREEN) → `f05b603` (GREEN).

Acting on a code review of another session's uncommitted reseller work. Two of
the thirteen findings cost money or availability, one was a security gap, three
were already-correct code, and one feature was parked mid-TDD.

## User journeys

1. As a reseller, I want the price I was quoted to be the price I am charged.
2. As a reseller, I want to buy one vial at retail from the ordinary storefront
   without being blocked because I once opened the wholesale portal.
3. As a store owner, I want my wholesale price list to survive someone guessing
   at the password.
4. As a store owner, I want a missing platform secret to cost me the reseller
   portal, not my whole storefront.
5. As a shopper on mobile data, I want the store page to be a page and not a
   hidden image download.

## Task report

| Phase | Task | Validation | Result |
|---|---|---|---|
| 1 | Push `paymentFee` + `orderType` columns | `npm run db:push` | "Your database is now in sync with your Prisma schema. Done in 5.18s" — no data loss, run without `--accept-data-loss` |
| 2 | One shared wholesale decision | `npm run test:reseller-placement` | RED 0/15 → **GREEN 15/15** |
| 3 | Rate limit + fail-closed session | `npm run test:reseller-hardening` | RED 2/7 → **GREEN 7/7** |
| 4 | Correctness follow-ups | inspection | 3 of 5 were false positives (below) |
| 5 | `inline-media.ts` | `npm run test:inline-media` | RED (module absent) → **GREEN, all checks passed** |
| — | Whole repo | `npm run typecheck` / `npm run build` | **Clean / passes** — both were failing before this work |

### RED evidence

```
$ npm run test:reseller-placement
0 passed, 15 failed     (resolveWholesaleAccess is not a function)

$ npm run test:reseller-hardening
2 passed, 5 failed      (the public code check must be rate limited;
                         the session read must be guarded)

$ npm run test:inline-media
Cannot find module '../src/lib/storefront/inline-media'
```

### GREEN evidence

```
test:reseller-placement  15 passed, 0 failed
test:reseller-hardening   7 passed, 0 failed
test:inline-media         All inline-media checks passed
```

Full suite after the work — 17 suites, 0 failures: reseller-gate 21,
reseller-access 26, reseller-session 10, reseller-moq 11, wholesale-pricing 25,
qrph-fee 31, courier-booking 20, order-detail 18, order-confirmation 50,
data-export 38, posthog 30, admin-dashboard 56, order-note 50, gb-cart-doses 22.

## What the passing tests guarantee

| # | Guarantee | Test | Type |
|---|---|---|---|
| 1 | Browse price == charged price for every tenant shape × lock state × quantity | `test-reseller-placement.ts:browse price equals charged price` | integration |
| 2 | An unlocked reseller on a page-only tenant is charged the ₱7 they were quoted | `:is CHARGED the ₱7 they were quoted` | integration |
| 3 | A locked visitor pays retail on both sides (the mirror bug — undercharging) | `:a LOCKED visitor ... pays retail on both sides` | integration |
| 4 | Public wholesale still reaches the MOQ price with no session | `:with no session at all` | integration |
| 5 | The shared resolver does not change what the storefront already showed | `:still matches the render's existing rule` | regression |
| 6 | The MOQ rule governs only the gated page, never a public-wholesale tenant | `:does NOT govern a tenant whose wholesale is public` | unit |
| 7 | A signed-in reseller can still buy one unit at retail | `:can still buy ONE unit at retail` | integration |
| 8 | The MOQ rule sees the wholesale leg it is meant to enforce | `:sees the wholesale leg it is meant to enforce` | integration |
| 9 | The code check is rate limited per tenant AND IP, before the scrypt | `test-reseller-hardening.ts:rate limited per tenant AND IP` / `:BEFORE the password is hashed` | security |
| 10 | `isResellerUnlocked` fails closed instead of throwing | `:answers false instead of throwing` | security |
| 11 | No catalog surface computes its own wholesale answer | `test-reseller-gate.ts:strips from the SAME shared decision` | regression |
| 12 | Oversized `data:` URIs are found, sized, and stripped immutably at any depth | `test-inline-media.ts` (their spec) | unit |
| 13 | The strip runs inside the cached tenant loader | `test-inline-media.ts:wiring` | integration |

## Findings that did not hold

Three of the review's thirteen were checked and rejected rather than "fixed":

- **Demo id/slug mismatch.** In demo mode the tenant id *is* the slug
  (`lib/tenant/headers.ts:18` returns `{ id: slug, slug }`; `lib/demo/fixtures.ts:48`
  says `id: string; // == slug in demo`), so `readConfig(tenantId)` and
  `getDemoBranding(slug)` read the same blob.
- **MOQ parent-key divergence.** `orderWholesaleScope` keys by `live.id` and
  `wholesaleQty` reads by `parentProductId(p)`; for a variation the cart entry's
  `variantOf` *is* `live.id`, and the placement catalog holds only parent rows,
  so the two agree in both cases.
- **Double `getTenantContext` in products.ts.** It is wrapped in React `cache()`
  (`lib/tenant/context.ts:37`), so the second call is deduped within the render.

## Known gaps

- **Not fixed: the portal re-locks on remount.** `store.tsx` holds `brand` in
  `useState` and never re-seeds, so `router.refresh()` does not reach it and
  `#merchant` shows the password screen again after navigating away. Left alone
  deliberately: the fix is a design choice about where unlock state lives
  (lift into the store vs. re-seed the brand), in files the other session is
  actively editing.
- **No coverage percentage claimed.** This repo has no coverage runner; its
  convention is self-contained `tsx scripts/test-*.ts` suites.
- **`stampPaymentFee` and the placement path are still not executed by tests** —
  they need a tenant and a DB. What the new suite executes is the *decision*
  those paths consume, which is where the bug was.
- **Lint was not run.** `next lint` is unconfigured in this project (it prompts
  interactively to set ESLint up); none was added.

## Concurrency note

This work ran alongside another session editing the same tree. `orders.ts` gained
`catalogResold`/`stripMadeToOrder` mid-task and `package.json` was overwritten
once, dropping a script entry that had to be re-added. Every commit here was
staged hunk-by-hunk from `641bb33` so it carries only this work; that session's
uncommitted changes were left in place throughout.

## Merge evidence

If squashed: RED = `resolveWholesaleAccess is not a function` (15), missing rate
limit and session guard (5), `Cannot find module inline-media`. GREEN = 15/15,
7/7, all inline-media checks, plus 17 suites with 0 failures, a clean typecheck
and a passing production build.
