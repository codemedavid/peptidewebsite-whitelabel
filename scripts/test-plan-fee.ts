/**
 * Self-contained test for the pure per-tenant plan-fee override rule (no DB, no
 * Next runtime). Guards the "Subscription window → Monthly price due" feature:
 * an operator can set a per-tenant recurring price that overrides the plan-config
 * list price wherever the tenant's Plan fee / MRR contribution is shown.
 *
 *   - src/lib/subscription/plan-fee.ts
 *       effectivePlanFeeCents(priceCents, fallbackCents) — the per-tenant price
 *       when the operator has set one (including a deliberate 0 for a comped
 *       tenant), otherwise the plan-config fallback.
 *
 * Consumed by:
 *   - getPlatformOverview() MRR sum (src/lib/admin/data.ts)
 *   - the tenant-detail "Plan fee" tile (TenantDetailView.tsx)
 *
 *   npm run test:plan-fee
 */

import assert from "node:assert";

import {
  effectivePlanFeeCents,
  resolvePriceCentsInput,
  MAX_SUBSCRIPTION_PRICE_CENTS,
} from "../src/lib/subscription/plan-fee";

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

const FALLBACK = 149900; // plan-config Business price, centavos

console.log("\nplan-fee override rule\n");

check("uses the plan fallback when no per-tenant price is set (undefined)", () => {
  assert.strictEqual(effectivePlanFeeCents(undefined, FALLBACK), FALLBACK);
});

check("uses the plan fallback when the per-tenant price is null", () => {
  assert.strictEqual(effectivePlanFeeCents(null, FALLBACK), FALLBACK);
});

check("overrides with the per-tenant price when set", () => {
  assert.strictEqual(effectivePlanFeeCents(99900, FALLBACK), 99900);
});

check("a deliberate 0 overrides (comped tenant), it does NOT fall back", () => {
  // The whole point: 0 is a real value an operator can set, so the rule must
  // not treat it as "unset" via a truthiness check.
  assert.strictEqual(effectivePlanFeeCents(0, FALLBACK), 0);
});

check("ignores a negative price and falls back (invalid input)", () => {
  assert.strictEqual(effectivePlanFeeCents(-500, FALLBACK), FALLBACK);
});

check("ignores a non-finite price and falls back", () => {
  assert.strictEqual(effectivePlanFeeCents(Number.NaN, FALLBACK), FALLBACK);
  assert.strictEqual(effectivePlanFeeCents(Infinity, FALLBACK), FALLBACK);
});

console.log("\nprice input validation + clamp\n");

check("null / undefined input resolve to a null value (clears the field)", () => {
  assert.deepStrictEqual(resolvePriceCentsInput(null), { value: null });
  assert.deepStrictEqual(resolvePriceCentsInput(undefined), { value: null });
});

check("a valid price passes through", () => {
  assert.deepStrictEqual(resolvePriceCentsInput(99900), { value: 99900 });
});

check("0 is a valid comped value", () => {
  assert.deepStrictEqual(resolvePriceCentsInput(0), { value: 0 });
});

check("a fractional cent is rounded", () => {
  assert.deepStrictEqual(resolvePriceCentsInput(125099.6), { value: 125100 });
});

check("a value over the guardrail is clamped, not rejected", () => {
  assert.deepStrictEqual(resolvePriceCentsInput(999_999_999_999), {
    value: MAX_SUBSCRIPTION_PRICE_CENTS,
  });
});

check("a negative price is rejected with an error", () => {
  const r = resolvePriceCentsInput(-1);
  assert.ok("error" in r, "expected an error result");
});

check("a non-finite price is rejected with an error", () => {
  assert.ok("error" in resolvePriceCentsInput(Number.NaN), "NaN should error");
  assert.ok("error" in resolvePriceCentsInput(Infinity), "Infinity should error");
});

// ──────────────────────────── summary ───────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
