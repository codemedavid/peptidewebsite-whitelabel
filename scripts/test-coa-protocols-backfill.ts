/**
 * Self-contained test for the COA/Protocols backfill DECISION CORE
 * (scripts/lib/coa-protocols-backfill-plan.ts). Pure, no DB.
 *
 * The backfill grants storefront.coa + storefront.protocols to every EXISTING
 * tenant so the new operator-grantable/default-OFF entitlement doesn't strip the
 * managers from live stores — EXCEPT excluded tenants (dragon-peptides), which
 * are written OFF explicitly, and tenants that already have an operator decision
 * recorded, which are never clobbered.
 *
 *   npm run test:coa-protocols-backfill
 */

import assert from "node:assert";

import {
  planCoaProtocolsBackfill,
  type BackfillTenant,
  type BackfillFeature,
  type BackfillOverride,
} from "./lib/coa-protocols-backfill-plan";

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

// Fixture: 3 tenants, 2 features.
const COA: BackfillFeature = { id: "f-coa", key: "storefront.coa" };
const PROTO: BackfillFeature = { id: "f-proto", key: "storefront.protocols" };
const FEATURES: BackfillFeature[] = [COA, PROTO];

const DRAGON: BackfillTenant = { id: "t-dragon", slug: "dragon-peptides" };
const ACME: BackfillTenant = { id: "t-acme", slug: "acme" };
const BETA: BackfillTenant = { id: "t-beta", slug: "beta" };
const TENANTS: BackfillTenant[] = [DRAGON, ACME, BETA];

const has = (plan: ReturnType<typeof planCoaProtocolsBackfill>, tId: string, fId: string) =>
  plan.planned.find((p) => p.tenantId === tId && p.featureId === fId);

console.log("\nCOA/Protocols backfill — decision core\n");

check("grants both features to a normal tenant (enabled=true)", () => {
  const plan = planCoaProtocolsBackfill([ACME], FEATURES, [], new Set());
  assert.equal(plan.grants.length, 2, "two grants");
  assert.equal(plan.revokes.length, 0, "no revokes");
  assert.equal(has(plan, ACME.id, COA.id)?.enabled, true);
  assert.equal(has(plan, ACME.id, PROTO.id)?.enabled, true);
});

check("excluded tenant is planned OFF explicitly, not granted and not merely absent", () => {
  // dragon-peptides is the tenant whose managers were showing without a grant —
  // granting it here would re-create the exact bug the feature fixes. It must be
  // written enabled=false so the decision is RECORDED, survives a re-run.
  const plan = planCoaProtocolsBackfill([DRAGON], FEATURES, [], new Set(["dragon-peptides"]));
  assert.equal(plan.grants.length, 0, "no grants for excluded tenant");
  assert.equal(plan.revokes.length, 2, "both features written off");
  assert.equal(has(plan, DRAGON.id, COA.id)?.enabled, false);
  assert.equal(has(plan, DRAGON.id, PROTO.id)?.enabled, false);
});

check("a tenant with an existing override is SKIPPED, never re-planned (never clobber)", () => {
  // acme already has an explicit coa override (enabled=false) — an operator turned
  // it off. The backfill must leave it, not grant over it.
  const existing: BackfillOverride[] = [{ tenantId: ACME.id, featureId: COA.id, enabled: false }];
  const plan = planCoaProtocolsBackfill([ACME], FEATURES, existing, new Set());
  assert.equal(has(plan, ACME.id, COA.id), undefined, "coa not re-planned");
  assert.equal(has(plan, ACME.id, PROTO.id)?.enabled, true, "proto still granted");
  assert.equal(plan.skipped.length, 1, "one skip line");
  assert.match(plan.skipped[0], /storefront\.coa/);
});

check("never-clobber applies to excluded tenants too (existing dragon override is left alone)", () => {
  // If dragon-peptides somehow already has an override, exclusion must NOT flip it
  // — skip wins over revoke, so we never overwrite a recorded decision.
  const existing: BackfillOverride[] = [{ tenantId: DRAGON.id, featureId: COA.id, enabled: true }];
  const plan = planCoaProtocolsBackfill([DRAGON], FEATURES, existing, new Set(["dragon-peptides"]));
  assert.equal(has(plan, DRAGON.id, COA.id), undefined, "existing coa override untouched");
  assert.equal(has(plan, DRAGON.id, PROTO.id)?.enabled, false, "proto still written off");
  assert.equal(plan.skipped.length, 1);
});

check("flags an excluded slug that matches no tenant (typo guard)", () => {
  const plan = planCoaProtocolsBackfill(TENANTS, FEATURES, [], new Set(["dragon-peptides", "ghost"]));
  assert.deepEqual(plan.unknownExclusions, ["ghost"]);
});

check("no unknown exclusions when every excluded slug exists", () => {
  const plan = planCoaProtocolsBackfill(TENANTS, FEATURES, [], new Set(["dragon-peptides"]));
  assert.deepEqual(plan.unknownExclusions, []);
});

check("full fixture: grants normals, excludes dragon, respects existing overrides", () => {
  const existing: BackfillOverride[] = [
    { tenantId: ACME.id, featureId: COA.id, enabled: true }, // already on
    { tenantId: BETA.id, featureId: PROTO.id, enabled: false }, // already off
  ];
  const plan = planCoaProtocolsBackfill(TENANTS, FEATURES, existing, new Set(["dragon-peptides"]));
  // 3 tenants × 2 features = 6 cells. 2 skipped, so 4 planned.
  assert.equal(plan.planned.length, 4, "four planned");
  assert.equal(plan.skipped.length, 2, "two skipped");
  // dragon: both off. acme: coa skipped, proto granted. beta: coa granted, proto skipped.
  assert.equal(plan.grants.length, 2, "acme-proto + beta-coa");
  assert.equal(plan.revokes.length, 2, "dragon-coa + dragon-proto");
  assert.equal(has(plan, BETA.id, COA.id)?.enabled, true);
  assert.equal(has(plan, ACME.id, PROTO.id)?.enabled, true);
});

check("planned = grants ∪ revokes, disjoint and complete", () => {
  const plan = planCoaProtocolsBackfill(TENANTS, FEATURES, [], new Set(["dragon-peptides"]));
  assert.equal(plan.grants.length + plan.revokes.length, plan.planned.length);
  for (const p of plan.planned) {
    const inGrants = plan.grants.includes(p);
    const inRevokes = plan.revokes.includes(p);
    assert.ok(inGrants !== inRevokes, "each planned item is in exactly one bucket");
  }
});

console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed.\n`);
process.exit(failed === 0 ? 0 : 1);
