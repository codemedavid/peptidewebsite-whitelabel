# TDD evidence — bacteriostatic-water CAP (Order Ratio Control, `direction`)

**Branch:** `feat/gb-pricing-tab` · **Date:** 2026-07-30
**Source plan:** produced inline via `/ecc:plan` in this session (no `*.plan.md` artifact written).
**Related:** [`gb-order-ratio.tdd.md`](./gb-order-ratio.tdd.md) — the original FLOOR rule this extends.

## The problem

Two independent rules were nagging customers who only wanted peptides:

| Message seen at checkout | Source |
|---|---|
| "Peptide vials need bacteriostatic water for reconstitution — please add bacteriostatic water to your order." | `src/lib/storefront/checkout-rules.ts` → `bacWaterValidation` (defaulted ON) |
| "Every peptide needs 1 bacteriostatic water — add 2 more to check out." | `src/lib/storefront/group-buy-rules.ts` → `ratio` (Order Ratio Control, a FLOOR) |

Both are floors: they demand water. The requirement is the opposite — the limit
should only apply to a customer **buying** bac water, and it should be a ceiling:
bac water must never exceed the peptide vials in the cart. A peptide-only order
is a normal order.

## User journeys

1. As a customer buying peptides only, I want to check out without being told to add bacteriostatic water, so that I can order the vials I actually want.
2. As a customer buying peptides and water together, I want any amount of water up to my peptide vial count accepted, so that a sensible pairing just works.
3. As a customer who added more water than peptide vials, I want to be told to remove the surplus (never to "add more"), so that the message matches the mistake.
4. As a customer with water and no peptide in the cart, I want to be told to add a peptide first, because 0 peptides allow 0 water.
5. As a store owner, I want to choose per store whether the ratio *requires* water (floor) or *limits* it (cap), so that stores already on the floor keep working.
6. As an operator, I want stores already running the rule flipped to the cap in one auditable, idempotent, dry-runnable pass.

## Decisions recorded (asked before implementing)

| Question | Decision |
|---|---|
| Bac-water-only cart | **Block** — 0 peptides allow 0 water |
| Rule shape | **Add a `direction` toggle** (`"floor"` default, `"cap"` opt-in) rather than replacing the floor |
| Rollout | **All tenants using the ratio rule**, plus `bacWaterValidation` off store-wide |

## Task report

### Task 1 — RED: cap assertions before any engine change

Extended `scripts/test-gb-ratio.ts` with 16 new assertions (direction
normalization, `allowedBacWater`, the cap violation suite, cap message copy,
auto-add neutrality, legacy-ceiling suppression).

```
$ npm run test:gb-ratio
  ✗ DEFAULT rules ship the ratio block OFF, direction floor — undefined == 'floor'
  ✗ normalize: absent or junk direction → floor, 'cap' is kept — absent → floor
  ✗ allowedBacWater = peptide × ratio (the cap's ceiling)
      — (0 , import_group_buy_rules.allowedBacWater) is not a function
  ✗ CAP: a peptide-only cart is never nagged — {
      blocking: true,
      message: 'Every peptide needs 1 bacteriostatic water — add 1 more to check out.'
    } == null
  ✗ CAP: more bac water than peptide vials → blocking violation
  ✗ CAP: bac water with no peptide is blocked
  ✗ CAP + WARN: surplus violation is non-blocking
  ✗ CAP + AUTO_ADD: blocks like strict and never injects
  ✗ CAP supersedes the legacy maxPerPeptide ceiling (no double message)
  … 14 failures total

20 passed, 14 failed
```

The 4th failure is the reported bug verbatim: a cap-configured peptide-only cart
still emitted the floor's "add 1 more" block. All 18 pre-existing floor
assertions stayed green, proving the new switch defaults to today's behavior.

Checkpoint: `2d485c4 test: add reproducer for the bac-water cap direction`

### Task 2 — GREEN: direction-aware engine

`src/lib/storefront/group-buy-rules.ts`:

- `RatioDirection = "floor" | "cap"` + `RATIO_DIRECTIONS`, narrowed in `normalizeRatio`; `DEFAULT_RATIO.direction = "floor"` so configs saved before the switch keep their meaning.
- `allowedBacWater()` — the cap's ceiling, beside `requiredBacWater()`'s floor.
- Cap branch in `ratioViolation`: `bacWater === 0 → null` (peptide-only always passes) → `peptide === 0 → "Add a peptide before adding bacteriostatic water."` → `bacWater > allowed → DEFAULT_CAP_MESSAGE`.
- `ratioMessage(rules, fallback, vars)` takes the direction's default; cap tokens `{allowed} {bacWater} {surplus}` join `{ratio} {peptide}`.
- `autoAddPlan` is floor-only — injecting water under a cap would create the surplus the cap rejects.
- `groupBuyViolations` stands the legacy `bacWater.maxPerPeptide` ceiling down while a cap is active, so one problem never yields two near-identical messages.

```
$ npm run test:gb-ratio
34 passed, 0 failed
```

Checkpoint: `3ddc28d feat: enforce the bac-water ratio as a cap, not only a floor`

### Task 3 — Cart + admin surfaces

- `src/storefront/store.tsx` — the auto-add reconcile effect returns early unless `direction === "floor"`. Without this guard a cap store would have water injected up to `peptide × ratio` and hand the customer a cart that cannot check out. **This was the highest-risk defect in the change.**
- `src/storefront/admin/AdminGroupBuyRules.tsx` — a Direction select; the ratio label ("Max bac water per peptide vial"), hints, message placeholder and token list all follow it; auto-add is hidden under a cap; switching direction rewrites contradictions (`auto_add → strict`, other-direction copy → built-in default).
- `src/lib/storefront/checkout-rules.ts` — `CHECKOUT_RULES_DEFAULTS.bacWaterValidation: true → false`, with the reasoning in the type comment; the `AdminCheckoutRules` hint warns that it contradicts a cap.

```
$ npx tsc --noEmit          # clean for all changed files
$ npm run test:gb-ratio        → 34 passed, 0 failed
$ npm run test:cart            → 15 passed, 0 failed
$ npm run test:two-ways-cart   → 20 passed, 0 failed
$ npm run test:onhand-gate     →  9 passed, 0 failed
$ npm run test:tenant-presets  → 46 passed, 0 failed
```

Checkpoint: `6f35c1e feat: wire the bac-water cap through the cart and store admin`

### Task 4 — All-tenant migration

`scripts/migrate-bacwater-cap.ts` (`npm run migrate:bacwater-cap`, dry run unless `--apply`).

```
$ npm run migrate:bacwater-cap
bac-water cap migration — DRY RUN (13 tenants)
  ✎ k-glow
      ratio.direction: floor → cap
  · 12 others — no change (ratio rule not in use)
1 tenant(s) to update, 12 unchanged.

$ npm run migrate:bacwater-cap -- --apply
1 tenant(s) updated, 12 unchanged.

$ npm run migrate:bacwater-cap        # idempotency
  · k-glow                 — no change (already capped)
0 tenant(s) to update, 13 unchanged.
```

No tenant had `bacWaterValidation` stored, so the "Peptide vials need
bacteriostatic water" prompt was coming from the old ON **default** — the default
flip alone retires it store-wide.

Checkpoint: `a72ee3a feat: migrate stores running the ratio rule onto the bac-water cap`

### Task 5 — Live-config verification, then a copy refactor

The Chrome DevTools MCP profile was held by another session, so instead of
clicking the cart the shipped engine was run against **k-glow's live stored
config and live 44-product catalog** (temporary read-only script, deleted after
the run — it wrote nothing).

```
live k-glow config:
  ratio: enabled=true direction=cap mode=strict perPeptide=1 message=""
  engine enabled=true  validation cart=true checkout=true
  checkoutRules.bacWaterValidation=false
live catalog: 44 products — peptide sample "MT-2 (Melanotan 2 Acetate)",
                            bac-water sample "Bacteriostatic Water"

  ✓ 1 peptide, no water      → pass
  ✓ 10 peptide, no water     → pass
  ✓ 3 peptide, 1 water       → pass
  ✓ 3 peptide, 3 water       → pass
  ✓ 3 peptide, 4 water       → block  "…your cart allows 3, you have 4. Please remove 1."
  ✓ 1 peptide, 5 water       → block  "…your cart allows 1, you have 5. Please remove 4."
  ✓ 0 peptide, 2 water       → block  "Add a peptide before adding bacteriostatic water."
```

That run surfaced one copy defect the unit tests didn't assert: the default read
"**1 peptide vials** allow 1". `DEFAULT_CAP_MESSAGE` was rephrased to "your cart
allows {allowed}, you have {bacWater}", which agrees at every quantity;
`{peptide}` remains available as a token. `test:gb-ratio` stayed 34/34.

Checkpoint: `3e8a18f refactor: make the cap message read correctly at every quantity`

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A peptide-only cart produces no ratio message at any quantity under a cap | `test-gb-ratio.ts:CAP: a peptide-only cart is never nagged` | unit | PASS |
| 2 | Bac water at or below the peptide vial count is accepted | `test-gb-ratio.ts:CAP: bac water up to the peptide count is allowed` | unit | PASS |
| 3 | Surplus bac water blocks checkout | `test-gb-ratio.ts:CAP: more bac water than peptide vials → blocking violation` | unit | PASS |
| 4 | A 2:1 cap allows two water per peptide and blocks the third | `test-gb-ratio.ts:CAP: 2:1 cap allows two water per peptide, blocks the third` | unit | PASS |
| 5 | Bac water with no peptide is blocked with "add a peptide" copy | `test-gb-ratio.ts:CAP: bac water with no peptide is blocked` | unit | PASS |
| 6 | An empty or accessory-only cart never violates | `test-gb-ratio.ts:CAP: an empty cart produces no violation` | unit | PASS |
| 7 | Warn mode surfaces the cap message without blocking | `test-gb-ratio.ts:CAP + WARN: surplus violation is non-blocking` | unit | PASS |
| 8 | auto_add neither bypasses the cap nor injects water into a cap cart | `test-gb-ratio.ts:CAP + AUTO_ADD: blocks like strict and never injects` | unit | PASS |
| 9 | Cap copy interpolates `{allowed}` / `{bacWater}` / `{surplus}` and never says "add" | `test-gb-ratio.ts:CAP: the message interpolates the cap tokens`, `…default message names the numbers` | unit | PASS |
| 10 | The admin's per-product `productClass` tag decides what counts as water | `test-gb-ratio.ts:CAP: classification tag decides what counts as water` | unit | PASS |
| 11 | An active cap silences the legacy `maxPerPeptide` ceiling (no double message) | `test-gb-ratio.ts:CAP supersedes the legacy maxPerPeptide ceiling` | unit | PASS |
| 12 | The legacy ceiling still works for tenants not on the cap | `test-gb-ratio.ts:the legacy maxPerPeptide ceiling still works on its own` | unit | PASS |
| 13 | Absent/garbage `direction` normalizes to `"floor"` — stored configs keep their meaning | `test-gb-ratio.ts:normalize: absent or junk direction → floor` | unit | PASS |
| 14 | Every pre-existing FLOOR behavior is unchanged (18 assertions) | `test-gb-ratio.ts` floor suite | unit | PASS |
| 15 | Cart pricing, two-ways cart rules, on-hand gate and tenant presets are unaffected | `test:cart`, `test:two-ways-cart`, `test:onhand-gate`, `test:tenant-presets` | integration | PASS (90) |

## Coverage and known gaps

`npm run test:gb-ratio` covers every branch of `ratioViolation`, `allowedBacWater`,
`autoAddPlan` and the cap/legacy interaction in `groupBuyViolations`. This repo has
no aggregate coverage runner; per project convention, coverage is demonstrated by
the per-feature script suites listed above (124 assertions green).

Untested by automation, deliberately:

- **The store-admin Direction UI and the `store.tsx` effect guard** — no React test harness exists in this repo. The guard's underlying rule (`autoAddPlan` returns 0 under a cap) *is* asserted, and k-glow runs `mode: strict` so the auto-add effect is inert there today; the effect wiring itself is verified by reading only.
- **No browser click-through was performed** (the Chrome MCP profile was locked by another session). Task 5 verified the rule end-to-end against the live config and catalog instead, which does not cover the cart drawer's rendering of the violation.
- `scripts/kglow-test-gb.ts` (untracked scratch file from a prior session) has a pre-existing `tsc` error, unrelated to this change and left alone.

## Merge evidence

If these commits are squashed, the RED→GREEN record is: RED `2d485c4` (20 passed,
14 failed — cap assertions failing because `direction`/`allowedBacWater` did not
exist, floor suite green) → GREEN `3ddc28d` (34 passed, 0 failed) → surfaces
`6f35c1e` (124 assertions green across five suites, `tsc` clean) → migration
`a72ee3a` (k-glow flipped, idempotent re-run confirmed) → refactor `3e8a18f`
(cap copy fixed after live verification, 34/34 held).

## Reverting

Set the store back to the floor from the store admin (Group Buy Rules → Order
Ratio Control → Direction) or by writing `groupBuyRules.ratio.direction = "floor"`.
To restore the old "please add bacteriostatic water" prompt, turn Smart Checkout →
Bac water validation back on per store.
