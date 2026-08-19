# Wholesale (MOQ) pricing — TDD evidence

**Feature:** combined-variant wholesale pricing, as a child of the existing Reseller feature.
**Branch:** `main` · commits `f619026` → `6650c7e` (8 commits)
**Date:** 2026-08-19

## Source plan

No `*.plan.md` artifact. The plan was agreed in conversation from a written
specification (numbered §1–§19) supplied by the product owner. Two points were
settled explicitly during planning and are recorded here because the tests
encode them:

- **Price guard = Option A.** Wholesale applies only when it is genuinely
  cheaper. A variation already priced below the wholesale price keeps its
  cheaper price. Bulk can never *raise* a per-unit price.
- **"Normal price" = the existing Price field** (and each variation's own
  price). No second "price below MOQ" input was added, because a single box
  cannot represent four differently-priced variations.

## The rule

The MOQ and the wholesale unit price are configured **once on the parent
product**. Every variation shares them, and the quantities of all variations
**combine** toward that one MOQ. Reaching it prices the **whole** quantity at
the wholesale price.

```
Vial Caps — retail ₱10, wholesale ₱7, MOQ 1,000
  Red 250 + Black 250 + Blue 250 + Yellow 250 = 1,000  →  all 1,000 at ₱7
```

Parents are evaluated independently: 800 Vial Caps (of 1,000) plus 300 Syringes
(of 500) is not 1,100 units of anything, and unlocks neither.

## User journeys

1. As a **platform operator**, I want wholesale pricing and the reseller page to
   be separate switches under one Reseller feature, so I can grant a tenant MOQ
   pricing without a reseller page and vice versa.
2. As a **store owner**, I want to set a minimum order quantity and a wholesale
   price on a product, so bulk buyers get a lower unit price automatically.
3. As a **store owner with variations**, I want all colours/sizes of one product
   to count toward the same minimum, so a 250×4 order qualifies.
4. As a **customer**, I want the cart to show me the wholesale price once I
   qualify, and to tell me accurately how many more units I need.
5. As a **platform operator**, I want granting the feature to change nothing
   until each product is opted in, so no live store's prices move by surprise.

## Architecture finding (§6/§7) — no schema change

The parent relationship the spec asked for already exists and is already used in
production pricing:

- Variations are **not** separate product rows. They live inside the parent
  row's `metadata.variations` JSON array — parenthood by containment, which is
  stronger than a foreign key.
- The grouping key is `Product.id`.
- `baseProductId(p)` (`src/storefront/checkout.ts:54`) **is** the
  `resolveParentProductId(item)` the spec's §10 pseudocode asked for. It already
  existed and was already exported.
- The chain is intact end to end: DB row → `metadata.variations` →
  `makeVariationEntry` (`variantOf`) → `CartCheckout` stamps
  `productId: baseProductId(...)` → `OrderItem.productId` →
  `authoritativeItemPrice` matches back.

**Conclusion: no schema change, no new table, no `wholesale_group_id`, no
migration.** §14 (add-ons must not count toward MOQ) needs no code today — the
concept does not exist in this codebase, and grouping by parent id means a
future add-on lands under its own key and cannot pool. §15 (inventory stays
variant-specific) needs no change: inventory already keys off
`effectiveStock(product, variationName)` and wholesale never touches it.

## Task report

### 1. Pricing engine — `src/lib/storefront/wholesale.ts`

Combined-variant MOQ resolution, threaded through `unitPrice` / `cartTotal` /
`isResellerQty` / `authoritativeItemPrice` as an **optional 4th argument**
defaulting to `null`, so every pre-existing call site is unchanged.

`resolveWholesale()` is the single resolver over two config shapes: the current
`metadata.wholesale`, and the legacy `reseller` leg derived in place so live
stores need no migration. `makeVariationEntry` copies the parent's `wholesale`
onto a variation clone (that is what lets an option qualify) but still drops the
legacy `reseller` leg, so legacy products' options price exactly as before.

```
$ npm run test:wholesale-pricing        # RED, commit f619026
  ✓ control: a single line of a no-variation product prices at wholesale
  ✗ 4 × 250 colours = 1,000 → every line prices at the ₱7 wholesale price   10 !== 7
  ✗ 4 × 250 colours = 1,000 → cart total is 1,000 × ₱7                10000 !== 7000
  ✗ uneven split still combines: 100 + 400 + 300 + 200 = 1,000 → ₱7   10000 !== 7000
  ✗ above MOQ: 1,250 combined units ALL price at ₱7                   12500 !== 8750
  ✓ below MOQ stays retail: 250 + 250 + 250 = 750 of 1,000
  ✓ quantities NEVER pool across different parent products
  ✗ a variation priced below the wholesale price keeps its cheaper price     10 !== 7
  3 passed, 5 failed

$ npm run test:wholesale-pricing        # GREEN, commit dd9e274
  14 passed, 0 failed
```

The RED is valid, not a broken harness: the control case passes (so `unitPrice`
and the fixtures work) and both negative cases pass (so the test is not merely
failing everything). The five failures carry the correct expected numbers.

Two root causes were confirmed, both real: `makeVariationEntry`
(`checkout.ts:95`) set `reseller: undefined` on a clone, so a variation carried
no wholesale leg at any quantity; and the MOQ was evaluated **per cart line**, so
four lines of 250 were each measured against 1,000 and each fell short.

### 2. Feature tree — Reseller parent, two sibling children

```
Reseller  (storefront.reseller)                  the parent switch
├── Wholesale pricing (…reseller.wholesale)      MOQ pricing on the regular store
└── Wholesale reseller page (…reseller.page)     the gated #merchant portal
```

Mirrors the Group Buy module: children are namespaced under the parent key and
`masterSwitchFor()` prefix-matches them back to it. The parent **keeps its
existing key**, so no live tenant is migrated.

```
$ npm run test:reseller-feature-tree
  13 passed, 0 failed
```

This task was config wiring, and its test was written **after** the change, not
before. The honest RED signal was the compiler: adding the group broke two
`Record<FeatureGroup, …>` maps (`FeaturesEditor`, `CreateTenantDrawer`) which
would not compile without an entry.

### 3. Server authority + entitlement gate

```
$ npm run test:reseller-gate            # RED
  ✗ an unentitled tenant's catalog carries no wholesale config
  ✗ wholesale is stripped by DEFAULT — the gate fails closed
  ✗ an unentitled owner's save cannot overwrite dormant wholesale config
  16 passed, 3 failed

$ npm run test:reseller-gate            # GREEN, commit 350ab88
  20 passed, 0 failed
```

Before this the feature **failed open**: `metadata.wholesale` was stripped for
nobody, so an unentitled tenant with a configured product would have had a
single 1,000-unit line priced at wholesale by the per-line path.

`orderWholesaleScope()` rebuilds the per-parent quantities from the stored
order and must be built *before* the re-price loop — a per-line view cannot see
that four colours of 250 are 1,000 units of one product. Lines are matched
exactly the way `authoritativeItemPrice` matches them, because diverging is the
one way client and server could disagree on whether an order reached its MOQ.

### 4. Product Management UI

```
$ npm run test:wholesale-admin          # RED
   1 passed, 12 failed
$ npm run test:wholesale-admin          # GREEN, commit a883b49
  13 passed, 0 failed
```

Validation is enforced on both sides: the client blocks Save on an enabled rule
missing an MOQ or a price, and `cleanWholesale()` in the mapping layer refuses
to persist an incomplete rule at all. A wholesale price at or above retail is a
**warning, not a block** — it saves but can never apply, since bulk only lowers.

### 5. Storefront surfaces

```
$ npm run test:wholesale-pricing        # RED (cart wiring added)
  14 passed, 5 failed
$ npm run test:wholesale-pricing        # GREEN, commit aa403a1
  19 passed, 0 failed
```

Without this the cart showed retail while the server charged wholesale.
`wholesaleRemaining()` also replaced the per-line "buy N more" arithmetic, which
told a customer with 750/1,000 units to buy 750 more instead of 250.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | 250 Red + 250 Black + 250 Blue + 250 Yellow = 1,000 prices every line at the wholesale price | `test:wholesale-pricing` | unit | PASS |
| 2 | An uneven split (100+400+300+200) combines the same way | `test:wholesale-pricing` | unit | PASS |
| 3 | The MOQ is a floor, never a cap — 1,250 units all price at wholesale | `test:wholesale-pricing` | unit | PASS |
| 4 | 750 of 1,000 stays at retail | `test:wholesale-pricing` | unit | PASS |
| 5 | Quantities never pool across different parent products | `test:wholesale-pricing` | unit | PASS |
| 6 | A variation priced below the wholesale price keeps its cheaper price | `test:wholesale-pricing` | unit | PASS |
| 7 | No entitlement → no scope → the cart stays at retail | `test:wholesale-pricing` | unit | PASS |
| 8 | `enabled: false`, MOQ 0 and price 0 each price nothing | `test:wholesale-pricing` | unit | PASS |
| 9 | The legacy `reseller` leg prices exactly as before, and never reaches a variation | `test:wholesale-pricing` | regression | PASS |
| 10 | The "buy N more" nudge counts the combined quantity | `test:wholesale-pricing` | unit | PASS |
| 11 | Every cart pricing call receives the wholesale scope | `test:wholesale-pricing` | wiring | PASS |
| 12 | The parent keeps its existing key; both children sit under it | `test:reseller-feature-tree` | unit | PASS |
| 13 | The reseller page is in every plan ceiling — existing portals survive | `test:reseller-feature-tree` | unit | PASS |
| 14 | Wholesale pricing is in no ceiling and is operator-grantable | `test:reseller-feature-tree` | unit | PASS |
| 15 | The full parent/child truth table | `test:reseller-feature-tree` | unit | PASS |
| 16 | An unentitled tenant's catalog carries no wholesale config | `test:reseller-gate` | unit | PASS |
| 17 | The wholesale gate fails closed when the flag is omitted | `test:reseller-gate` | unit | PASS |
| 18 | An unentitled save cannot blank dormant wholesale config | `test:reseller-gate` | unit | PASS |
| 19 | Both placement paths build the order-wide MOQ scope | `test:reseller-gate` | wiring | PASS |
| 20 | A complete config survives save → load and prices correctly | `test:wholesale-admin` | integration | PASS |
| 21 | An incomplete config (MOQ 0 / price 0 / negative) is never persisted | `test:wholesale-admin` | unit | PASS |
| 22 | A disabled config keeps its numbers so toggling back on restores them | `test:wholesale-admin` | unit | PASS |
| 23 | Granting the feature does not enable wholesale on an existing product | `test:wholesale-admin` | unit | PASS |
| 24 | Wholesale fields render only when the feature is granted | `test:wholesale-admin` | wiring | PASS |
| 25 | The form blocks a save with an incomplete config | `test:wholesale-admin` | wiring | PASS |

## Regression suite

All green and unmoved across the six commits:

```
test:cart 20 · test:two-ways-cart 20 · test:checkout-total 13
test:group-buy-pricing 19 · test:variation-gb-pricing 17 · test:gb-cart-doses 22
test:gb-pricing 33 · test:order-detail 18 · test:order-trash · test:checkout-names 10
test:stock-gate 41 · test:variant-inventory 33 · test:product-variations 30
test:product-add-gates 23 · test:product-detail 20 · test:default-product-image 41
test:dragon-pricelist 22 · test:kglow-pricelist · test:onhand-gate 30
test:two-ways-mode · test:gb-banner 10 · test:store-status
test:plan-scope 19 · test:plan-feature-config 20 · test:plan-distribution 9
test:feature-disclosure 11 · test:feature-spotlight 6 · test:trial-gating 18
test:staff 51 · test:icon-fallback 6 · test:plan-status 13
scripts/test-reseller-pricing.ts ALL PASSED

npm run build   succeeded
tsc --noEmit    no errors in src/ or scripts/
```

## Coverage and known gaps

This repository has no coverage instrumentation — validation is a suite of
standalone `tsx` scripts run per feature, so no `npm run test:coverage` figure
exists and the 80% gate cannot be measured numerically. Coverage of the new code
is asserted behaviorally by the 25 guarantees above, which exercise every
exported function in `src/lib/storefront/wholesale.ts`.

Known gaps and deliberate decisions:

- **No E2E test.** The cart and admin form are covered by unit tests plus
  source-wiring assertions, matching this repo's existing convention. A
  browser-level test of the 250×4 flow would be a genuine addition.
- **Wholesale pricing renders as a plain operator add-on** in the plan scope
  panel rather than "needs the parent". This matches every operator-grantable
  child outside the plan ceilings today (`groupbuy.two_ways_home`,
  `.scheduled`, `.reports.auto_on_close`). Changing it would alter Group Buy
  rendering, which is outside this task. The parent gate is enforced at runtime
  regardless, and that is what the tests pin.
- **Catalog cards and the product detail modal do not yet show wholesale
  pricing.** The engine, the cart, checkout, the server re-price, the admin
  configuration and the reseller page are all wired. Surfacing the tier on the
  card is a deliberate reversal of the documented retail-only privacy rule at
  `Catalog.tsx:104`, and was left for a follow-up so it can be made conditional
  on the entitlement rather than unconditional.
- **§14 (add-ons) and §15 (inventory)** required no code; see the architecture
  finding above.
- `scripts/test-reseller-pricing.ts` still has no npm script and must be run
  directly. Pre-existing; noted, not changed.
- Four pre-existing `tsc` errors remain in generated `.next/types` for deleted
  `boutique-preview` pages. Unrelated to this work.

## Code review round (`6650c7e`)

A review of the branch found nine issues; five were in this work and are fixed,
each with a failing test written first.

| # | Severity | Defect | Fix |
|---|---|---|---|
| 1 | HIGH | `buildOrderMessage` priced per line, so the summary sent to the **seller** quoted retail totals while the cart, stored order and confirmation charged wholesale | scope threaded from `CartCheckout` |
| 2 | MEDIUM | the same message printed `(reseller — undefined @ ₱7/ea)` for the new config | `resellerTierLabel` resolves through `resolveWholesale` and names it "Wholesale" |
| 3 | MEDIUM/HIGH | a **disabled** wholesale block masked legacy `reseller` pricing entirely, and `resellerMinQty` fell back to the global 10 | `resolveWholesale` falls *through* when the new block is absent, disabled or incomplete |
| 4 | MEDIUM | the reseller page's `rows` still filtered on `p.reseller`, so a wholesale-only product never listed | filter runs through the resolver; a single "Wholesale" tier renders for the new config |
| 5 | LOW | "will never apply" warned on every variation-priced product (base price 0) | compares against the cheapest option, matching the engine |

Finding 3 was the most serious: because `cleanWholesale` deliberately persists
`{enabled:false, moq, price}` so the owner's numbers survive the toggle, an owner
who enabled wholesale on a legacy product, saved, unchecked it and saved again
would have silently destroyed that product's existing wholesale pricing.

```
$ npm run test:wholesale-pricing   20 passed, 5 failed  →  25 passed, 0 failed
$ npm run test:wholesale-admin     13 passed, 1 failed  →  14 passed, 0 failed
```

Four review findings concern other work on this branch and were **not** touched:
the boutique/editorial layouts reading `brand.categories` instead of the store's
categories; the assurance editor dropping a row mid-edit; the untracked
`(tenant)/editorial-preview` route shipping outside the access gate; and the CSV
formula guard prefixing `+63…` phone numbers.

## Merge evidence

If these six commits are squashed, this file is the retained proof. The
RED → GREEN transitions are:

| Stage | Command | Before | After | Commit |
|---|---|---|---|---|
| Engine | `npm run test:wholesale-pricing` | 3 passed, 5 failed | 14 passed, 0 failed | `f619026` → `dd9e274` |
| Feature tree | `npm run test:reseller-feature-tree` | (compile failure) | 13 passed, 0 failed | `2ea8e1d` |
| Gate + server | `npm run test:reseller-gate` | 16 passed, 3 failed | 20 passed, 0 failed | `350ab88` |
| Admin UI | `npm run test:wholesale-admin` | 1 passed, 12 failed | 13 passed, 0 failed | `a883b49` |
| Storefront | `npm run test:wholesale-pricing` | 14 passed, 5 failed | 19 passed, 0 failed | `aa403a1` |
| Review fixes | `npm run test:wholesale-pricing` | 20 passed, 5 failed | 25 passed, 0 failed | `6650c7e` |
| Review fixes | `npm run test:wholesale-admin` | 13 passed, 1 failed | 14 passed, 0 failed | `6650c7e` |
