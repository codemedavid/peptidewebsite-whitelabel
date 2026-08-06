# TDD evidence — store open/closed switch

**Source plan** — inline plan produced by `/ecc:plan` in this session (no `*.plan.md` artifact
was written; the request came as free-form text, so the command ran in conversational mode).
Two decisions were taken to the user before any code was written:

- **Closed presentation** → *browsable, buttons locked*. The catalog keeps rendering with prices
  visible; only buying stops. (The rejected alternative was a full-page takeover.)
- **Who can toggle it** → *owner + permitted staff*, via a new grantable `store-status` module.

**Feature commits** — `0440ed9` (RED) → `654cafb` (core GREEN) → `57bd4c8` (surfaces GREEN),
all on `feat/gb-pricing-tab`.

---

## User journeys

1. As a store owner, I want to close my shop for a restock, so that customers stop placing orders
   I can't fulfil — without unpublishing my store or losing my catalog.
2. As a store owner, I want to write my own message ("back Monday 9am"), so that customers know
   why we're shut and when to return.
3. As a shopper, I want to see whose store I've landed on and that it's closed, so that I'm not
   left guessing why nothing is clickable.
4. As a shopper, I want to keep browsing products and prices while the store is closed, so that
   I can decide whether to come back.
5. As a shopper with a cart already open, I want to be told the shop closed, so that I don't fill
   in an address and upload payment proof for an order that will be refused.
6. As the store owner, I want a stale tab or a hand-rolled request to be unable to order into my
   closed shop, so that "closed" actually means closed.
7. As a store owner, I want to grant a manager the ability to open and close the shop, without
   handing over everything else.

---

## Task report

### Task 1 — Pure core (`src/lib/storefront/store-status.ts`)

Wrote the gate first and ran it against a module that did not exist yet.

**Command:** `npm run test:store-status`

**RED output (commit `0440ed9`):**

```
Error: Cannot find module '../src/lib/storefront/store-status'
Require stack:
- /Users/…/scripts/test-store-status.ts
```

Compile-time RED for the intended reason: the gate newly references the missing implementation.
Not a syntax error, not broken setup.

**GREEN output (commit `654cafb`)** — all 36 core checks:

```
normalizeStoreStatus — fails safe to OPEN            7/7 ✓
only a literal false closes a store                  6/6 ✓
headline + message are sanitized on the way in       6/6 ✓
the normalizer never mutates its input               3/3 ✓
isStoreClosed — one predicate                        5/5 ✓
buildStoreClosedNotice — greets by business name     9/9 ✓
```

**Guaranteed:** absent/junk config leaves a store open; only a literal `false` closes it
(`"false"`, `""`, `0`, `null` all stay open); copy is trimmed and clamped to 160/600 chars;
the normalizer never mutates its input; the headline names the business and the owner can
override it; a nameless brand never renders "undefined" or a dangling separator.

### Task 2 — Buy controls (`product-cta.ts`, `Catalog.tsx`, `TwoWaysHome.tsx`, `GroupBuyPage.tsx`)

`storeClosed` was placed at the **top** of `buildProductCta`'s precedence ladder — above
`priceOnRequest` — because with the shop shut there is nothing to message about and no stock
state worth naming. `TwoWaysHome` and `GroupBuyPage` hand-roll their own buttons and bypass
`buildProductCta` entirely, so each was guarded separately.

**Guaranteed:** every buy surface reads the switch; the card and its quick-view modal cannot
disagree; a closed shop cannot take group-buy pre-orders either.

### Task 3 — Cart and checkout (`store.tsx`, `CartCheckout.tsx`)

`addToCart` refuses first, above every per-product reason. Checkout folds the flag into the
existing `blocked` boolean and renders the reason above the Checkout button.

Deliberately **not** modelled as a `CheckoutRuleViolation`: that union describes the owner's
cart rules, and a closed shop is not a rule about this cart.

### Task 4 — Server authority (`orders.ts`)

Guarded in **both** placement paths. The demo branch returns before the DB branch is reached,
so a single guard would have left a hole — the gate asserts two occurrences for exactly this
reason.

**Guaranteed:** a stale tab, a replayed request or a hand-rolled POST cannot order into a
closed store.

### Task 5 — Storefront notice (`StoreClosedNotice.tsx`, `storefront.css`)

Rendered inside the shared chrome, below the announcement banner, so a shopper who deep-links
to `#groupbuy` or `#catalog` is told too. Returns `null` when open, so an open tenant's markup
is unchanged. `role="status"`, not `alert` — a standing page condition, not an interruption.

### Task 6 — Admin panel (`AdminStoreStatus.tsx` + wiring)

Store Status panel in the **Daily** nav group, with a live preview built from the same
`buildStoreClosedNotice` the storefront uses. Saves through `saveStoreStatusAction`, gated by
`requireStaffPermission("store-status")`.

---

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Absent, null, string, array, number or `{}` config leaves the store OPEN | `test-store-status.ts:normalizeStoreStatus — fails safe to OPEN` | unit | PASS |
| 2 | Only a literal `false` closes a store — `"false"`, `""`, `0`, `null` do not | `test-store-status.ts:only a literal false closes a store` | unit | PASS |
| 3 | Headline and message are trimmed, non-strings read as empty, both clamp to their caps | `test-store-status.ts:headline + message are sanitized on the way in` | unit | PASS |
| 4 | Normalizing a frozen config neither throws nor mutates, and returns a new object | `test-store-status.ts:the normalizer never mutates its input` | unit | PASS |
| 5 | `isStoreClosed` accepts raw config and is the single predicate | `test-store-status.ts:isStoreClosed` | unit | PASS |
| 6 | The closed headline greets the shopper and names the business; the owner can override it | `test-store-status.ts:buildStoreClosedNotice` | unit | PASS |
| 7 | A nameless brand still gets a complete sentence — never "undefined", never a dangling dash | `test-store-status.ts:a nameless brand …` | unit | PASS |
| 8 | `CTA_COPY` carries a Closed label and `buildProductCta` honours `storeClosed` | `test-store-status.ts:every buy surface reads the switch` | integration (source) | PASS |
| 9 | The catalog wires the flag into BOTH the card and the quick-view modal | `test-store-status.ts:the catalog passes storeClosed into both …` | integration (source) | PASS |
| 10 | Two-ways home and the group-buy page guard their hand-rolled buttons | `test-store-status.ts:the two-ways home / the group-buy page …` | integration (source) | PASS |
| 11 | The cart refuses the add and checkout is blocked | `test-store-status.ts:the cart refuses … / checkout is blocked …` | integration (source) | PASS |
| 12 | Order placement re-checks server-side in BOTH the demo and DB paths | `test-store-status.ts:BOTH the demo and the DB placement paths are guarded` | integration (source) | PASS |
| 13 | The storefront renders the closed notice | `test-store-status.ts:the storefront renders the closed notice` | integration (source) | PASS |
| 14 | `store-status` is a grantable staff module, routed and reachable, with a save action | `test-store-status.ts:the owner (and permitted staff) can reach the switch` | integration (source) | PASS |

Evidence for all of the above: `npm run test:store-status` → `PASS — store open/closed switch verified`.

---

## Regression and type safety

```
npx tsc --noEmit --pretty false     → exit 0
```

16/16 gates PASS: `store-status`, `product-cta`, `staff`, `cart`, `onhand-gate`,
`checkout-total`, `order-confirmation`, `variant-inventory`, `two-ways-home`, `two-ways-mode`,
`two-ways-cart`, `sort-categories`, `catalog-sort`, `group-buy-page`, `notice-modal`,
`gb-cart-doses`.

> Several "FAIL" lines seen mid-session were **my own script-name typos**
> (`test:staff-permissions`, `test:inventory`, `test:variations`, `test:checkout-rules`,
> `test:on-hand-gate` do not exist; the real names are `test:staff`, `test:variant-inventory`,
> `test:onhand-gate`) plus a broken `$?` check in a shell loop. No gate ever actually failed.

---

## Coverage and known gaps

The repo has no global coverage instrumentation — it uses per-feature `tsx` gate scripts, and
this feature follows that convention. `npm run test:store-status` exercises every exported
symbol in `store-status.ts` (`normalizeStoreStatus`, `isStoreClosed`, `buildStoreClosedNotice`,
all three constants) across happy paths, junk input, boundary lengths and immutability.

**Intentional gaps, not yet covered by an automated test:**

- **No browser E2E.** The surface guards are *source-level* assertions (the same technique
  `test-product-cta.ts` uses): they prove each file reads the switch, not that the rendered
  pixels are correct. A Playwright pass covering "close the store → every CTA reads Closed →
  checkout refuses" would be the honest next step.
- **CSS is unverified.** `.sf-closed*` was added but never rendered in a browser during this
  session — no screenshot was taken at any breakpoint.
- **The server guards were not executed.** Both `orders.ts` refusals are asserted by source
  inspection only; no test places an order against a closed store. This is the highest-value
  gap, since that path is the actual security boundary.
- **No manual QA was run.** The dev server was not started and no tenant was closed end to end.

## Merge evidence

If these commits are squashed, the RED/GREEN summary above travels with them:

- **RED** `0440ed9` — `npm run test:store-status` fails at module resolution for the missing core.
- **GREEN (core)** `654cafb` — 36/36 core checks pass.
- **GREEN (surfaces)** `57bd4c8` — 44/44 checks pass, `tsc --noEmit` exit 0, 16/16 regression gates pass.
- **Refactor** — none required; no duplication was introduced (the closed CTA reuses `CTA_COPY`,
  the notice card and the admin preview share `buildStoreClosedNotice`).

> `57bd4c8` also carries the previously-uncommitted sort-categories work from an earlier
> session. Its hunks share `Catalog.tsx` and `types.ts` with this feature and could not be
> split out non-interactively without breaking the build.
