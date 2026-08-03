# TDD evidence — turning a store preset back off

**Branch:** `feat/gb-pricing-tab`
**Commits:** `9668665` (RED) → `9d26ada` (GREEN, core) → `9fe1fab` (operator surfaces)

## Source plan

No `*.plan.md`. Journeys were derived during this TDD run from the request:

> Store preset — Stamp a whole store shape onto this tenant … K Glow — Group buy + on-hand …
> **Preview changes allow this feature to be turned on and off**

The last line read two ways (un-apply the whole preset vs. tick individual changes before
applying). Clarified with the user before any test was written:

- **Scope:** un-apply the whole preset — a *Remove preset* path beside Apply.
- **Revert depth:** leave the seeded owner blocks (`groupBuyRules`, `groupBuyContent`,
  `groupBuySettings`) and the theme alone.

## User journeys

Existing J1–J4 (apply) were already covered. This run adds:

> **J5** As a platform operator, I want to turn a stamped store shape back off, so that a tenant
> that stops running group buys is not stuck with it — without destroying the owner's rules, copy,
> catalog or theme, and without silently flipping an absent-means-ON key the wrong way.

## Task report

### 1. Pure inverse: `removeTenantPreset` + a per-preset `off` block

Each preset now declares `off`, saying per structural key whether removal **clears** it
(`PRESET_UNSET`) or **resets** it to a literal. Declared, not derived.

Validation: `npm run test:tenant-presets`

RED (`9668665`):

```
12. Remove the preset (J5)
  ✗ every preset declares an off value for exactly the keys its config owns — Cannot convert undefined or null to object
  ✗ removing never reports a theme change — the tenant keeps its look — (0 , import_presets.removeTenantPreset) is not a function
  … 16 more
46 passed, 18 failed
```

GREEN (`9d26ada`): `64 passed, 0 failed`.

**Guaranteed:** removal touches only the preset's own structural keys and its entitlements. The
theme, identity, secrets, catalog, COA reports and the owner-editable group-buy blocks all survive.
Removal is idempotent and non-mutating, and `apply → remove → apply` restores the stamped shape.

### 2. A bug the RED tests caught mid-implementation

The first GREEN attempt failed one assertion — *"removing a preset the tenant never had is a no-op"*
— because `off.homeLayout = "classic"` was written unconditionally:

```
[ { from: undefined, key: 'homeLayout', kind: 'config', to: 'classic' } ]
should loosely deep-equal []
```

Not cosmetic: removing the preset from a tenant that never had it would have stamped
`homeLayout: "classic"` and **taken down a two-ways home that tenant got from its plan**. Fixed in
the implementation (not the test) with a rule the whole `off` block now follows — *removal only ever
touches keys that are currently set*, since an absent key means the preset is not in effect there.
That guard is also what makes a second removal a true no-op.

### 3. Why "off" is not just `false`

Three keys were verified against their real read sites before the `off` block was written:

| Key | Read as | Writing `false` would… | Removal does |
|---|---|---|---|
| `groupBuyAllowOnHand` | `!== false` (`lib/storefront/on-hand-gate.ts:111`) | **pause on-hand sales** — an active setting, not an off-switch | clear it |
| `showPageCOA` | `!== false` (`storefront/visibility.ts:39`) | keep Lab Reports hidden past a future re-grant | clear it |
| `homeLayout` | absent-while-entitled ⇒ `two-ways` (`lib/storefront/two-ways-home.ts:107`) | — (the mirror trap: *clearing* is the hazard) | keep explicit `"classic"` |

### 4. Operator surfaces

`previewRemoveTenantPresetAction` / `removeTenantPresetAction` in `src/actions/tenant-presets.ts`,
and a *Remove preset* → *Confirm removal* path on `ApplyTenantPresetCard`.

Validation: `npx tsc --noEmit --pretty false --incremental` → **exit 0**.

Two asymmetries the UI states rather than hides:

- Apply grants only what is missing; **remove revokes every one of the preset's features the tenant
  currently has**, including any held before the preset was applied — nothing records which grants
  the preset itself introduced. Previewed before writing.
- Revoking a **plan-granted** feature writes a deny override that outlives the preset. The preview
  names those keys in a warning; the store would otherwise silently lose a feature it pays for.

Overrides are upserted to `enabled: false`, never deleted — a delete falls back to the plan and
re-grants. Branding is `update`-only on the remove path, so reverting a preset that was never
applied cannot create a config row the tenant never had.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Every preset declares an `off` value for exactly the keys its `config` owns | `test-tenant-presets.ts:every preset declares an off value…` | unit | PASS |
| 2 | No `off` block touches a seeded default or a forbidden key | `…no preset's off block touches a seeded default or a forbidden key` | unit | PASS |
| 3 | Removal never proposes a theme change | `…removing never reports a theme change` | unit | PASS |
| 4 | The owner's edited group-buy rules, copy and round defaults survive removal | `…removing keeps the owner's edited group-buy rules, copy and round defaults` | unit | PASS |
| 5 | Identity, secrets, categories and COA reports survive removal | `…removing keeps identity, secrets and the owner's own content` | unit | PASS |
| 6 | `groupBuyAllowOnHand` is cleared, never set to `false` (would pause on-hand sales) | `…removing UNSETS groupBuyAllowOnHand rather than writing false` | unit | PASS |
| 7 | `showPageCOA` is cleared, never set to `false` (would survive a re-grant) | `…removing UNSETS showPageCOA rather than writing false` | unit | PASS |
| 8 | `homeLayout` stays explicitly `"classic"` — an absent key while entitled reads as two-ways | `…removing keeps homeLayout explicitly classic` | unit | PASS |
| 9 | Store-admin group-buy surfaces are switched off | `…removing switches the store-admin surfaces off` | unit | PASS |
| 10 | Exactly the preset's currently-enabled features are revoked | `…removing revokes exactly the preset's features that are currently enabled` | unit | PASS |
| 11 | Nothing the tenant does not have is revoked | `…removing revokes nothing the tenant does not already have` | unit | PASS |
| 12 | A revoke is a distinct change kind from a grant | `…removing reports one revoke change per feature, distinct from a grant` | unit | PASS |
| 13 | Every cleared config key is reported | `…removing reports each config key it clears` | unit | PASS |
| 14 | A second removal changes nothing (idempotent) | `…removing is idempotent` | unit | PASS |
| 15 | Removing a preset the tenant never had is a no-op | `…removing a preset the tenant never had is a no-op` | unit | PASS |
| 16 | The caller's state is never mutated | `…removing never mutates the caller's state` | unit | PASS |
| 17 | `apply → remove → apply` restores the stamped shape | `…apply → remove → apply restores the stamped shape` | unit | PASS |
| 18 | The `PRESET_UNSET` sentinel never reaches a persisted config | `…PRESET_UNSET is never persisted into a tenant's config` | unit | PASS |

All via `npm run test:tenant-presets` → **64 passed, 0 failed** (46 pre-existing apply assertions
still green).

## Coverage and known gaps

The gate is a pure, self-contained assertion script (no coverage instrumentation) — the same shape
as every sibling gate in `scripts/`. The pure core `removeTenantPreset` and every preset's `off`
block are fully covered by the 18 assertions above.

Deliberately **not** covered, and why:

1. **`src/actions/tenant-presets.ts` has no automated test.** It is DB-bound (Prisma + `next/cache`
   + `getPlatformUser`), and the pre-existing apply actions have no test either — adding a harness
   for one direction only would be inconsistent. Verified by `tsc --noEmit` (exit 0) and by review
   of the transaction. **The un-run paths are the `enabled: false` upsert, the `planGranted`
   warning query, and the update-only Branding guard.** Worth an integration test if the isolation
   harness (`npm run test:isolation`, PGlite) is ever extended to actions.
2. **No E2E/visual check of the card.** The change is two buttons and a conditional panel inside an
   existing operator-only surface, styled with the same `.sa` primitives already on the page.
3. **No live-tenant run.** Nothing was applied to or removed from a real tenant in this session.

## Follow-up cycle — presets no longer write the theme

**Commits:** `90bf893` (RED) → `f22c324` (GREEN)

Found while applying the preset to `dragon-peptides`: the dry run proposed
`theme dynasty-red → kglow`. The shipped behaviour contradicted the feature's own promise twice
over — the card says *"name, logo, colors … are never touched"*, and `PRESET_FORBIDDEN_KEYS`
already blocks every other identity key (`main`, `accent`, `headingFont`) while `themeId`, the one
key that sets all of them, was overwritten. It was also the single change `removeTenantPreset`
could not undo, so applying was a one-way door on a tenant's look.

Operator ruling: *"the feature should not change the website branding just apply the preset"*.

> **J6** As an operator, I want applying a store preset to leave the tenant's theme alone, so that
> stamping a store *shape* onto a live storefront never changes how it *looks*.

`themeId` removed from `TenantPreset`, `PresetApplication`, `TenantPresetTarget` and the
`PresetChange` union. Neither branding upsert writes it now: an existing tenant keeps its theme, a
new `Branding` row takes the schema default `"default"`. Onboarding keeps the operator's picked
`themeId` (it was previously being overridden by the preset), and the new-tenant picker loses its
*"overrides the theme picked above"* warning.

| Stage | Command | Result |
|---|---|---|
| RED | `npm run test:tenant-presets` | **58 passed, 7 failed** — all theme assertions |
| GREEN | `npm run test:tenant-presets` | **65 passed, 0 failed** |
| GREEN | `npx tsc --noEmit` | exit 0 |

New guarantees: no preset declares a `themeId`; applying returns no `themeId` and emits no theme
change, on a live tenant, a brand-new tenant, and malformed input alike.

## Live operator run — dragon-peptides (2026-08-03)

Also adds `scripts/apply-tenant-preset.ts` — dry-run-by-default CLI (`--apply` to write, `--remove`
to switch off), matching the `seed-dragon-products.ts` convention.

Applied `kglow-two-ways` to `dragon-peptides` (Starter, trial). `groupbuy.module` and
`groupbuy.rules` were already enabled, so only 2 grants were new. 10 config/grant changes written,
then a corrective write restored COA to off per the 2026-07-19 decision that dragon-peptides keeps
COA/protocols disabled (`gb-access-gate-port`).

Verified final state:

```
theme        : dynasty-red      ← untouched
homeLayout   : "classic"
groupBuyAllowOnHand   : true
showAdminGroupBuy     : true
showAnalyticsGroupBuys: true
showPageCOA  : false            ← COA kept off
groupBuySettings/Content/Rules : seeded

groupbuy.module         ON
groupbuy.rules          ON
groupbuy.two_ways_home  ON
storefront.coa          off
```

**Caveat:** the CLI writes directly to Postgres and cannot call `revalidateTenant`, so the
storefront and admin may serve stale entitlements for up to the 5-minute `unstable_cache`
`revalidate` window (`lib/features/entitlements.ts`). The admin *Store preset* card does revalidate;
prefer it when immediacy matters.

## Merge evidence

If these commits are squashed, preserve:

- **RED** `9668665` — 46 passed, 18 failed; `removeTenantPreset is not a function`, `p.off` undefined.
- **GREEN** `9d26ada` — 64 passed, 0 failed. One real bug caught between the two (§2).
- **Surfaces** `9fe1fab` — `tsc --noEmit` exit 0; gate still 64/64.
- No refactor commit: the code was written in its final shape and the §2 fix landed before GREEN.
