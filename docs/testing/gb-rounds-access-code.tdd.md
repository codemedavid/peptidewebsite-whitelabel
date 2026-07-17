# TDD evidence — access-code grantability + one active group buy round

**Branch:** `feat/trial-system`
**Commits:** `9d0c1e3` (RED) → `3f386ea` (GREEN), `0aa3f9d` (RED) → `30429e9` (GREEN)
**Date:** 2026-07-17

## Source plan

No `*.plan.md` artifact. Journeys were derived during this TDD run from a ported
specification supplied in-session (a per-tenant access gate + per-tenant Group Buy,
ported from a single-tenant app). The spec assumed raw Supabase SQL, bcrypt,
`/s/acme` path tenancy and REST route handlers; this repo is Prisma + server
actions + subdomain tenancy + scrypt. The spec's **rules** were adopted; its
**schema** was rejected — implementing §1 literally would have created a second
`tenants` table alongside the existing `Tenant` model and split-brained the app.

Deliberate deviations, recorded rather than silently taken:

| Spec says | What we did | Why |
|---|---|---|
| bcrypt cost 12 (§8.2) | Kept scrypt (`src/lib/auth/password-hash.ts`) | Equivalent-or-better; swapping invalidates every live credential (`accessCodeHash`, `adminPasswordHash`) for no security gain. |
| Path tenancy `/s/acme` (§2) | Kept subdomain tenancy | Already configured and working (`slug.lvh.me:3100`). |
| `tenants` / `tenant_settings` tables (§1) | Kept `Tenant` + `Branding.config` | A parallel table would split-brain the app. |
| `group_buy_product_availability` sparse table (§1) | Kept `GroupBuy.productIds` JSON | Operator decision — the existing model already does per-round assignment; YAGNI until mid-round toggles are needed. |
| `groupbuy.multiple_active` as an add-on | **Removed the feature entirely** | Operator decision. See Task 2. |

## User journeys

1. **As a platform operator**, I want to switch the private-store access code gate
   on for one tenant from super admin → Features, so a client's store can be made
   private without a plan upgrade.
2. **As a platform operator**, I want every feature in the catalog to be reachable
   from super admin → Features, so no feature ships with a toggle that can never be
   turned on.
3. **As a store owner**, I want at most one group buy round live at a time, so orders
   are attributed to exactly one round and the supplier report is unambiguous.

## Task report

### Task 1 — `storefront.access_code` was ungrantable

**Summary.** The access code gate was declared in the catalog with meta advertising
"Operator-grantable, default OFF", but sat in no plan ceiling **and** was absent
from `OPERATOR_GRANTABLE`. `features/page.tsx:50` therefore computed
`lockedByPlan = true` while `requiredPlan()` returned `undefined`, rendering
"Locked · upgrade to `<null>`" — a toggle no operator could ever turn on for any
tenant. The gate was unshippable through the admin.

**Validation command.** `npm run test:plan-scope`

**RED** (`9d0c1e3`) — 18 passed, 1 failed:

```
✗ every catalog feature is reachable from admin → Features
  — unreachable from admin → Features (add to a plan ceiling or OPERATOR_GRANTABLE):
    storefront.access_code
```

`storefront.access_code` was the **only** offender across the whole catalog, so the
test isolates exactly the defect and nothing else.

**GREEN** (`3f386ea`) — 19 passed, 0 failed.

**Guaranteed by the passing test.** No feature can be added to `FEATURES` in future
without either being placed in a plan ceiling or made operator-grantable — the class
of bug is closed, not just this instance. The existing suite asserted this only for
`groupbuy.*` keys (`test-plan-scope.ts:133`); the new test generalizes that rule to
the entire catalog.

### Task 2 — one active round per tenant is an invariant, not an entitlement

**Summary.** `groupbuy.multiple_active` (`GB_MULTIPLE_ACTIVE`) removed entirely: the
catalog key, its `OPERATOR_GRANTABLE` and `FEATURE_META` entries, the
`multipleActive` capability on `GroupBuyCapabilities` / `GROUP_BUY_CAPS_OFF`, both
transitive `Pick`s, and the resolver line in `resolveGroupBuyCaps`.

**Why it could not stay.** The DB partial unique index that will enforce rule #4
(`group_buys_one_active_per_tenant`, Phase 3) has no access to a tenant's
entitlements. A constraint saying "never two" and an add-on saying "two if granted"
are mutually exclusive; Postgres cannot arbitrate. The invariant wins.

**Validation command.** `npm run test:gb-rounds` (new suite)

**RED** (`0aa3f9d`) — 9 passed, 1 failed:

```
✗ no legacy multipleActive flag can widen the rule — 3 == 1
```

`group-buy.ts:192` read `return caps.multipleActive ? live : live.slice(0, 1)`.

**GREEN** (`30429e9`) — 10 passed, 0 failed. `liveGroupBuys` now always slices to the
earliest-created live round.

**Guaranteed by the passing tests.** No capability combination — including a stale
client bundle still passing the removed flag — can produce two live rounds. Round
attribution and the on-hand gate both ride on `liveGroupBuys`, so they inherit the
guarantee.

**Pre-flight against the live DB** (read-only, before removal):

```
RESULT A: no TenantFeatureOverride rows for groupbuy.multiple_active — safe to remove.
RESULT B: 0 tenant(s) have a stored-active round, none with >1 — partial index applies cleanly.
```

The removal therefore changed no tenant's behavior, and Phase 3's index will apply
without a data cleanup.

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | Every catalog feature is grantable from super admin — none renders "Locked · upgrade to null" | `test-plan-scope.ts:every catalog feature is reachable from admin → Features` | unit | PASS | `npm run test:plan-scope` |
| 2 | Two stored-active rounds collapse to one under every capability combo | `test-gb-rounds.ts:two stored-active rounds collapse to one…` | unit | PASS | `npm run test:gb-rounds` |
| 3 | The surviving round is earliest-created (deterministic, not insertion-ordered) | `test-gb-rounds.ts:the surviving round is the earliest-created…` | unit | PASS | `npm run test:gb-rounds` |
| 4 | A stale `multipleActive` flag cannot widen the one-active rule | `test-gb-rounds.ts:no legacy multipleActive flag can widen the rule` | unit | PASS | `npm run test:gb-rounds` |
| 5 | A lapsed round is excluded from live and cannot occupy the single slot | `test-gb-rounds.ts:a lapsed round is excluded from live…` | unit | PASS | `npm run test:gb-rounds` |
| 6 | An order is never attributed to a closed round | `test-gb-rounds.ts:an order is never attributed to a closed round` | unit | PASS | `npm run test:gb-rounds` |
| 7 | The on-hand gate is built from at most one live round | `test-gb-rounds.ts:the gate is built from at most one live round` | unit | PASS | `npm run test:gb-rounds` |

Whole-project typecheck: `npx tsc --noEmit` → **exit 0, no errors**.

Regression sweep — **17/17 suites PASS**: `gb-rounds`, `plan-scope`,
`plan-feature-config`, `plan-distribution`, `feature-disclosure`,
`feature-spotlight`, `trial-gating`, `trial-expiry`, `trial-state`, `reviews`,
`coa-protocols`, `staff`, `cart`, `checkout-total`, `gate`, `themes`, `plan-status`.

## Coverage and known gaps

This repo has no global coverage instrumentation — there is no `test:coverage`
script; suites are hand-rolled `tsx` scripts over `node:assert`. The 80% figure
therefore cannot be mechanically reported, and is **not** claimed here. Coverage was
instead advanced in absolute terms: `src/lib/storefront/group-buy.ts` had **zero**
test coverage before this work — none of the 33 registered suites imported it,
leaving `liveGroupBuys`, `effectiveGroupBuyStatus`, `groupBuyForOrder` and
`buildGroupBuyGate` untested. `npm run test:gb-rounds` is its first suite (10 tests).

**Known gaps / follow-ups:**

- **Phase 2 (security, NOT yet done).** Checkout does not reject a purchase from a
  closed or non-active round. `groupBuyForOrder` only *attributes* — it returns
  `null` and lets the order proceed. `groupBuyOnHandViolation` is the only rejecting
  check and early-returns "allow" unless `groupBuyAllowOnHand === false` (default
  `true`). **Open design question:** the spec's §5 model does not map 1:1 onto this
  schema — the spec binds a product to a round via `products.group_buy_id`, whereas
  here rounds own `productIds` and a product is not owned by any round. "Buy from a
  closed round" is therefore not directly expressible; once a round closes its
  products revert to ordinary on-hand stock. The intended semantics need an operator
  decision before implementation.
- **Phase 3.** `saveGroupBuyAction`'s single-active guard is now unconditional but
  remains a read-then-write with no transaction; it still races under concurrent
  saves. The DB partial unique index is the real fix.
- **`stampGroupBuy`** (`orders.ts:345-363`) wraps attribution in
  `try {} catch { /* best-effort */ }` — an entitlement or DB error silently stamps
  `null` and the order is placed unattributed.
- **Rate limiting** (`src/lib/security/rate-limit.ts`) is an in-process `Map`, so on
  multi-instance/serverless the effective limit multiplies by instance count.
- No auth audit trail exists (Phase 6).

## Merge evidence

If these commits are squashed, preserve: two RED→GREEN pairs.
`9d0c1e3` RED (`18 passed, 1 failed` — `storefront.access_code` unreachable) →
`3f386ea` GREEN (`19 passed, 0 failed`).
`0aa3f9d` RED (`9 passed, 1 failed` — `3 == 1`) →
`30429e9` GREEN (`10 passed, 0 failed`). `tsc --noEmit` exit 0; 17/17 suites pass.

Both fix commits were staged as isolated hunks: an unrelated, uncommitted
COA/protocols changeset from a concurrent session shares `catalog.ts` and
`package.json` and was deliberately left untouched.
