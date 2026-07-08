# TDD evidence — Package contents (per-package feature management)

**Feature:** Super Admin can manage which catalog functionalities each package
(Starter / Business / Automated) includes, from `/admin/plans` → **Package contents**.

## What changed

The plan→feature *ceiling* used to be hardcoded in `src/lib/features/catalog.ts`
(`PLAN_FEATURES`) and only synced one-way into the DB `plan_features` join. It is
now operator-editable and persisted as the `plan_features_config` PlatformSetting,
mirroring the existing `plan_config` (pricing) override pattern.

- **`src/lib/platform/plan-feature-config.ts`** — pure, client-safe. `PlanFeatureConfig`
  shape, `defaultPlanFeatureConfig()` (lifts catalog `PLAN_FEATURES`),
  `normalizePlanFeatureConfig()` (allow-lists valid keys, keeps the 3 canonical
  plans, never throws), `resolvePlanCeiling()` (config-or-default, alias-aware),
  `resolvePlanFeatureSets()` (the shape `syncPlanCatalog` consumes).
- **`src/lib/platform/plan-feature-config-server.ts`** — `getPlanFeatureConfig()`
  (demo file / `platform_settings` row / catalog fallback).
- **`src/lib/features/catalog-sync.ts`** — `syncPlanCatalog(prisma, planFeatureSets?)`
  now reconciles the DB to any given ceiling (defaults to catalog `PLAN_FEATURES`).
- **`src/lib/features/plan-scope.ts`** — `getPlanScope(planKey, ceilingOverride?)`
  reflects the live edited ceiling.
- **`src/actions/admin-plan-features.ts`** — `savePlanFeaturesConfigAction`: operator-gated,
  persists the config, re-syncs `plan_features`, busts every tenant's
  `tenant:<id>:entitlements` cache. Rejects an all-off package.
- **`src/actions/admin-plan-config.ts`** — the pricing save now syncs using the saved
  ceiling, so it never clobbers feature edits back to catalog defaults.
- **`src/lib/demo/fixtures.ts`** — `getDemoEntitlements` resolves the ceiling from the
  same config in demo mode.
- **`scripts/sync-plan-features.ts`** — `db:sync-features` reconciles to the saved
  config, not raw catalog.
- **UI:** `src/components/admin/pages/PlanFeaturesEditor.tsx` (per-package grouped
  toggle checklist, per-package reset, save) wired into `/admin/plans`.

## Consequence (by design)

Because `getEntitlements` reads `plan.features` live, editing a package applies to
**all existing tenants on that plan**. Per-tenant `TenantFeatureOverride` grants/revokes
still win, so individual exceptions are preserved.

## Tests

`scripts/test-plan-feature-config.ts` (`npm run test:plan-feature-config`) — pure,
no DB / no Next runtime:

- RED first (helpers did not exist → import failure).
- GREEN: **12 passed, 0 failed** — default mirrors catalog, normalize sanitizes
  (unknown keys dropped, dedupe, missing plan → default, unknown plan ignored, never
  throws), `resolvePlanCeiling` (override wins, aliases, unknown→starter),
  `resolvePlanFeatureSets` shape, and `getPlanScope` honouring an explicit ceiling.

Regression: `npm run test:plan-scope` — **16 passed, 0 failed** (the optional param
is backward-compatible). `tsc --noEmit` clean. Module-chain + resolution smoke passed.

---

# "New functionality" tags (auto-detect + super-admin controlled)

**Feature:** When a new functionality is added to the catalog it is auto-detected;
the Super Admin sees it flagged **New** in Package contents (to assign to packages),
and store owners see a **New** tag on the module in their storefront admin until the
Super Admin dismisses it.

## What changed

- **`src/lib/platform/feature-registry.ts`** — pure. `feature_registry` PlatformSetting
  shape `{ known, newKeys }`. `effectiveNewFeatures()` = persisted flags ∪ catalog keys
  not in the recorded baseline (auto-detected additions; nothing on a fresh install).
  `reconcileRegistry()` records the current catalog as baseline and persists the kept
  New flags (honouring operator dismissals).
- **`src/lib/platform/feature-registry-server.ts`** — `getFeatureRegistry()` /
  `persistFeatureRegistry()` (demo file / `platform_settings` / never-throw read).
- **`src/actions/admin-plan-features.ts`** — `savePlanFeaturesConfigAction(config, newKeys)`
  reconciles the registry alongside the ceiling. `src/actions/admin-plan-config.ts`
  arms the baseline (auto-carry) on the pricing save.
- **UI (super admin):** `PlanFeaturesEditor` shows a dismissible **New** badge per
  feature + a count; dismissals persist on save.
- **UI (storefront admin):** `Brand.newModules` (server-derived in
  `app/(tenant)/(storefront)/page.tsx` via `newModulesFor` + the registry's persisted
  `newKeys`) → `AdminPage` renders a **New** pill on the module's Quick Action
  (`.admin-quick__new` in `storefront.css`). `visibility.ts` `MODULE_FEATURE` maps each
  admin module id to its gating feature key.

## Detection lifecycle (by design)

`known` is the baseline; a catalog key absent from it reads as new. The baseline is
armed by ordinary operator activity (either save on `/admin/plans`). Store owners only
see a tag the operator **kept** (persisted `newKeys`) — detected-but-unsaved additions
never leak to stores.

## Tests

Extended `scripts/test-plan-feature-config.ts` — **feature-registry** block:
normalize/never-throws, fresh install surfaces nothing, baseline-missing key detected,
persisted flags surface, reconcile records baseline, auto-carry vs explicit `keepNew`
(dismissals), unknown-key drop. Total suite: **20 passed, 0 failed**. `tsc` clean.
`newModulesFor` mapping smoke passed (`groupbuy.module`→`groupbuys`, `card_studio`→`design`,
site key→none).
