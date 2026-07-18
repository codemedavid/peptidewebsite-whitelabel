/**
 * Self-contained test for the trial system's Business-exclusive gating (pure
 * core — no DB, no Next runtime). Guards three seams:
 *
 *   1. Catalog: the new STORE_TRACK_NOTE feature key lives in the Business
 *      (pro) and Automated (enterprise) ceilings — NOT Starter — and stays
 *      operator-grantable so legacy Starter stores can be switched on
 *      individually without upgrading.
 *   2. visibility.ts lock helpers: Checkout Fee ("fee") and Delivery Note
 *      ("tracknote") render as VISIBLE-BUT-LOCKED tiles (gold BUSINESS badge,
 *      tap → upgrade) during an active trial or when the entitlement is
 *      revoked — never for paid Business/Automated or legacy brands.
 *   3. trial-state's brand serializer: the JSON-safe brand.trial blob the
 *      server projects for the admin banner.
 *
 *   npm run test:trial-gating
 */

import assert from "node:assert";

import {
  FEATURES,
  FEATURE_META,
  OPERATOR_GRANTABLE,
  planFeatureSet,
} from "../src/lib/features/catalog";
import {
  BUSINESS_EXCLUSIVE_MODULES,
  isAdminModuleLocked,
  lockedAdminModules,
  isAdminViewVisible,
} from "../src/storefront/visibility";
import {
  computeTrialState,
  brandTrialFrom,
  businessExclusiveLocked,
} from "../src/lib/trial/trial-state";
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

const DAY = 86_400_000;
const NOW = new Date("2026-07-16T08:00:00.000Z");

const activeTrial = brandTrialFrom(
  computeTrialState(
    {
      status: "trial",
      trial: true,
      trialStartsAt: new Date(NOW.getTime() - 7 * DAY),
      trialEndsAt: new Date(NOW.getTime() + 23 * DAY),
    },
    NOW,
  ),
);
const expiredTrial = brandTrialFrom(
  computeTrialState(
    {
      status: "trial",
      trial: true,
      trialStartsAt: new Date(NOW.getTime() - 31 * DAY),
      trialEndsAt: new Date(NOW.getTime() - 1 * DAY),
    },
    NOW,
  ),
);

function brandWith(overrides: Partial<Brand>): Brand {
  return overrides as Brand;
}

console.log("\nTrial gating — pure core\n");

// ──────────────────────────── catalog: STORE_TRACK_NOTE ─────────────────────
check("STORE_TRACK_NOTE key exists with the storefront.* naming convention", () => {
  assert.strictEqual(FEATURES.STORE_TRACK_NOTE, "storefront.track_note");
});

check("Delivery Note is in the Business and Automated ceilings, not Starter", () => {
  assert.ok(planFeatureSet("pro").has(FEATURES.STORE_TRACK_NOTE), "pro should include it");
  assert.ok(
    planFeatureSet("enterprise").has(FEATURES.STORE_TRACK_NOTE),
    "enterprise should include it",
  );
  assert.ok(
    !planFeatureSet("starter").has(FEATURES.STORE_TRACK_NOTE),
    "starter must not include it",
  );
});

check("Delivery Note is operator-grantable (legacy Starter stores can be re-enabled)", () => {
  assert.ok(OPERATOR_GRANTABLE.has(FEATURES.STORE_TRACK_NOTE));
});

check("Delivery Note has admin-panel metadata in the Ecommerce group", () => {
  const meta = FEATURE_META[FEATURES.STORE_TRACK_NOTE];
  assert.ok(meta, "FEATURE_META entry missing");
  assert.strictEqual(meta.group, "Ecommerce");
  assert.ok(meta.label.length > 0 && meta.description.length > 0);
});

// ─────────────────────── brand serializer (JSON-safe blob) ──────────────────
check("brandTrialFrom serializes an active trial with an ISO endsAt string", () => {
  assert.ok(activeTrial, "expected a blob for an active trial");
  assert.strictEqual(activeTrial!.onTrial, true);
  assert.strictEqual(activeTrial!.expired, false);
  assert.strictEqual(activeTrial!.daysLeft, 23);
  assert.strictEqual(typeof activeTrial!.endsAt, "string");
  assert.ok(!Number.isNaN(new Date(activeTrial!.endsAt).getTime()), "endsAt parses back");
});

check("brandTrialFrom returns undefined for tenants not governed by a trial", () => {
  const none = brandTrialFrom(
    computeTrialState(
      { status: "active", trial: false, trialStartsAt: null, trialEndsAt: null },
      NOW,
    ),
  );
  assert.strictEqual(none, undefined);
});

// ───────────── pure Business-exclusive lock rule (single source) ─────────────
// The ONE rule the server charge gate (isBusinessExclusiveLocked), the client
// tile lock (isAdminModuleLocked) AND the storefront fee display all derive from,
// so the fee a customer is SHOWN can never diverge from the fee the server
// CHARGES. Active trial → locked regardless of entitlement (the trial plan is
// technically entitled — the lock is the upsell); otherwise follow entitlement.
check("businessExclusiveLocked: active trial locks regardless of entitlement", () => {
  assert.strictEqual(businessExclusiveLocked(activeTrial, true), true);
  assert.strictEqual(businessExclusiveLocked(activeTrial, false), true);
});

check("businessExclusiveLocked: no trial blob → follows entitlement", () => {
  assert.strictEqual(businessExclusiveLocked(undefined, true), false);
  assert.strictEqual(businessExclusiveLocked(undefined, false), true);
});

check("businessExclusiveLocked: expired trial → follows entitlement", () => {
  assert.strictEqual(businessExclusiveLocked(expiredTrial, true), false);
  assert.strictEqual(businessExclusiveLocked(expiredTrial, false), true);
});

check("isAdminModuleLocked('fee') is exactly businessExclusiveLocked(trial, entitled)", () => {
  const b = brandWith({ trial: activeTrial, adminFeeEntitled: true });
  assert.strictEqual(
    isAdminModuleLocked(b, "fee"),
    businessExclusiveLocked(b.trial, b.adminFeeEntitled !== false),
  );
});

// ───────────────────────────── lock rules (visibility) ──────────────────────
check("exclusive module registry covers exactly Checkout Fee and Delivery Note", () => {
  assert.deepStrictEqual(Object.keys(BUSINESS_EXCLUSIVE_MODULES).sort(), ["fee", "tracknote"]);
});

check("active trial locks both exclusives even though the trial plan is entitled", () => {
  const b = brandWith({ trial: activeTrial, adminFeeEntitled: true, trackNoteEntitled: true });
  assert.strictEqual(isAdminModuleLocked(b, "fee"), true);
  assert.strictEqual(isAdminModuleLocked(b, "tracknote"), true);
  assert.deepStrictEqual(lockedAdminModules(b).sort(), ["fee", "tracknote"]);
});

check("paid Business/Automated tenant (no trial blob, entitled) is unlocked", () => {
  const b = brandWith({ adminFeeEntitled: true, trackNoteEntitled: true });
  assert.strictEqual(isAdminModuleLocked(b, "fee"), false);
  assert.strictEqual(isAdminModuleLocked(b, "tracknote"), false);
  assert.deepStrictEqual(lockedAdminModules(b), []);
});

check("revoked entitlements lock the tiles (post-downgrade Starter)", () => {
  const b = brandWith({ adminFeeEntitled: false, trackNoteEntitled: false });
  assert.strictEqual(isAdminModuleLocked(b, "fee"), true);
  assert.strictEqual(isAdminModuleLocked(b, "tracknote"), true);
});

check("legacy brand blob without any trial fields stays fully unlocked", () => {
  const b = brandWith({});
  assert.strictEqual(isAdminModuleLocked(b, "fee"), false);
  assert.strictEqual(isAdminModuleLocked(b, "tracknote"), false);
  assert.deepStrictEqual(lockedAdminModules(b), []);
});

check("expired trial defers to entitlements (admin is behind the plans screen anyway)", () => {
  const b = brandWith({ trial: expiredTrial, adminFeeEntitled: true, trackNoteEntitled: true });
  assert.strictEqual(isAdminModuleLocked(b, "fee"), false);
});

check("unknown module ids are never locked", () => {
  const b = brandWith({ trial: activeTrial });
  assert.strictEqual(isAdminModuleLocked(b, "orders"), false);
  assert.strictEqual(isAdminModuleLocked(b, "products"), false);
});

check("locked is not hidden: fee/tracknote views stay visible to render as teasers", () => {
  const b = brandWith({ trial: activeTrial, adminFeeEntitled: true, trackNoteEntitled: true });
  assert.strictEqual(isAdminViewVisible(b, "fee"), true);
  assert.strictEqual(isAdminViewVisible(b, "tracknote"), true);
});

// ──────────────────────────────────── summary ───────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
