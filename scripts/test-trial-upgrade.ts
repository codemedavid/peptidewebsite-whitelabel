/**
 * Self-contained test for the upgrade flow's pure core (no DB, no Next):
 *
 *   1. plan-config gains the operator-editable trial price
 *      (trialPriceCents, default ₱699 = 69900 centavos) with the same
 *      clamp/fallback discipline as plan prices.
 *   2. upgrade-quote: order summary math — Business monthly − trial credit =
 *      due today, never negative, credit only for trial-governed tenants.
 *   3. upgrade-request: the operator-approval state machine — a request is
 *      pending until the operator approves (plan flips) or rejects; no other
 *      transition exists.
 *
 *   npm run test:trial-upgrade
 */

import assert from "node:assert";

import {
  normalizePlanConfig,
  planConfigPriceCents,
  DEFAULT_TRIAL_PRICE_CENTS,
} from "../src/lib/platform/plan-config";
import { upgradeQuote } from "../src/lib/trial/upgrade-quote";
import {
  UPGRADE_REQUEST_STATUSES,
  normalizeUpgradeStatus,
  canTransitionUpgrade,
} from "../src/lib/trial/upgrade-request";

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

console.log("\nTrial upgrade — pure core\n");

// ───────────────────────── plan-config: trial price ─────────────────────────
check("default trial price is ₱699 (69900 centavos)", () => {
  assert.strictEqual(DEFAULT_TRIAL_PRICE_CENTS, 69_900);
  assert.strictEqual(normalizePlanConfig({}).trialPriceCents, 69_900);
});

check("operator-set trial price round-trips through normalize", () => {
  assert.strictEqual(normalizePlanConfig({ trialPriceCents: 49_900 }).trialPriceCents, 49_900);
});

check("garbage / non-positive trial prices fall back to the default", () => {
  assert.strictEqual(normalizePlanConfig({ trialPriceCents: -5 }).trialPriceCents, 69_900);
  assert.strictEqual(normalizePlanConfig({ trialPriceCents: "nope" }).trialPriceCents, 69_900);
  assert.strictEqual(normalizePlanConfig({ trialPriceCents: NaN }).trialPriceCents, 69_900);
});

// ─────────────────────────────── upgrade quote ──────────────────────────────
check("trial-governed tenant: due today = Business monthly − trial credit", () => {
  const config = normalizePlanConfig({});
  const business = planConfigPriceCents(config, "pro");
  const q = upgradeQuote(config, true);
  assert.strictEqual(q.businessCents, business);
  assert.strictEqual(q.creditCents, 69_900);
  assert.strictEqual(q.dueTodayCents, Math.max(0, business - 69_900));
});

check("non-trial tenant gets no credit — due today is the full monthly price", () => {
  const config = normalizePlanConfig({});
  const q = upgradeQuote(config, false);
  assert.strictEqual(q.creditCents, 0);
  assert.strictEqual(q.dueTodayCents, q.businessCents);
});

check("credit larger than the Business price clamps due-today to zero", () => {
  const config = normalizePlanConfig({
    plans: [{ key: "pro", priceCents: 10_000 }],
    trialPriceCents: 69_900,
  });
  const q = upgradeQuote(config, true);
  assert.strictEqual(q.businessCents, 10_000);
  assert.strictEqual(q.dueTodayCents, 0);
});

// ─────────────────────── upgrade-request state machine ──────────────────────
check("statuses are exactly pending | approved | rejected", () => {
  assert.deepStrictEqual([...UPGRADE_REQUEST_STATUSES].sort(), [
    "approved",
    "pending",
    "rejected",
  ]);
});

check("unknown stored statuses normalize to pending (operator must decide)", () => {
  assert.strictEqual(normalizeUpgradeStatus("pending"), "pending");
  assert.strictEqual(normalizeUpgradeStatus("approved"), "approved");
  assert.strictEqual(normalizeUpgradeStatus("weird"), "pending");
  assert.strictEqual(normalizeUpgradeStatus(undefined), "pending");
});

check("only pending requests can be decided, and decisions are final", () => {
  assert.strictEqual(canTransitionUpgrade("pending", "approved"), true);
  assert.strictEqual(canTransitionUpgrade("pending", "rejected"), true);
  assert.strictEqual(canTransitionUpgrade("approved", "rejected"), false);
  assert.strictEqual(canTransitionUpgrade("rejected", "approved"), false);
  assert.strictEqual(canTransitionUpgrade("approved", "approved"), false);
  assert.strictEqual(canTransitionUpgrade("pending", "pending"), false);
});

// ──────────────────────────────────── summary ───────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
