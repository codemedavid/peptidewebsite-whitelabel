/**
 * Self-contained test for the plan→feature SCOPE helpers. Runs the REAL pure
 * helpers (no DB, no Next runtime) so the /admin/plans "Functional scope" panel
 * and the "Generate bullets" button always reflect the catalog source of truth
 * (src/lib/features/catalog.ts) — and never drift from what a tenant on that
 * plan actually gets.
 *
 *   - src/lib/features/plan-scope.ts
 *       getPlanScope(planKey)     — grouped, state-tagged feature list for a plan
 *                                   (included | included-needs-addon | addon).
 *       bulletsFromScope(planKey) — delta-aware marketing bullets derived from
 *                                   the plan's real feature ceiling.
 *
 *   npm run test:plan-scope
 */

import assert from "node:assert";

import {
  FEATURES,
  FEATURE_GROUPS,
  FEATURE_META,
  OPERATOR_GRANTABLE,
  planFeatureSet,
  type FeatureKey,
} from "../src/lib/features/catalog";
import {
  getPlanScope,
  bulletsFromScope,
  type FeatureState,
} from "../src/lib/features/plan-scope";

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
    console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Limits enforced by normalizePlanConfig (src/lib/platform/plan-config.ts).
const MAX_BULLETS = 12;
const MAX_BULLET_LEN = 160;

function allScopeFeatures(planKey: string) {
  return getPlanScope(planKey).groups.flatMap((g) => g.features);
}
function stateOf(planKey: string, key: FeatureKey): FeatureState | undefined {
  return allScopeFeatures(planKey).find((f) => f.key === key)?.state;
}

console.log("\nPlan scope helpers — pure core\n");

// ───────────────────────────────── getPlanScope ─────────────────────────────
console.log("getPlanScope");

check("groups are emitted in FEATURE_GROUPS order", () => {
  const groups = getPlanScope("starter").groups.map((g) => g.group);
  const expectedOrder = FEATURE_GROUPS.filter((g) => groups.includes(g));
  assert.deepEqual(groups, expectedOrder);
});

check("every plan-ceiling feature appears exactly once and is included", () => {
  const ceiling = [...planFeatureSet("pro")];
  const flat = allScopeFeatures("pro");
  for (const key of ceiling) {
    const hits = flat.filter((f) => f.key === key);
    assert.equal(hits.length, 1, `expected exactly one entry for ${key}`);
    assert.ok(
      hits[0].state === "included" || hits[0].state === "included-needs-addon",
      `${key} should be an included state, got ${hits[0].state}`,
    );
  }
});

check("Sales Analytics slices are 'included-needs-addon' (inert until SA module)", () => {
  assert.equal(stateOf("starter", FEATURES.SA_SECTION_REVENUE), "included-needs-addon");
  assert.equal(stateOf("starter", FEATURES.SA_EXPORT_PDF), "included-needs-addon");
});

check("Group Buy sub-capabilities are 'included-needs-addon' (inert until GB module)", () => {
  assert.equal(stateOf("starter", FEATURES.GB_CREATE), "included-needs-addon");
  assert.equal(stateOf("starter", FEATURES.GB_SUPPLIER_REPORTS), "included-needs-addon");
});

check("operator-grantable features outside a plan ceiling show as 'addon'", () => {
  for (const key of OPERATOR_GRANTABLE) {
    // On Starter none of the grantables are in the ceiling, so all are add-ons.
    assert.equal(stateOf("starter", key), "addon", `${key} should be addon on starter`);
    // On any plan: addon iff outside that plan's ceiling, else an included state.
    const inEnterprise = planFeatureSet("enterprise").has(key);
    const expected: FeatureState = inEnterprise ? "included" : "addon";
    assert.equal(stateOf("enterprise", key), expected, `${key} on enterprise`);
  }
});

check("a dual feature is 'included' where the plan grants it, 'addon' where it doesn't", () => {
  // Staff Accounts: since the Business narrowing (pepstack-davao reference set)
  // it lives only in the Automated ceiling — operator-grantable (addon) on
  // Starter AND Business, included on Automated.
  assert.equal(stateOf("starter", FEATURES.STORE_STAFF_ACCOUNTS), "addon");
  assert.equal(stateOf("pro", FEATURES.STORE_STAFF_ACCOUNTS), "addon");
  assert.equal(stateOf("enterprise", FEATURES.STORE_STAFF_ACCOUNTS), "included");
  // Delivery Note (trial system): in Business/Automated ceilings, addon on Starter.
  assert.equal(stateOf("starter", FEATURES.STORE_TRACK_NOTE), "addon");
  assert.equal(stateOf("pro", FEATURES.STORE_TRACK_NOTE), "included");
  assert.equal(stateOf("enterprise", FEATURES.STORE_TRACK_NOTE), "included");
});

check("GB Enterprise extras are operator add-ons on EVERY plan (never plan-bundled)", () => {
  // Scheduled runs, parallel runs and auto-report-on-close are sold per tenant
  // by the operator — on any plan, never auto-on with a package.
  const extras = [
    FEATURES.GB_SCHEDULED,
    FEATURES.GB_MULTIPLE_ACTIVE,
    FEATURES.GB_REPORT_AUTO_ON_CLOSE,
  ];
  for (const key of extras) {
    assert.ok(OPERATOR_GRANTABLE.has(key), `${key} should be operator-grantable`);
    for (const plan of ["starter", "pro", "enterprise"]) {
      assert.ok(!planFeatureSet(plan).has(key), `${key} must not sit in the ${plan} ceiling`);
      assert.equal(stateOf(plan, key), "addon", `${key} on ${plan}`);
    }
  }
});

check("no groupbuy.* feature is ever plan-locked (grantable on every plan)", () => {
  // Mirrors the admin Features page's lock rule (tenants/[slug]/features/page.tsx):
  // lockedByPlan = outside the ceiling AND not operator-grantable.
  const gbKeys = (Object.values(FEATURES) as FeatureKey[]).filter((k) =>
    k.startsWith("groupbuy."),
  );
  for (const plan of ["starter", "pro", "enterprise"]) {
    const ceiling = planFeatureSet(plan);
    for (const key of gbKeys) {
      const lockedByPlan = !ceiling.has(key) && !OPERATOR_GRANTABLE.has(key);
      assert.ok(!lockedByPlan, `${key} shows "Locked · upgrade plan" on ${plan}`);
    }
  }
});

check("addonCount equals the operator-grantable set size", () => {
  const scope = getPlanScope("starter");
  assert.equal(scope.addonCount, OPERATOR_GRANTABLE.size);
});

check("includedCount equals the plan ceiling size", () => {
  const scope = getPlanScope("enterprise");
  assert.equal(scope.includedCount, planFeatureSet("enterprise").size);
});

check("included scope grows enterprise ⊇ pro ⊇ starter", () => {
  const s = getPlanScope("starter").includedCount;
  const p = getPlanScope("pro").includedCount;
  const e = getPlanScope("enterprise").includedCount;
  assert.ok(p > s, `pro(${p}) should exceed starter(${s})`);
  assert.ok(e > p, `enterprise(${e}) should exceed pro(${p})`);
});

check("every shown feature carries its catalog label + description", () => {
  for (const f of allScopeFeatures("enterprise")) {
    assert.equal(f.label, FEATURE_META[f.key].label);
    assert.equal(f.description, FEATURE_META[f.key].description);
  }
});

check("unknown plan key falls back to the starter scope", () => {
  assert.equal(getPlanScope("does-not-exist").includedCount, getPlanScope("starter").includedCount);
});

// ──────────────────────────────── bulletsFromScope ──────────────────────────
console.log("bulletsFromScope");

check("pro bullets lead with 'Everything in Starter'", () => {
  assert.equal(bulletsFromScope("pro")[0], "Everything in Starter");
});

check("enterprise bullets lead with 'Everything in Business'", () => {
  assert.equal(bulletsFromScope("enterprise")[0], "Everything in Business");
});

check("starter bullets do not reference a lower tier", () => {
  const bullets = bulletsFromScope("starter");
  assert.ok(bullets.length > 0);
  assert.ok(!bullets[0].startsWith("Everything in"), `got: ${bullets[0]}`);
});

check("bullets never advertise add-on-gated features (honest by default)", () => {
  // Starter's GB/SA basics are 'included-needs-addon' (off until the operator
  // grants the module), so they must not appear as a default-package bullet.
  const starter = bulletsFromScope("starter").join(" | ");
  assert.ok(!/Create group buys/.test(starter), `GB leaked into starter bullets: ${starter}`);
  assert.ok(!/Revenue analytics/.test(starter), `SA leaked into starter bullets: ${starter}`);
  // No add-on label (e.g. Card Studio) should appear either.
  assert.ok(!/Card Studio/.test(starter), `add-on leaked into starter bullets: ${starter}`);
});

check("bullets respect the plan-config limits (<=12 bullets, <=160 chars, non-empty)", () => {
  for (const planKey of ["starter", "pro", "enterprise"]) {
    const bullets = bulletsFromScope(planKey);
    assert.ok(bullets.length >= 1 && bullets.length <= MAX_BULLETS, `${planKey}: ${bullets.length} bullets`);
    for (const b of bullets) {
      assert.ok(b.trim().length > 0, `${planKey}: empty bullet`);
      assert.ok(b.length <= MAX_BULLET_LEN, `${planKey}: bullet too long (${b.length}): ${b}`);
    }
  }
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
