/**
 * Self-contained test for the operator-editable plan→feature CEILING config —
 * the "manage which functionalities are included for each package" super-admin
 * control. Runs the REAL pure helpers (no DB, no Next runtime) so the editor,
 * the entitlement sync, and the demo-mode resolver never drift.
 *
 *   - src/lib/platform/plan-feature-config.ts
 *       defaultPlanFeatureConfig()          — the catalog PLAN_FEATURES, lifted
 *                                             into the editable shape.
 *       normalizePlanFeatureConfig(input)   — sanitize untrusted/stored JSON into
 *                                             a well-formed config (never throws).
 *       resolvePlanCeiling(config, planKey) — effective Set<FeatureKey> for a plan
 *                                             (override or default; handles aliases).
 *       resolvePlanFeatureSets(config)      — the 3 canonical plans → key arrays,
 *                                             the shape syncPlanCatalog consumes.
 *   - src/lib/features/plan-scope.ts
 *       getPlanScope(planKey, ceiling?)     — honours an explicit ceiling override.
 *
 *   npm run test:plan-feature-config
 */

import assert from "node:assert";

import { FEATURES, PLAN_FEATURES, type FeatureKey } from "../src/lib/features/catalog";
import {
  defaultPlanFeatureConfig,
  normalizePlanFeatureConfig,
  resolvePlanCeiling,
  resolvePlanFeatureSets,
  PLAN_FEATURES_CONFIG_KEY,
} from "../src/lib/platform/plan-feature-config";
import { getPlanScope } from "../src/lib/features/plan-scope";
import {
  normalizeFeatureRegistry,
  effectiveNewFeatures,
  reconcileRegistry,
  isRegistryInitialized,
  type FeatureRegistry,
} from "../src/lib/platform/feature-registry";
import { ALL_FEATURES } from "../src/lib/features/catalog";

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e instanceof Error ? e.message : String(e)}`);
  }
}

const sorted = (a: readonly string[]) => [...a].sort();

console.log("plan-feature-config\n");

check("the setting key is stable", () => {
  assert.equal(PLAN_FEATURES_CONFIG_KEY, "plan_features_config");
});

check("default config mirrors the catalog PLAN_FEATURES exactly", () => {
  const cfg = defaultPlanFeatureConfig();
  assert.deepEqual(sorted(cfg.plans.starter), sorted(PLAN_FEATURES.starter));
  assert.deepEqual(sorted(cfg.plans.pro), sorted(PLAN_FEATURES.pro));
  assert.deepEqual(sorted(cfg.plans.enterprise), sorted(PLAN_FEATURES.enterprise));
});

check("normalize(undefined) → the defaults (never throws)", () => {
  assert.deepEqual(normalizePlanFeatureConfig(undefined), defaultPlanFeatureConfig());
  assert.deepEqual(normalizePlanFeatureConfig(null), defaultPlanFeatureConfig());
  assert.deepEqual(normalizePlanFeatureConfig("garbage"), defaultPlanFeatureConfig());
});

check("normalize keeps only the 3 canonical plans, missing plans fall back", () => {
  const cfg = normalizePlanFeatureConfig({ plans: { pro: [FEATURES.SITE_HOMEPAGE] } });
  assert.deepEqual(Object.keys(cfg.plans).sort(), ["enterprise", "pro", "starter"]);
  // starter/enterprise weren't supplied → their defaults
  assert.deepEqual(sorted(cfg.plans.starter), sorted(PLAN_FEATURES.starter));
  // pro was supplied → exactly the supplied (valid) key
  assert.deepEqual(cfg.plans.pro, [FEATURES.SITE_HOMEPAGE]);
});

check("normalize drops unknown feature keys and dedupes", () => {
  const cfg = normalizePlanFeatureConfig({
    plans: { starter: [FEATURES.SITE_HOMEPAGE, "not.a.real.feature", FEATURES.SITE_HOMEPAGE] },
  });
  assert.deepEqual(cfg.plans.starter, [FEATURES.SITE_HOMEPAGE]);
});

check("normalize ignores an unknown plan key entirely", () => {
  const cfg = normalizePlanFeatureConfig({
    plans: { starter: [FEATURES.SITE_HOMEPAGE], platinum: [FEATURES.INTEGRATIONS] },
  });
  assert.deepEqual(Object.keys(cfg.plans).sort(), ["enterprise", "pro", "starter"]);
  assert.equal("platinum" in cfg.plans, false);
});

check("resolvePlanCeiling: override wins over the catalog default", () => {
  const cfg = normalizePlanFeatureConfig({ plans: { starter: [FEATURES.SITE_HOMEPAGE] } });
  const ceiling = resolvePlanCeiling(cfg, "starter");
  assert.equal(ceiling.has(FEATURES.SITE_HOMEPAGE), true);
  assert.equal(ceiling.has(FEATURES.SITE_BLOG), false); // in the default, removed by override
});

check("resolvePlanCeiling: legacy plan aliases resolve to their canonical config", () => {
  const cfg = defaultPlanFeatureConfig();
  // "growth" is the legacy alias for enterprise
  assert.deepEqual(sorted([...resolvePlanCeiling(cfg, "growth")]), sorted(PLAN_FEATURES.enterprise));
  assert.deepEqual(sorted([...resolvePlanCeiling(cfg, "basic")]), sorted(PLAN_FEATURES.starter));
});

check("resolvePlanCeiling: unknown plan falls back to starter", () => {
  const cfg = defaultPlanFeatureConfig();
  assert.deepEqual(sorted([...resolvePlanCeiling(cfg, "mystery")]), sorted(PLAN_FEATURES.starter));
});

check("resolvePlanFeatureSets returns exactly the 3 canonical plans (sync shape)", () => {
  const sets = resolvePlanFeatureSets(defaultPlanFeatureConfig());
  assert.deepEqual(Object.keys(sets).sort(), ["enterprise", "pro", "starter"]);
  assert.deepEqual(sorted(sets.enterprise), sorted(PLAN_FEATURES.enterprise));
});

check("getPlanScope honours an explicit ceiling override", () => {
  // Add an operator-grantable feature (normally an 'addon') into pro's ceiling.
  const ceiling = new Set<FeatureKey>([FEATURES.SITE_HOMEPAGE, FEATURES.STORE_CARD_STUDIO]);
  const scope = getPlanScope("pro", ceiling);
  const flat = scope.groups.flatMap((g) => g.features);
  const homepage = flat.find((f) => f.key === FEATURES.SITE_HOMEPAGE);
  const cardStudio = flat.find((f) => f.key === FEATURES.STORE_CARD_STUDIO);
  assert.ok(homepage, "homepage should be in scope");
  assert.equal(homepage!.state, "included");
  // Card Studio is OPERATOR_GRANTABLE but here it's inside the ceiling → included, not addon.
  assert.ok(cardStudio, "card studio should be in scope");
  assert.equal(cardStudio!.state, "included");
  // A feature NOT in the override ceiling and not operator-grantable is absent.
  assert.equal(flat.some((f) => f.key === FEATURES.ECOM_CART), false);
});

check("getPlanScope without an override still matches the catalog default", () => {
  const withDefault = getPlanScope("pro");
  const withExplicit = getPlanScope("pro", resolvePlanCeiling(defaultPlanFeatureConfig(), "pro"));
  const keys = (s: ReturnType<typeof getPlanScope>) =>
    sorted(s.groups.flatMap((g) => g.features.map((f) => `${f.key}:${f.state}`)));
  assert.deepEqual(keys(withExplicit), keys(withDefault));
});

// ──────────────────────────── feature registry (new-functionality tags) ────────
console.log("\nfeature-registry\n");

check("normalize(garbage) → empty registry (uninitialized, never throws)", () => {
  const r = normalizeFeatureRegistry("nonsense");
  assert.deepEqual(r, { known: [], newKeys: [] });
  assert.equal(isRegistryInitialized(r), false);
});

check("fresh install (no baseline) surfaces NOTHING as new", () => {
  const r: FeatureRegistry = { known: [], newKeys: [] };
  assert.equal(effectiveNewFeatures(r).size, 0);
});

check("a catalog key missing from the baseline is detected as new", () => {
  // baseline = everything except the last catalog key → that key reads as new.
  const missing = ALL_FEATURES[ALL_FEATURES.length - 1];
  const known = ALL_FEATURES.filter((k) => k !== missing);
  const eff = effectiveNewFeatures({ known, newKeys: [] });
  assert.equal(eff.has(missing), true);
  assert.equal(eff.size, 1);
});

check("persisted newKeys always surface as new", () => {
  const eff = effectiveNewFeatures({ known: [...ALL_FEATURES], newKeys: [FEATURES.GB_MODULE] });
  assert.equal(eff.has(FEATURES.GB_MODULE), true);
});

check("reconcile records the full catalog as the baseline", () => {
  const r = reconcileRegistry({ known: [], newKeys: [] });
  assert.deepEqual(sorted(r.known), sorted(ALL_FEATURES));
  assert.equal(isRegistryInitialized(r), true);
});

check("reconcile auto-carries a detected addition into newKeys (default keepNew)", () => {
  const missing = ALL_FEATURES[0];
  const known = ALL_FEATURES.filter((k) => k !== missing);
  const r = reconcileRegistry({ known, newKeys: [] });
  assert.equal(r.newKeys.includes(missing), true);
});

check("reconcile with explicit keepNew honours the operator's dismissals", () => {
  // Two features flagged new; operator keeps only one.
  const r = reconcileRegistry(
    { known: [...ALL_FEATURES], newKeys: [FEATURES.GB_MODULE, FEATURES.STORE_REVIEWS] },
    [FEATURES.GB_MODULE],
  );
  assert.equal(r.newKeys.includes(FEATURES.GB_MODULE), true);
  assert.equal(r.newKeys.includes(FEATURES.STORE_REVIEWS), false);
});

check("reconcile drops unknown keys from an explicit keepNew", () => {
  const r = reconcileRegistry({ known: [...ALL_FEATURES], newKeys: [] }, ["not.a.real.feature"]);
  assert.deepEqual(r.newKeys, []);
});

// ──────────────────────────── summary ────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
