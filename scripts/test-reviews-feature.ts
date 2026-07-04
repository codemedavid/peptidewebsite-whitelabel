/**
 * Self-contained test for the Reviews platform feature (admin → Features).
 * Runs the REAL catalog + visibility pure cores (no DB, no Next runtime):
 *   - FEATURES.STORE_REVIEWS is registered, sits in the "Catalog" group, and is
 *     OPERATOR-GRANTABLE / default-OFF — it is NOT in any plan ceiling, so no
 *     tenant sees Reviews until the operator grants it per tenant.
 *   - resolveShowReviews(entitled, ownerToggle) — the two-layer gate that the
 *     storefront render writes onto brand.showPageReviews: the platform
 *     entitlement AND the store owner's "Reviews page" toggle must both be on.
 *
 * Mirrors scripts/test-admin-order-alert.ts (pure-core, assert-based).
 *
 *   npm run test:reviews
 */

import assert from "node:assert";

import {
  FEATURES,
  FEATURE_META,
  OPERATOR_GRANTABLE,
  ALL_FEATURES,
  planFeatureSet,
} from "../src/lib/features/catalog";
import { resolveShowReviews } from "../src/storefront/visibility";

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

console.log("\nReviews feature — catalog registration + page gate\n");

// ───────────────────────────── catalog registration ─────────────────────────
console.log("catalog (admin → Features)");

check("STORE_REVIEWS is registered with the storefront.reviews key", () => {
  assert.equal(FEATURES.STORE_REVIEWS, "storefront.reviews");
  assert.ok(ALL_FEATURES.includes(FEATURES.STORE_REVIEWS), "in ALL_FEATURES");
});

check("has admin Features metadata in the Catalog group", () => {
  const meta = FEATURE_META[FEATURES.STORE_REVIEWS];
  assert.ok(meta, "FEATURE_META entry present");
  assert.equal(meta.group, "Catalog");
  assert.ok(meta.label && meta.label.length > 0, "has a label");
  assert.ok(meta.description && meta.description.length > 0, "has a description");
});

check("is operator-grantable (never shows 'Locked · upgrade plan')", () => {
  assert.ok(OPERATOR_GRANTABLE.has(FEATURES.STORE_REVIEWS));
});

check("is DEFAULT-OFF — not in any plan ceiling", () => {
  for (const plan of ["starter", "pro", "enterprise"]) {
    assert.ok(
      !planFeatureSet(plan).has(FEATURES.STORE_REVIEWS),
      `expected ${plan} ceiling NOT to include storefront.reviews`,
    );
  }
});

// ───────────────────── resolveShowReviews (the two-layer gate) ───────────────
console.log("\nresolveShowReviews(entitled, ownerToggle)");

check("hidden when the feature is not entitled — even if the owner toggle is on", () => {
  assert.equal(resolveShowReviews(false, true), false);
  assert.equal(resolveShowReviews(false, undefined), false);
  assert.equal(resolveShowReviews(false, false), false);
});

check("visible when entitled and the owner has NOT turned the page off (default-on)", () => {
  assert.equal(resolveShowReviews(true, undefined), true);
  assert.equal(resolveShowReviews(true, true), true);
});

check("hidden when entitled but the owner explicitly turned the Reviews page off", () => {
  assert.equal(resolveShowReviews(true, false), false);
});

// ────────────────────────────────── summary ─────────────────────────────────
console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed.\n`);
process.exit(failed === 0 ? 0 : 1);
