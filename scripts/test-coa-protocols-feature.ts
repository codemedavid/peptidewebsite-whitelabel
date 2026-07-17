/**
 * Self-contained test for the COA (Lab Results) + Protocols platform features
 * (admin → Features). Runs the REAL catalog + visibility pure cores (no DB, no
 * Next runtime).
 *
 * Before this feature both store-admin managers were gated ONLY by the store
 * owner's branding toggle (brand.showPageCOA / showPageProtocols, default-on),
 * so every tenant on every plan — including Starter — got the COA and Protocol
 * managers with nothing the operator could do about it. There was no
 * storefront.coa / storefront.protocols entitlement at all; the operator console
 * showed no switch for them.
 *
 * These now mirror Reviews exactly:
 *   - FEATURES.STORE_COA / STORE_PROTOCOLS are registered, sit in the "Catalog"
 *     group, and are OPERATOR-GRANTABLE / default-OFF — NOT in any plan ceiling.
 *   - resolveEntitledPage(entitled, ownerToggle) — the two-layer gate the
 *     storefront render writes onto brand.showPageCOA / showPageProtocols: the
 *     platform entitlement AND the owner's page toggle must both be on.
 *   - MODULE_FEATURE maps the "lab"/"proto" store-admin modules to those keys,
 *     so revoking the grant hides each manager.
 *
 * Mirrors scripts/test-reviews-feature.ts (pure-core, assert-based).
 *
 *   npm run test:coa-protocols
 */

import assert from "node:assert";

import {
  FEATURES,
  FEATURE_META,
  OPERATOR_GRANTABLE,
  ALL_FEATURES,
  planFeatureSet,
} from "../src/lib/features/catalog";
import {
  resolveEntitledPage,
  resolveShowReviews,
  MODULE_FEATURE,
  isAdminViewVisible,
} from "../src/storefront/visibility";
import type { Brand } from "../src/storefront/types";

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

const brandWith = (b: Partial<Brand>): Brand => b as Brand;

console.log("\nCOA + Protocols features — catalog registration + page gate\n");

// ───────────────────────────── catalog registration ─────────────────────────
console.log("catalog (admin → Features)");

check("STORE_COA is registered with the storefront.coa key", () => {
  assert.equal(FEATURES.STORE_COA, "storefront.coa");
  assert.ok(ALL_FEATURES.includes(FEATURES.STORE_COA), "in ALL_FEATURES");
});

check("STORE_PROTOCOLS is registered with the storefront.protocols key", () => {
  assert.equal(FEATURES.STORE_PROTOCOLS, "storefront.protocols");
  assert.ok(ALL_FEATURES.includes(FEATURES.STORE_PROTOCOLS), "in ALL_FEATURES");
});

check("both have admin Features metadata in the Catalog group", () => {
  for (const key of [FEATURES.STORE_COA, FEATURES.STORE_PROTOCOLS]) {
    const meta = FEATURE_META[key];
    assert.ok(meta, `FEATURE_META entry present for ${key}`);
    assert.equal(meta.group, "Catalog", `${key} group`);
    assert.ok(meta.label && meta.label.length > 0, `${key} has a label`);
    assert.ok(meta.description && meta.description.length > 0, `${key} has a description`);
  }
});

check("both are operator-grantable (never show 'Locked · upgrade plan')", () => {
  assert.ok(OPERATOR_GRANTABLE.has(FEATURES.STORE_COA), "storefront.coa grantable");
  assert.ok(OPERATOR_GRANTABLE.has(FEATURES.STORE_PROTOCOLS), "storefront.protocols grantable");
});

check("both are DEFAULT-OFF — not in any plan ceiling", () => {
  for (const plan of ["starter", "pro", "enterprise"]) {
    for (const key of [FEATURES.STORE_COA, FEATURES.STORE_PROTOCOLS]) {
      assert.ok(
        !planFeatureSet(plan).has(key),
        `expected ${plan} ceiling NOT to include ${key}`,
      );
    }
  }
});

check("their labels are distinct from Product specs (which only gates the product page)", () => {
  // storefront.product_specs is a different, plan-ceiling feature. The three must
  // not be confusable in the operator console — that ambiguity is what let the
  // COA manager look "off" while it was actually ungated.
  const labels = [
    FEATURE_META[FEATURES.STORE_COA].label,
    FEATURE_META[FEATURES.STORE_PROTOCOLS].label,
    FEATURE_META[FEATURES.STORE_PRODUCT_SPECS].label,
  ];
  assert.equal(new Set(labels).size, 3, `labels must be unique, got: ${labels.join(" | ")}`);
});

// ───────────────── MODULE_FEATURE (store-admin module → entitlement) ─────────
console.log("\nMODULE_FEATURE (store-admin module → feature key)");

// Asserted against the literal key strings, not FEATURES.* — comparing two
// absent constants would pass as undefined === undefined.
check("the 'lab' (COA manager) module maps to storefront.coa", () => {
  assert.equal(MODULE_FEATURE.lab, "storefront.coa");
});

check("the 'proto' (Protocols manager) module maps to storefront.protocols", () => {
  assert.equal(MODULE_FEATURE.proto, "storefront.protocols");
});

// ───────────────── resolveEntitledPage (the shared two-layer gate) ───────────
console.log("\nresolveEntitledPage(entitled, ownerToggle)");

check("hidden when not entitled — even if the owner toggle is on", () => {
  assert.equal(resolveEntitledPage(false, true), false);
  assert.equal(resolveEntitledPage(false, undefined), false);
  assert.equal(resolveEntitledPage(false, false), false);
});

check("visible when entitled and the owner has NOT turned the page off (default-on)", () => {
  assert.equal(resolveEntitledPage(true, undefined), true);
  assert.equal(resolveEntitledPage(true, true), true);
});

check("hidden when entitled but the owner explicitly turned the page off", () => {
  assert.equal(resolveEntitledPage(true, false), false);
});

check("resolveShowReviews stays behaviourally identical (delegates to the shared gate)", () => {
  for (const entitled of [true, false]) {
    for (const owner of [true, false, undefined]) {
      assert.equal(
        resolveShowReviews(entitled, owner),
        resolveEntitledPage(entitled, owner),
        `entitled=${entitled} owner=${owner}`,
      );
    }
  }
});

// ───────────── store-admin manager visibility (the actual regression) ────────
console.log("\nstore-admin manager visibility (isAdminViewVisible)");

check("the COA manager is HIDDEN for an unentitled tenant (was: always visible)", () => {
  // The regression: a Starter tenant with no grant must not see the Lab Results
  // manager. showPageCOA is what page.tsx projects the resolved gate onto.
  assert.equal(isAdminViewVisible(brandWith({ showPageCOA: false }), "lab"), false);
});

check("the Protocols manager is HIDDEN for an unentitled tenant (was: always visible)", () => {
  assert.equal(isAdminViewVisible(brandWith({ showPageProtocols: false }), "proto"), false);
});

check("both managers are visible once the operator grants + the owner keeps the page on", () => {
  assert.equal(isAdminViewVisible(brandWith({ showPageCOA: true }), "lab"), true);
  assert.equal(isAdminViewVisible(brandWith({ showPageProtocols: true }), "proto"), true);
});

// ────────────────────────────────── summary ─────────────────────────────────
console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed.\n`);
process.exit(failed === 0 ? 0 : 1);
