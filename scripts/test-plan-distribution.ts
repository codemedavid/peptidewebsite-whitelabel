/**
 * Self-contained test for the plan-distribution aggregator that backs the
 * /admin/plans "Plans & Billing" page. Runs the REAL pure helper (no DB, no
 * Next runtime) so the page never drifts from the catalog source of truth.
 *
 * The business model is a ONE-TIME website payment, not a subscription, so the
 * aggregator must NOT emit a recurring/annualized figure (no `arrCents`) and the
 * revenue total must equal the one-time sum of active-site plan prices — never
 * that sum multiplied out over twelve months.
 *
 *   - src/lib/admin/plan-distribution.ts
 *       aggregatePlanDistribution(tenants, planConfig)
 *         → { rows, revenueCents, activeCount }
 *
 *   npm run test:plan-distribution
 */

import assert from "node:assert";

import { defaultPlanConfig, planConfigPriceCents } from "../src/lib/platform/plan-config";
import { aggregatePlanDistribution } from "../src/lib/admin/plan-distribution";

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

const config = defaultPlanConfig();
const priceOf = (key: string) => planConfigPriceCents(config, key);

// A mix of statuses across all three plans. Only `active` tenants contribute
// revenue; every tenant (any status) contributes to its plan's `count`.
const tenants = [
  { planKey: "starter", status: "active" },
  { planKey: "starter", status: "active" },
  { planKey: "starter", status: "trial" }, // counted, no revenue
  { planKey: "pro", status: "active" },
  { planKey: "pro", status: "suspended" }, // counted, no revenue
  { planKey: "enterprise", status: "active" },
];

console.log("\nPlan distribution aggregator — pure core\n");

console.log("aggregatePlanDistribution");

check("emits exactly the three canonical plan rows, in order", () => {
  const rows = aggregatePlanDistribution(tenants, config).rows;
  assert.deepEqual(rows.map((r) => r.key), ["starter", "pro", "enterprise"]);
});

check("per-plan count includes every tenant regardless of status", () => {
  const rows = aggregatePlanDistribution(tenants, config).rows;
  const count = (k: string) => rows.find((r) => r.key === k)?.count;
  assert.equal(count("starter"), 3);
  assert.equal(count("pro"), 2);
  assert.equal(count("enterprise"), 1);
});

check("per-plan revenueCents counts only ACTIVE sites at the plan price", () => {
  const rows = aggregatePlanDistribution(tenants, config).rows;
  const rev = (k: string) => rows.find((r) => r.key === k)?.revenueCents;
  assert.equal(rev("starter"), 2 * priceOf("starter")); // 2 active, 1 trial excluded
  assert.equal(rev("pro"), 1 * priceOf("pro")); // 1 active, 1 suspended excluded
  assert.equal(rev("enterprise"), 1 * priceOf("enterprise"));
});

check("total revenueCents is the one-time sum of active plan prices (NOT ×12)", () => {
  const result = aggregatePlanDistribution(tenants, config);
  const expected = 2 * priceOf("starter") + 1 * priceOf("pro") + 1 * priceOf("enterprise");
  assert.equal(result.revenueCents, expected);
});

check("activeCount equals the number of active tenants", () => {
  assert.equal(aggregatePlanDistribution(tenants, config).activeCount, 4);
});

check("does NOT expose a recurring/annualized figure (no arrCents/mrrCents)", () => {
  const result = aggregatePlanDistribution(tenants, config) as Record<string, unknown>;
  assert.ok(!("arrCents" in result), "arrCents must be gone — there is no annual recurring revenue");
  assert.ok(!("mrrCents" in result), "mrrCents must be gone — there is no monthly recurring revenue");
});

check("each row carries its catalog priceCents and label", () => {
  const rows = aggregatePlanDistribution(tenants, config).rows;
  for (const r of rows) {
    assert.equal(r.priceCents, priceOf(r.key), `${r.key} priceCents`);
    assert.ok(r.label && r.label.length > 0, `${r.key} label`);
  }
});

check("empty tenant list yields zero revenue, zero active, three empty rows", () => {
  const result = aggregatePlanDistribution([], config);
  assert.equal(result.revenueCents, 0);
  assert.equal(result.activeCount, 0);
  assert.equal(result.rows.length, 3);
  assert.ok(result.rows.every((r) => r.count === 0 && r.revenueCents === 0));
});

check("unknown/legacy plan keys fold into a canonical plan (never vanish)", () => {
  // planMeta() maps legacy aliases onto canonical keys; an unknown key falls
  // back to starter. Either way it must land in one of the three rows.
  const odd = aggregatePlanDistribution([{ planKey: "growth-legacy", status: "active" }], config);
  const totalCount = odd.rows.reduce((s, r) => s + r.count, 0);
  assert.equal(totalCount, 1, "the lone tenant must be counted in some canonical row");
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
