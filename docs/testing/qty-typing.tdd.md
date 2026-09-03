# Typed add-to-cart quantity — TDD evidence

**Branch:** `feat/made-to-order`
**Date:** 2026-09-03
**Test target:** `npm run test:qty-typing` → `scripts/test-qty-typing.ts`

## Source plan

No `*.plan.md`. The journeys below were written during this TDD run from the
request: *"when adding to cart instead of manually adding per pcs using + allow
user to type the qty."*

## The complaint

Every quantity control on the storefront was a −/+ stepper wrapped around a
read-only `<span>`. Nothing was broken — it was simply unusable at the volumes
this catalog actually sells at: 12 vials cost eleven taps, and a 50-unit
wholesale MOQ cost forty-nine before the line was even legal.

Six surfaces each carried their own copy of that markup:

| Surface | File | Quantity bound to |
|---|---|---|
| Catalog product card | `src/storefront/components/Catalog.tsx` | local state (pre-add) |
| Quick-view detail modal | `src/storefront/components/Catalog.tsx` | local state (pre-add) |
| Wholesale / reseller page | `src/storefront/pages/MerchantPage.tsx` | local state (pre-add, MOQ floor) |
| Cart drawer lines | `src/storefront/components/CartCheckout.tsx` | the cart |
| Two-ways on-hand rows | `src/storefront/components/TwoWaysHome.tsx` | the cart |
| Group-buy cards | `src/storefront/pages/GroupBuyPage.tsx` | the cart |

## User journeys

1. As a shopper buying 12 vials, I want to **type** 12 into the quantity box, so ordering in bulk is one action instead of eleven.
2. As a reseller whose product has a 50-unit minimum, I want a typed quantity below the MOQ to snap back up to it, so I can never build a line the wholesale price refuses.
3. As a shopper, I want a typed quantity above what is in stock to cap at the available units, so I am told before checkout, not after.
4. As a shopper who cleared the box to retype it, I want the field to stay empty while I type and settle on the minimum when I leave it — never a 0-unit add-to-cart.
5. As a shopper editing a line already in the cart, I want typing 5 to **set** that line to 5 units, not to add 5 more on top.
6. As a shopper buying a made-to-order item (no stock to count), I want to type any sensible quantity without an invisible cap.

## Task report

### 1. RED — the reproducer

Commit `d3ad941` *test: add reproducer for a typable add-to-cart quantity*.

```
$ npm run test:qty-typing
Error: Cannot find module '../src/lib/storefront/qty-input'
Require stack:
- /Users/…/scripts/test-qty-typing.ts
```

Compile-time RED, failing for the intended reason: the shared helpers, the
typable control and the store's absolute setter did not exist. Not a broken
harness — the same runner passes for ~170 sibling suites.

### 2. GREEN — the implementation

Commit `be4810d` *feat(storefront): let shoppers type the quantity instead of
tapping + per piece*.

```
$ npm run test:qty-typing
…
44 passed, 0 failed
```

Three pieces:

- **`src/lib/storefront/qty-input.ts`** — the one rule for what typed digits
  mean. The split that carries the design: a quantity being **typed** and a
  quantity being **committed** are different values. Mid-edit, `""` and a
  below-MOQ prefix are legal states (so `"1"` survives long enough to become
  `"120"`), so `sanitizeQtyDraft` applies only the upper bound; the minimum
  lands once, in `commitQtyDraft`. The cap *is* applied while typing, so an
  unfillable number never sits in the field waiting to be rejected later.
- **`src/storefront/components/QtyField.tsx`** — −, a numeric-keypad box, +.
  Owns exactly one piece of state (the draft string) and delegates every
  decision to the helpers. `commit="live"` where the value is local state — the
  Add-to-Cart button beside it has to read the typed number even if the field
  never loses focus first; `commit="blur"` where it is bound to the cart —
  committing per keystroke would add and remove real cart entries and fire real
  "only N in stock" toasts as each digit landed.
- **`store.setLineQty(product, qty, variation?)`** — sets a line to an
  **absolute** quantity. Increases delegate to `addToCart`, so a typed quantity
  clears the exact same gates a tapped "+" does: store closed,
  price-on-request, paused product, the on-hand group-buy gate, the per-way
  block, the two-ways mix rule, Smart Checkout restrictions and the stock cap.
  Re-implementing any of that in a shortcut is how a convenience quietly
  becomes a way to over-sell. Decreases splice the surplus out of the flat
  `Product[]`, recounting inside the updater so two edits in one tick cannot
  over-remove.

### 3. Adjacent suite re-pointed

`scripts/test-stock-gate.ts` asserted the cart's cap structurally as
`disabled={cartLineRoom(…)}`. The **guarantee** is unchanged but the mechanism
moved one rung up: the cap is now the control's `max={l.qty + cartLineRoom(…)}`,
which `QtyField` enforces on the typed value *and* the "+". A cap that only
guarded the button would have left the box free to hold an unfillable number,
so the anchor was re-pointed and a second check added for the other half of the
chain. `42 passed, 0 failed`.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A typed quantity is committed as entered (journey 1) | `test-qty-typing.ts:commits a typed quantity` | unit | PASS |
| 2 | Fractional input floors to whole pieces | `…:floors to a whole number of pieces` | unit | PASS |
| 3 | A below-MOQ commit is raised to the minimum (journey 2) | `…:raises a below-MOQ commit to the minimum` | unit | PASS |
| 4 | A commit above stock is capped at available units (journey 3) | `…:caps a commit at available stock` | unit | PASS |
| 5 | A max below the min yields the max — a sold-down line can only shrink | `…:a max below the min still yields the max` | unit | PASS |
| 6 | 0 and negatives never reach the cart | `…:defaults the minimum to 1` | unit | PASS |
| 7 | An uncapped (made-to-order) product accepts a large quantity (journey 6) | `…:an uncapped (made-to-order) product accepts a large quantity` | unit | PASS |
| 8 | The box never renders `Infinity` | `…:never returns Infinity, even with no cap` | unit | PASS |
| 9 | An empty box stays empty mid-edit (journey 4) | `…:keeps an empty box empty mid-edit` | unit | PASS |
| 10 | A below-min prefix survives typing — `1` can become `120` | `…:does NOT raise to the minimum while typing` | unit | PASS |
| 11 | Pasted junk (`1a2`, `-3`, `2.5`) cannot corrupt the quantity | `…:drops non-digits` | unit | PASS |
| 12 | Leading zeros strip, so typing over a value reads naturally | `…:strips leading zeros` | unit | PASS |
| 13 | The cap applies as it is typed, not only on commit | `…:clamps to the cap as it is typed` | unit | PASS |
| 14 | A pasted novel truncates to the largest orderable quantity | `…:a pasted novel is truncated` | unit | PASS |
| 15 | Garbage settles on the minimum, never NaN | `…:all-garbage input settles on the minimum` | unit | PASS |
| 16 | Typing into a cart line adds only the difference (journey 5) | `…:typing a bigger number adds only the difference` | unit | PASS |
| 17 | Typing a smaller number removes the surplus | `…:typing a smaller number removes the surplus` | unit | PASS |
| 18 | Retyping the same number is a no-op — no cart churn, no toast | `…:retyping the same number is a no-op` | unit | PASS |
| 19 | Typing 0 clears the whole line | `…:typing 0 clears the whole line` | unit | PASS |
| 20 | The control is a real input, not a read-only span | `…:renders a real text input` | structural | PASS |
| 21 | Phones get the numeric keypad | `…:asks phones for the numeric keypad` | structural | PASS |
| 22 | The −/+ buttons survive — typing is added, not swapped in | `…:keeps the − / + buttons beside the box` | structural | PASS |
| 23 | Enter commits, so a keyboard shopper is never stranded | `…:commits on Enter as well as blur` | structural | PASS |
| 24 | The control has no parsing of its own | `…:routes every edit through the shared helpers` | structural | PASS |
| 25 | All six surfaces render the shared control | `…:<surface> renders QtyField ×N` (5 checks) | structural | PASS |
| 26 | No hand-rolled +1/−1 stepper closures survive | `…:the catalog's / reseller page's hand-rolled … are gone` | structural | PASS |
| 27 | The store exposes and publishes `setLineQty` | `…:the store exposes setLineQty` / `…is implemented and published` | structural | PASS |
| 28 | Increases still route through `addToCart`, keeping every gate | `…:increases still route through addToCart` | structural | PASS |
| 29 | All three cart-backed surfaces set, not stack | `…:<file> sets the line quantity instead of stacking adds` (3 checks) | structural | PASS |
| 30 | Each of the three stepper skins styles its input | `…:the shared .sf-qty control styles its input` / `…the two-ways and group-buy steppers style their input too` | structural | PASS |
| 31 | The cart's cap bounds the box as well as the "+" | `test-stock-gate.ts:the cart's quantity control enforces that cap on both` | structural | PASS |

## Coverage and known gaps

**No coverage percentage is reported, because this repository has no coverage
tooling** — `package.json` contains no jest, vitest, c8 or nyc, and there is no
`test:coverage` script. Tests here are ~170 self-contained `tsx scripts/test-*.ts`
suites. The 80% target in the house rules cannot be measured with the tooling
present, so claiming a number would be fabrication. What was actually run:

```
npm run test:qty-typing      44 passed, 0 failed
npm run test:stock-gate      42 passed, 0 failed
npx tsc --noEmit             exit 0
npm run build                clean
```

Plus 12 further neighbouring suites, all PASS: `test:product-cta`,
`test:product-detail`, `test:variation-price-reveal`, `test:variation-collapse`,
`test:two-ways-cart`, `test:two-ways-home`, `test:group-buy-page`,
`test:variant-inventory`, `test:made-to-order`, `test:cart`, `test:sale-price`,
`test:wholesale-pricing`.

Gaps, stated rather than hidden:

- **No DOM-level test of the typing interaction.** The helpers are covered
  exhaustively as pure functions, and the wiring structurally, but there is no
  renderer in this repo (no jsdom, no Testing Library), so "focus the box, type
  1-2, blur, assert the cart holds 12" is not asserted end-to-end. The
  `commit="live"` vs `commit="blur"` distinction in particular is verified by
  reading, not by execution.
- **`min={0}` on the three cart-backed surfaces** deliberately preserves the
  existing behaviour where "−" on the last unit clears the line. A consequence:
  emptying the box and clicking away also clears it there. On the pre-add
  surfaces an empty box settles on the minimum (journey 4) and can never place a
  0-unit add.
- **ESLint was not run** — the repo has no ESLint config (`next lint` prompts to
  create one interactively). `tsc --noEmit` and `npm run build` are the gates
  that do exist, and both pass.

## Merge evidence

If these commits are squashed, the RED/GREEN pair is:

- **RED** `d3ad941` — `npm run test:qty-typing` → `Cannot find module '../src/lib/storefront/qty-input'`
- **GREEN** `be4810d` — `npm run test:qty-typing` → `44 passed, 0 failed`
- **Refactor** — none needed as a separate step: the shared helper + shared
  component *are* the de-duplication, and the six copies of the old stepper
  markup were deleted as they were replaced.
