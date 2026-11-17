/**
 * Peptide Tracker feature flag (docs/mobile-admin/TRACKER.md, phase 0).
 *
 *   - mobile.tracker              operator-grantable, default OFF on every plan
 *   - mobile.tracker.guide_import child of mobile.tracker (nested in Super Admin)
 *   - trackerAccess()             what /me tells the app
 *
 *   npm run test:tracker-flag
 */

import assert from "node:assert";

import {
  FEATURES,
  FEATURE_META,
  OPERATOR_GRANTABLE,
  PLAN_FEATURES,
  type FeatureKey,
} from "../src/lib/features/catalog";
import { masterSwitchFor } from "../src/lib/features/plan-scope";
import { trackerAccess } from "../src/lib/mobile/tracker-access";
import { TRACKER_GUEST_REFUSED, TRACKER_OFF, trackerGate } from "../src/lib/tracker/gate";
import { trackerOwnerOf } from "../src/lib/tracker/owner";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`);
  }
}

const has = (...keys: FeatureKey[]) => {
  const set = new Set<FeatureKey>(keys);
  return (k: FeatureKey) => set.has(k);
};

console.log("catalog");
check("tracker keys exist with the agreed names", () => {
  assert.equal(FEATURES.MOBILE_TRACKER, "mobile.tracker");
  assert.equal(FEATURES.MOBILE_TRACKER_GUIDE_IMPORT, "mobile.tracker.guide_import");
});
check("both are listed in the Super Admin feature list (meta present)", () => {
  for (const k of [FEATURES.MOBILE_TRACKER, FEATURES.MOBILE_TRACKER_GUIDE_IMPORT]) {
    const meta = FEATURE_META[k];
    assert.ok(meta, `no FEATURE_META for ${k}`);
    assert.ok(meta.label.length > 0 && meta.description.length > 0);
    assert.equal(meta.group, "Ecommerce");
  }
});
check("both are operator-grantable (toggleable on any plan)", () => {
  assert.ok(OPERATOR_GRANTABLE.has(FEATURES.MOBILE_TRACKER));
  assert.ok(OPERATOR_GRANTABLE.has(FEATURES.MOBILE_TRACKER_GUIDE_IMPORT));
});
check("default OFF: outside every plan ceiling", () => {
  for (const [plan, keys] of Object.entries(PLAN_FEATURES)) {
    assert.ok(!keys.includes(FEATURES.MOBILE_TRACKER), `${plan} ceiling includes mobile.tracker`);
    assert.ok(!keys.includes(FEATURES.MOBILE_TRACKER_GUIDE_IMPORT), `${plan} ceiling includes guide_import`);
  }
});
check("guide import nests under the tracker master switch", () => {
  assert.equal(masterSwitchFor(FEATURES.MOBILE_TRACKER_GUIDE_IMPORT), FEATURES.MOBILE_TRACKER);
  assert.equal(masterSwitchFor(FEATURES.MOBILE_TRACKER), null);
});

console.log("trackerAccess");
check("nothing granted → off", () => {
  assert.deepEqual(trackerAccess(has()), { enabled: false, guideImport: false });
});
check("tracker granted but customer app closed → inert", () => {
  assert.deepEqual(trackerAccess(has(FEATURES.MOBILE_TRACKER)), { enabled: false, guideImport: false });
});
check("tracker + app shopping → on", () => {
  assert.equal(trackerAccess(has(FEATURES.MOBILE_TRACKER, FEATURES.MOBILE_SHOP)).enabled, true);
});
check("tracker + app community → on", () => {
  assert.equal(trackerAccess(has(FEATURES.MOBILE_TRACKER, FEATURES.MOBILE_COMMUNITY)).enabled, true);
});
check("customer app open but tracker not granted → off", () => {
  assert.equal(trackerAccess(has(FEATURES.MOBILE_SHOP, FEATURES.MOBILE_COMMUNITY)).enabled, false);
});
check("guide import needs the tracker, the grant AND store protocols", () => {
  const base = [FEATURES.MOBILE_TRACKER, FEATURES.MOBILE_SHOP] as FeatureKey[];
  assert.equal(trackerAccess(has(...base, FEATURES.MOBILE_TRACKER_GUIDE_IMPORT)).guideImport, false);
  assert.equal(trackerAccess(has(...base, FEATURES.STORE_PROTOCOLS)).guideImport, false);
  assert.equal(
    trackerAccess(has(...base, FEATURES.MOBILE_TRACKER_GUIDE_IMPORT, FEATURES.STORE_PROTOCOLS)).guideImport,
    true,
  );
});
check("guide import granted without the tracker → off", () => {
  assert.equal(
    trackerAccess(has(FEATURES.MOBILE_SHOP, FEATURES.MOBILE_TRACKER_GUIDE_IMPORT, FEATURES.STORE_PROTOCOLS)).guideImport,
    false,
  );
});

// ── Who may use it: every signed-in account, each its OWN tracker ─────────
const ON = { enabled: true, guideImport: false };
check("gate: a signed-in account on a granted store passes (customer, owner and staff alike)", () => {
  assert.equal(trackerGate(ON), null);
});
check("gate: an app guest is refused; tracker off → not found; guides need guide import", () => {
  assert.equal(trackerGate(ON, { guest: true }), TRACKER_GUEST_REFUSED);
  assert.equal(trackerGate({ enabled: false, guideImport: false }), TRACKER_OFF);
  assert.equal(trackerGate(ON, { guideImport: true }), TRACKER_OFF);
});
check("owner key: the store owner, each staff member and each customer get their own subject", () => {
  assert.deepEqual(trackerOwnerOf({ kind: "owner" }), { subject: "owner", customerId: null, staffId: null });
  assert.deepEqual(trackerOwnerOf({ kind: "staff", id: "s1" }), { subject: "staff:s1", customerId: null, staffId: "s1" });
  assert.deepEqual(trackerOwnerOf({ kind: "customer", id: "c1" }), { subject: "customer:c1", customerId: "c1", staffId: null });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
