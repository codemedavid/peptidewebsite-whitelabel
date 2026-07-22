# TDD Evidence — Subscription window save crash

**Task:** Fix "An error occurred in the Server Components render" when saving a
billing (the operator's **Subscription window** on the tenant-detail page).
Journeys derived during this TDD run (no plan file).

## User journeys

- As an operator, I want to save a tenant's subscription window (billing cycle,
  start/due dates, amount, monthly price) **without the page crashing**, even
  when the live DB hasn't had `subscriptionPriceCents` db:push'd yet.
- As an operator, when a save genuinely fails I want a readable inline error, not
  an opaque digest that blanks the tenant-detail page.

## Root cause

`setSubscriptionWindowAction` (`src/actions/admin.ts`) wrote `subscriptionPriceCents`
via `prisma.tenant.update` in **both** its set and clear branches. That column is
a pending-`db:push` addition ([[live-db-state]], [[subscription-price-override]]),
so on the live DB the write threw an uncaught Server Action error → the generic
production RSC digest the operator saw. The read path (`subscription-info.ts`)
already fails open on the same column; the write path did not.

## Task report

| Step | Command | Result |
|------|---------|--------|
| RED  | `npm run test:subscription-window` | FAIL — `Cannot find module '../src/lib/subscription/persist-window'` (the missing implementation is the code path under test) |
| GREEN | `npm run test:subscription-window` | PASS — 4 passed, 0 failed |
| Typecheck | `npx tsc --noEmit -p tsconfig.json` | PASS — exit 0, no output |
| No regressions | `test:subscription-state` / `:subscription-payments` / `:billing-cycle` / `:plan-fee` | PASS — 14 / 21 / 20 / 13 |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Full window (incl. price) persists once when the column exists | `scripts/test-subscription-window-write.ts` | unit | PASS |
| 2 | Retries with the price key **omitted** (not null) when the column is unmigrated; core columns still save | same | unit | PASS |
| 3 | Clearing the window also tolerates the missing column | same | unit | PASS |
| 4 | A genuine DB error (retry can't recover) propagates, not swallowed | same | unit | PASS |

## Fix

- New `src/lib/subscription/persist-window.ts` — `writeSubscriptionWindow(update, data)`:
  full write → on failure retry with `subscriptionPriceCents` omitted → rethrow if
  the retry also fails. Mirrors the read path's fail-open philosophy.
- `setSubscriptionWindowAction` routes both branches through it and wraps the write
  in try/catch, returning `{ error: "Couldn't save the subscription window. Please try again." }`
  (with a server-side `console.error`) instead of letting the throw escape.

## Known gaps / follow-up

- **Operational:** running `npm run db:push` on the live DB adds the
  `subscriptionPriceCents` column, after which saves take the `"full"` path and the
  per-tenant monthly price persists. Until then the core window saves and the price
  reads as unset — matching the read path's documented behavior.
- Coverage is unit-level on the pure resilience helper; the action wrapper is
  covered by inspection (thin glue over the tested helper + validated inputs).

## Merge evidence

RED `fca6aa1` → GREEN `0d0ceb2`. RED was module-level (reproducer imported the
not-yet-created helper); GREEN turns all 4 cases green with a clean typecheck.
