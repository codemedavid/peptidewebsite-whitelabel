# TDD Evidence — "Two ways to order" storefront home (K Glow Store.dc.html)

**Date:** 2026-07-22
**Task:** Implement the `K Glow Store.dc.html` design (imported from Claude Design
project `b7f87052-1e4d-4a30-8445-1c364e2a8599`) as a reusable, white-label
storefront **home** layout, enabled for the `k-glow` tenant.

## Source

Design file `K Glow Store.dc.html` (fetched via the DesignSync `get_file` tool).
Journeys derived during this TDD run — no `*.plan.md` was supplied.

## Scope decisions (user-confirmed)

1. **Application:** White-label opt-in via `brand.homeLayout === "two-ways"`, turned
   ON only for `k-glow`. The other tenants are untouched (absent/`"classic"` = the
   existing hero → categories → catalog home).
2. **On-hand vs group-buy split:** reuse the existing `productType`/`gbPrice` data
   (`two-ways.ts` `splitTwoWays`); the group-buy card lists the live round's GB
   products (scoped to `productIds` when the round is not catalog-wide).

## User journeys

- As a shopper, I see two clear order paths on the home page — **On-Hand** (ships
  now) and **Group Buy** (live round, lower price) — so I can choose how to buy.
- As a shopper, the On-Hand list shows each product's stock + price with an Add
  control.
- As a shopper, the live Group Buy card shows the round name, countdown, slot
  progress, and per-item **regular vs group price + saving**, with a Join/Checkout CTA.
- When no round is live, the Group Buy path shows a **Closed** state and the home
  still works from the On-Hand list alone.

## Task report

| Behavior | Command | RED → GREEN | Guarantee |
|---|---|---|---|
| Home view-model splits on-hand vs GB, wires round chrome, surfaces savings, handles closed/scoped/stock/initial edge cases | `npm run test:two-ways-home` | RED: `MODULE_NOT_FOUND two-ways-home` (test written first, impl absent) → GREEN: **7 passed, 0 failed** | `buildTwoWaysHomeView` composes the tested two-ways/group-buy-page primitives correctly for every home state |

RED evidence (before implementation):
```
Error: Cannot find module '../src/lib/storefront/two-ways-home'
  requireStack: [ '.../scripts/test-two-ways-home.ts' ]
```
GREEN evidence (after implementing `src/lib/storefront/two-ways-home.ts`):
```
  ✓ splits on-hand and group-buy products
  ✓ group-buy line surfaces regular vs gb price and the saving
  ✓ no live round yields a closed, empty group-buy path
  ✓ live round wires name, countdown and slot progress
  ✓ scoped round narrows the group-buy list to assigned products
  ✓ on-hand line reports stock and in-stock state
  ✓ initial uses first letter, falls back to a bullet
  7 passed, 0 failed
```

No regressions in the adjacent suites: `test:two-ways` 18✓, `test:group-buy-page`
21✓, `test:group-buy-pricing` 18✓. Production `tsc --noEmit` clean.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | On-hand vs group-buy products split into the two paths, order preserved | `test-two-ways-home.ts` | unit | PASS |
| 2 | GB line carries regular/gb/savings + `₱`-formatted labels | `test-two-ways-home.ts` | unit | PASS |
| 3 | Null banner → closed, empty GB path (no countdown, count 0) | `test-two-ways-home.ts` | unit | PASS |
| 4 | Live round wires name, countdown ("Closes in 3 days"), slot progress (60%) | `test-two-ways-home.ts` | unit | PASS |
| 5 | A scoped round narrows the GB list to its assigned product ids | `test-two-ways-home.ts` | unit | PASS |
| 6 | On-hand line reports stock + in-stock state for the badge | `test-two-ways-home.ts` | unit | PASS |
| 7 | Monogram initial uppercases first letter, falls back to `•` | `test-two-ways-home.ts` | unit | PASS |

## Files

- `src/lib/storefront/two-ways-home.ts` — pure view-model (new)
- `scripts/test-two-ways-home.ts` — unit tests (new); `test:two-ways-home` npm script
- `src/storefront/components/TwoWaysHome.tsx` — white-label home component (new)
- `src/storefront/StorefrontApp.tsx` — branch home render on `brand.homeLayout`
- `src/storefront/types.ts` — `Brand.homeLayout?: "classic" | "two-ways"` (additive)
- `scripts/enable-two-ways-home.ts` — sets `branding.config.homeLayout` per tenant;
  run `k-glow two-ways` (applied)

## Follow-up 2026-07-22 — Super Admin toggle + visual check

- **Feature key** `groupbuy.two_ways_home` (`FEATURES.GB_TWO_WAYS_HOME`) added to the
  catalog in the **Group Buy** category, `OPERATOR_GRANTABLE` (default OFF). Because
  `ALL_FEATURES = Object.values(FEATURES)` and the Super Admin Features panel renders
  every key by `FEATURE_META.group`, the toggle appears automatically under Group Buy
  in `admin → tenants/[slug] → Features`. `db:sync-features` upserted the DB row
  (68 features).
- **`resolveHomeLayout(entitled, configLayout)`** (new, tested): the operator grant is
  the toggle; `config.homeLayout` can opt in or force `classic`. `page.tsx` sets
  `brand.homeLayout` from `hasFeature(GB_TWO_WAYS_HOME)`.
- `scripts/grant-feature.ts <slug> <key> [on|off]` writes the `TenantFeatureOverride`
  (same row the panel writes). Granted `k-glow groupbuy.two_ways_home on`.
- Tests extended: `test:two-ways-home` **9 passed** (added `resolveHomeLayout` +
  catalog-integrity cases). RED (`resolveHomeLayout is not a function`,
  `GB_TWO_WAYS_HOME undefined`) → GREEN. `tsc --noEmit` clean.
- **Visual check** (dev server, `k-glow.lvh.me:3100`, 430px): the two-ways home renders
  correctly — pink theme, hero "K Glow / beautifully verified.", "Two ways to order"
  split, on-hand list (3 products), how-it-works, footer. ⚠ **The Group Buy card shows
  CLOSED** because all 3 k-glow products have `productType: undefined` (→ on-hand) with
  no `gbPrice`; the split (chosen: productType-based) therefore routes them all to
  On-Hand and the GB path is empty. To populate the live GB card the owner tags the
  round's products as **Group Buy product** + sets a **Group Buy Price** in the store
  admin. This is content setup, not a code defect.
- ⚠ **Cache caveat:** `enable-two-ways-home.ts` / `grant-feature.ts` write the DB
  directly and do NOT `revalidateTag('tenant:<id>')`, so a running server serves the
  stale `unstable_cache` (5-min) branding/entitlement snapshot until it expires. The
  visual check required moving `.next/cache` aside + restarting. Operator changes made
  through the admin actions revalidate correctly; the scripts are a dev shortcut.

## Fix 2026-07-22 — GB card is driven by the live round, not productType

**Bug:** the storefront showed the Group Buy path as **CLOSED** while the store admin
showed the `june gb` round **active** (3 products). Cause: `buildTwoWaysHomeView`
required `productType === "gb"` to place a product in the GB card, but k-glow's round
assigns products by the round's `productIds` (product-assignment), and the products
carry no `productType` tag → the GB path was empty → CLOSED.

**Change:** the **live round is now the source of truth** — a product is a GB line when
it's in the round's scope (`coversAll`, or its id ∈ `banner.productIds`); everything
else is on-hand. `productType` no longer gates grouping (pricing still honours `gbPrice`
via `groupBuyLine`, so a round product with a gbPrice shows its saving, and an untagged
one lists at its regular price). RED (3 failing round-driven cases:
`2 == 0`, `0 == 1`, scoped routing) → GREEN: **`test:two-ways-home` 10 passed**. `tsc` clean.

**Visual confirmation** (fresh browser context, `k-glow.lvh.me:3100`, 430px): the split
card shows **Group Buy · OPEN NOW**, the **GROUP BUY LIVE · june gb · Closes in 4 days**
card lists the 3 round products with Join buttons, and On-Hand correctly shows "0 products
— check the group buy above". ⚠ The earlier CLOSED renders were a **stale client bundle**
in the reused tab (the split runs client-side in `TwoWaysHome`); a fresh context rendered
the fix. Items show at regular price (no `gbPrice` set) — the owner sets Group Buy Price
per product to surface savings.

## Coverage & known gaps

- The **component** (`TwoWaysHome.tsx`) is covered by its pure view-model, not yet by
  visual regression. Per the web testing rules, screenshot 320/375/768 for the
  rendered k-glow home (light theme) is the recommended follow-up.
- **No admin UI toggle yet** — the layout is opt-in via `branding.config.homeLayout`
  (set by `enable-two-ways-home.ts`); a store-admin Hero-tab select is a follow-up.
- The k-glow config write bypasses the entitlement cache-bust tag, so the live home
  may take up to the 5-min `unstable_cache` window to switch over.
