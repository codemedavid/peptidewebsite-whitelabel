# TDD evidence — QR PH processing fee & courier booking link

**Source plan:** inline plan agreed in-session (no `*.plan.md` artifact).
**Branch:** `main` · **Commits:** `3c1a77c` (RED) → `0b3d053` (GREEN, engine) → `b07d1c3` (wiring).

Two checkout features, both registered in feature management and **default OFF**
for every tenant.

## User journeys

1. As a store owner, I want to mark which of my payment methods is QR PH, so the
   2% QR PH charges me is passed on only for that method.
2. As a customer, I want to see the processing fee as its own line before I place
   the order, so the total is never a surprise.
3. As a customer, I want the fee to disappear the moment I switch payment method,
   and never to be applied twice.
4. As a store owner, I want the fee charged even if a buyer tampers with the page.
5. As a store owner, I want to put my Lalamove booking form on the Lalamove
   courier, so buyers who pick it complete the form before ordering.
6. As a customer, I want that card to disappear when I pick a different courier.
7. As a platform operator, I want both features off until I grant them per tenant.

## Task report

| Task | Validation run | Result |
|---|---|---|
| Fee engine (tag, rate, base, rounding, gate, tamper rule) | `npm run test:qrph-fee` | RED `MODULE_NOT_FOUND` → **31 passed, 0 failed** |
| Booking link (resolution, isolation, URL safety) | `npm run test:courier-booking` | RED `MODULE_NOT_FOUND` → **20 passed, 0 failed** |
| All four order-total formulas agree | `npm run test:qrph-fee` (cross-surface case) | PASS |
| No regression on neighbouring total surfaces | `test:order-detail`, `test:order-confirmation`, `test:data-export`, `test:posthog`, `test:admin-dashboard` | 18 / 50 / 38 / 30 / 56 pass, 0 fail |
| No regression on message/pricing callers | `test:order-note`, `test:wholesale-pricing`, `test:gb-cart-doses` | 50 / 25 / 22 pass, 0 fail |
| Types | `npm run typecheck` | Clean |
| Production build | `npm run build` | Compiles; passes end-to-end (see caveat) |

### RED evidence

```
$ npm run test:qrph-fee
Error: Cannot find module '../src/lib/storefront/payment-fee'
$ npm run test:courier-booking
Error: Cannot find module '../src/lib/storefront/courier-booking'
```

Compile-time RED: each suite binds against the implementation it specifies, and
fails because that implementation does not exist — not from a setup error.

### GREEN evidence

```
$ npm run test:qrph-fee          31 passed, 0 failed
$ npm run test:courier-booking   20 passed, 0 failed
```

Both re-verified in a clean worktree checked out at `b07d1c3` with none of the
working tree's other in-flight changes present.

## What the passing tests guarantee

| # | Guarantee | Test | Type |
|---|---|---|---|
| 1 | 2% of ₱1,000 is exactly ₱20 | `test-qrph-fee.ts:2% of ₱1,000 is exactly ₱20` | unit |
| 2 | ₱1,000 + ₱100 delivery is charged ₱22 | `:the spec's worked example` | unit |
| 3 | PHP amounts round to whole centavos (₱1,123 → ₱22.46) | `:PHP amounts round to two decimals` | unit |
| 4 | Only the owner's **tagged** method charges; an untagged method *named* "QR PH" does not | `:the tag is the rule` | unit |
| 5 | Switching QR PH → other → QR PH → other → QR PH yields `[20,0,20,0,20]` — never accumulates | `:never accumulates` | unit |
| 6 | The fee is never charged on itself | `:never charged on itself` | unit |
| 7 | A zero base produces no fee line at all | `:a zero base charges no fee` | unit |
| 8 | An unentitled tenant is charged nothing, tag or no tag | `:an unentitled tenant is charged nothing` | unit |
| 9 | Revoking the feature leaves the owner's tag intact | `:leaves the owner's tag intact` | unit |
| 10 | A client claiming a smaller fee than we'd charge is rejected; equal-or-less proceeds | `:paymentFeeOvercharges` cases | unit |
| 11 | Sub-centavo float drift does not reject an honest order | `:sub-centavo float drift` | unit |
| 12 | All four independent total formulas produce one number | `:all four independent total formulas` | integration |
| 13 | An order can carry both an admin fee and a processing fee | `:BOTH an admin fee and a processing fee` | integration |
| 14 | An order without a processing fee totals exactly as before | `:totals exactly as it always did` | regression |
| 15 | The configured Lalamove link surfaces for that courier only | `test-courier-booking.ts:spec Test 5` / `Test 6` | unit |
| 16 | A blank or absent URL does not crash checkout | `:spec Test 8` | unit |
| 17 | An edited URL is read fresh, never cached | `:spec Test 7` | unit |
| 18 | Two tenants sharing a courier id never see each other's URL | `:spec Test 9` | integration |
| 19 | `javascript:`, `data:`, `file:`, `vbscript:` and `//host` are rejected on save and at render | `:URL safety` cases | security |
| 20 | An unsafe URL never reaches the checkout card | `:never reaches the checkout card` | security |

## Coverage

This repo has no coverage instrumentation — its convention is self-contained
`tsx scripts/test-*.ts` suites registered as `npm run test:*`, and there is no
jest/vitest/`test:coverage` runner to report a percentage against. **No coverage
figure is claimed.** What is measured instead: both new modules
(`payment-fee.ts`, `courier-booking.ts`) have every exported function and every
branch of the fee/URL rules exercised, and the fee is pinned at all four total
call sites.

`next lint` is not configured in this project (it prompts interactively to set
ESLint up), so no lint step was run and none was added.

## Known gaps

- **UI is not covered by automated tests.** The tag checkbox, the fee row, the
  booking card and the admin field are wired and typecheck, but this repo has no
  component or E2E harness, so they were verified by build + types only.
- **`stampPaymentFee` is not directly unit-tested** — it calls the tested engine,
  but exercising it needs a tenant DB/demo fixture. Its rule (`activePaymentFee`
  + `paymentFeeOvercharges`) is fully covered.
- **The fee base is a decision, not a fact.** The brief's Test 1 implies
  subtotal-only (₱20 on ₱1,000); its UI example implies the pre-fee grand total
  (₱22 on ₱1,000 + ₱100). Built to the latter. Flipping it is one line in
  `paymentFeeBase`.

## Caveat on the build result

Base commit `641bb33` — HEAD when this work started — does **not** typecheck or
build on its own. Three pre-existing breakages, all from another session's
in-flight work and all repaired only in its uncommitted working copy:

1. `src/storefront/admin/AdminOrders.tsx` — unbalanced JSX (10 TS errors)
2. `src/storefront/storefront.css:4567` — stray declaration outside any selector
3. `scripts/test-inline-media.ts` — imports a module not yet written (their RED)

None are caused by this work. Verified in an isolated worktree: at `b07d1c3` the
only typecheck errors are the 10 inherited `AdminOrders.tsx` ones, and with the
other session's three fixes applied the production build completes end-to-end.

## Merge evidence

If these three commits are squashed, keep: RED = both suites `MODULE_NOT_FOUND`
on their target modules; GREEN = 51/51 across the two new suites plus 8
neighbouring suites unchanged; typecheck clean; production build passes.
