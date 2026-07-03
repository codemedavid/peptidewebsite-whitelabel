/**
 * Self-contained test for the store-admin login-mode core — the pure module that
 * decides whether the storefront `#admin` login shows the unified username +
 * password form or the simpler password-only form:
 *
 *   - src/lib/storefront/admin-login-mode.ts
 *       resolveAdminLoginMode(featureOn, staffCount)
 *         → "unified"       when Staff Accounts are enabled AND ≥1 staff exists
 *         → "password-only" otherwise (the owner password alone gates the store)
 *
 * This is the deadlock fix: a brand-new tenant with no staff configured is asked
 * for a password only — never a username that doesn't exist yet. The full
 * username field returns once the owner enables Staff Accounts and creates at
 * least one staff account.
 *
 * Runs the REAL module (no DB, no Next runtime, no browser):
 *
 *   npm run test:admin-login-mode
 */

import assert from "node:assert";

import { resolveAdminLoginMode } from "../src/lib/storefront/admin-login-mode";

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
  }
}

// ──────────────────────────── resolveAdminLoginMode ─────────────────────────
console.log("resolveAdminLoginMode");

check("feature OFF → password-only, regardless of staff count", () => {
  assert.equal(resolveAdminLoginMode(false, 0), "password-only");
  assert.equal(resolveAdminLoginMode(false, 3), "password-only");
});

check("feature ON but zero staff → password-only (no deadlock on a fresh store)", () => {
  assert.equal(resolveAdminLoginMode(true, 0), "password-only");
});

check("feature ON and ≥1 staff → unified (username + password)", () => {
  assert.equal(resolveAdminLoginMode(true, 1), "unified");
  assert.equal(resolveAdminLoginMode(true, 25), "unified");
});

check("negative / NaN staff count → password-only (never crashes)", () => {
  assert.equal(resolveAdminLoginMode(true, -1), "password-only");
  assert.equal(resolveAdminLoginMode(true, Number.NaN), "password-only");
});

check("fractional count ≥1 still counts as configured", () => {
  // Defensive: a DB count is an integer, but the core must not do a strict === 1.
  assert.equal(resolveAdminLoginMode(true, 1.5), "unified");
});

// ──────────────────────────── summary ────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
