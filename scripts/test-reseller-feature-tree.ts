/**
 * The Reseller feature tree: one parent, two independent children.
 *
 *   Reseller  (storefront.reseller)              — the parent switch
 *   ├── Wholesale pricing (…reseller.wholesale)  — MOQ pricing on the regular store
 *   └── Wholesale reseller page (…reseller.page) — the gated #merchant portal
 *
 * The two children are SIBLINGS, not a chain: a tenant can run wholesale pricing
 * with no reseller page, and revoking the parent turns both off at once.
 *
 * This also pins the migration-safety properties. The parent keeps its existing
 * key, so no live tenant loses its portal; the page child sits in every plan
 * ceiling, so tenants that have the parent today keep the page with no operator
 * action; and the pricing child sits in NO ceiling, so nobody's prices move
 * until an operator grants it deliberately.
 *
 *   npx tsx scripts/test-reseller-feature-tree.ts
 */

import assert from "node:assert";

import {
  FEATURES,
  FEATURE_GROUPS,
  FEATURE_META,
  OPERATOR_GRANTABLE,
  PLAN_FEATURES,
  type FeatureKey,
} from "../src/lib/features/catalog";
import { getPlanScope } from "../src/lib/features/plan-scope";
import { resellerCapsFrom, RESELLER_CAPS_OFF } from "../src/lib/storefront/reseller-caps";

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

const PARENT = FEATURES.STORE_RESELLER_PORTAL;
const WHOLESALE = FEATURES.STORE_WHOLESALE_PRICING;
const PAGE = FEATURES.STORE_RESELLER_PAGE;
const PLANS = Object.keys(PLAN_FEATURES);

// ── The tree ─────────────────────────────────────────────────────────────────

check("the parent keeps its existing key, so no live tenant is migrated", () => {
  assert.strictEqual(PARENT, "storefront.reseller");
});

check("both children are namespaced under the parent key", () => {
  assert.strictEqual(WHOLESALE, "storefront.reseller.wholesale");
  assert.strictEqual(PAGE, "storefront.reseller.page");
  for (const child of [WHOLESALE, PAGE]) {
    assert.ok(child.startsWith(`${PARENT}.`), `${child} must sit under ${PARENT}`);
  }
});

check("all three render together under their own Reseller group", () => {
  assert.ok(FEATURE_GROUPS.includes("Reseller"), "Reseller must be a feature group");
  for (const key of [PARENT, WHOLESALE, PAGE]) {
    assert.strictEqual(FEATURE_META[key].group, "Reseller", `${key} is in the wrong group`);
  }
});

// ── Migration safety ─────────────────────────────────────────────────────────

check("the reseller PAGE is in every plan ceiling — existing portals survive", () => {
  for (const plan of PLANS) {
    assert.ok(PLAN_FEATURES[plan].includes(PAGE), `${plan} is missing ${PAGE}`);
  }
});

check("wholesale PRICING is in NO plan ceiling — no store's prices move on their own", () => {
  for (const plan of PLANS) {
    assert.ok(!PLAN_FEATURES[plan].includes(WHOLESALE), `${plan} must not default ${WHOLESALE}`);
  }
});

check("wholesale PRICING is operator-grantable, so any plan can be granted it", () => {
  assert.ok(OPERATOR_GRANTABLE.has(WHOLESALE));
});

// ── The children are gated by the parent, on every plan ──────────────────────

check("every plan shows the reseller PAGE as depending on the parent switch", () => {
  for (const plan of PLANS) {
    const rows = getPlanScope(plan).groups.flatMap((g) => g.features);
    const row = rows.find((r) => r.key === (PAGE as FeatureKey));
    assert.ok(row, `${plan}: ${PAGE} missing from the plan scope`);
    assert.strictEqual(row.state, "included-needs-addon");
    assert.strictEqual(row.dependsOn, PARENT, `${plan}: ${PAGE} must depend on ${PARENT}`);
  }
});

check("wholesale PRICING is offered as an operator add-on on every plan", () => {
  // It renders as a plain add-on rather than "needs the parent", which is how
  // every operator-grantable child outside the ceilings already renders (see
  // groupbuy.two_ways_home / .scheduled / .reports.auto_on_close). The parent
  // gate is still enforced at runtime by resellerCapsFrom, below.
  for (const plan of PLANS) {
    const rows = getPlanScope(plan).groups.flatMap((g) => g.features);
    const row = rows.find((r) => r.key === (WHOLESALE as FeatureKey));
    assert.ok(row, `${plan}: ${WHOLESALE} missing from the plan scope`);
    assert.strictEqual(row.state, "addon", `${plan}: ${WHOLESALE} must be grantable, not planned`);
  }
});

// ── The truth table ──────────────────────────────────────────────────────────

check("parent OFF → every capability is off, whatever the children say", () => {
  assert.deepStrictEqual(resellerCapsFrom(new Set([WHOLESALE, PAGE])), RESELLER_CAPS_OFF);
});

check("parent ON + pricing ON + page OFF → wholesale on the regular storefront", () => {
  assert.deepStrictEqual(resellerCapsFrom(new Set([PARENT, WHOLESALE])), {
    enabled: true,
    wholesalePricing: true,
    resellerPage: false,
  });
});

check("parent ON + pricing OFF + page ON → today's stores, unchanged", () => {
  assert.deepStrictEqual(resellerCapsFrom(new Set([PARENT, PAGE])), {
    enabled: true,
    wholesalePricing: false,
    resellerPage: true,
  });
});

check("parent ON + both children ON → both surfaces", () => {
  assert.deepStrictEqual(resellerCapsFrom(new Set([PARENT, WHOLESALE, PAGE])), {
    enabled: true,
    wholesalePricing: true,
    resellerPage: true,
  });
});

check("parent ON alone exposes nothing", () => {
  assert.deepStrictEqual(resellerCapsFrom(new Set([PARENT])), {
    enabled: true,
    wholesalePricing: false,
    resellerPage: false,
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
