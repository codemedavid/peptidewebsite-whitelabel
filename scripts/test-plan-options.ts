/**
 * Self-contained test for the tenant plan/status editor's pure core. Runs the
 * REAL module (no DB, no Next runtime, no network):
 *   - lib/admin/plan-options.ts — option lists + validators the super-admin
 *     "Plan & status" editor and its server action both rely on.
 *
 * Covers: the canonical plan options (Starter / Business / Automated) in tier
 * order, the three tenant statuses (Active / Trial / Suspended), plan-key
 * validation (canonical keys only — aliases are rejected so the action can't be
 * tricked into writing a non-select value), status validation, and alias→
 * canonical normalization for rendering a stored value into the <select>.
 *
 *   npm run test:plan-status
 */

import assert from "node:assert";

import {
  PLAN_OPTIONS,
  STATUS_OPTIONS,
  TENANT_STATUSES,
  isValidPlanKey,
  isValidStatus,
  canonicalPlanKey,
  statusLabel,
} from "../src/lib/admin/plan-options";

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

console.log("\nTenant plan/status editor — pure-core gate\n");

// ───────────────────────────── plan options ─────────────────────────────────
console.log("plan options");

check("exposes exactly the three canonical plans in tier order", () => {
  assert.deepEqual(
    PLAN_OPTIONS.map((o) => o.key),
    ["starter", "pro", "enterprise"],
  );
});

check("labels the plans Starter / Business / Automated", () => {
  assert.deepEqual(
    PLAN_OPTIONS.map((o) => o.label),
    ["Starter", "Business", "Automated"],
  );
});

check('"Business" is the display label for the pro plan key', () => {
  const pro = PLAN_OPTIONS.find((o) => o.key === "pro");
  assert.ok(pro, "pro option present");
  assert.equal(pro!.label, "Business");
});

// ───────────────────────────── status options ───────────────────────────────
console.log("\nstatus options");

check("exposes Active / Trial / Suspended as the three statuses", () => {
  assert.deepEqual([...TENANT_STATUSES], ["active", "trial", "suspended"]);
  assert.deepEqual(
    STATUS_OPTIONS.map((o) => o.value),
    ["active", "trial", "suspended"],
  );
});

check("Trial is a selectable status with a human label", () => {
  const trial = STATUS_OPTIONS.find((o) => o.value === "trial");
  assert.ok(trial, "trial option present");
  assert.equal(trial!.label, "Trial");
});

check("statusLabel humanizes known + system statuses, falls back to raw value", () => {
  assert.equal(statusLabel("active"), "Active");
  assert.equal(statusLabel("past_due"), "Past due");
  assert.equal(statusLabel("pending_setup"), "Pending setup");
  assert.equal(statusLabel("weird_thing"), "weird_thing");
});

// ───────────────────────────── plan-key validation ──────────────────────────
console.log("\nisValidPlanKey (server-action guard)");

check("accepts the three canonical plan keys", () => {
  for (const k of ["starter", "pro", "enterprise"]) assert.equal(isValidPlanKey(k), true, k);
});

check("rejects aliases, empty, and unknown keys (the select only emits canonical keys)", () => {
  for (const k of ["business", "growth", "basic", "automated", "", "bogus", "PRO"]) {
    assert.equal(isValidPlanKey(k), false, k);
  }
});

// ───────────────────────────── status validation ────────────────────────────
console.log("\nisValidStatus (server-action guard — full known-status domain)");

check("accepts every status the app legitimately stores (incl. system statuses)", () => {
  // Broader than the pickable dropdown so a plan-only edit round-trips a
  // system status (e.g. pending_setup) instead of being rejected.
  for (const s of ["active", "trial", "suspended", "past_due", "pending", "canceled", "pending_setup"]) {
    assert.equal(isValidStatus(s), true, s);
  }
});

check("rejects unknown / empty / mis-cased statuses", () => {
  for (const s of ["deleted", "", "Active", "bogus"]) assert.equal(isValidStatus(s), false, s);
});

// ─────────────────────── alias → canonical normalization ─────────────────────
console.log("\ncanonicalPlanKey (normalize stored value for the select)");

check("maps legacy aliases to their canonical key", () => {
  assert.equal(canonicalPlanKey("business"), "pro");
  assert.equal(canonicalPlanKey("growth"), "enterprise");
  assert.equal(canonicalPlanKey("basic"), "starter");
});

check("passes canonical keys through unchanged", () => {
  for (const k of ["starter", "pro", "enterprise"]) assert.equal(canonicalPlanKey(k), k);
});

check("falls back to starter for an unknown key (never throws)", () => {
  assert.equal(canonicalPlanKey("bogus"), "starter");
  assert.equal(canonicalPlanKey(""), "starter");
});

// ────────────────────────────────── summary ─────────────────────────────────
console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed.\n`);
process.exit(failed === 0 ? 0 : 1);
