/**
 * Self-contained test for trial expiry + the Starter downgrade (pure core —
 * no DB, no Next). Guards:
 *
 *   1. isTrialPaused — the single rule the paused storefront, the checkout
 *      rejection and the admin lock all derive from: paused ⇔ trial-governed
 *      AND expired.
 *   2. STARTER_COMBOS — the two "pick exactly ONE combination" downgrade
 *      bundles: (a) FAQ + Protocols, (b) Calculator + Order Tracking. Each is
 *      expressed as feature grants/revokes relative to the Starter ceiling
 *      plus storefront page toggles, so entitlements and nav stay consistent.
 *   3. The 10-product cap that only binds tenants downgraded from a trial —
 *      legacy Starter stores are never capped retroactively.
 *
 *   npm run test:trial-expiry
 */

import assert from "node:assert";

import { FEATURES, planFeatureSet } from "../src/lib/features/catalog";
import { computeTrialState, isTrialPaused } from "../src/lib/trial/trial-state";
import {
  STARTER_COMBOS,
  STARTER_DOWNGRADE_PRODUCT_CAP,
  starterCombo,
  canAddProductAfterDowngrade,
} from "../src/lib/trial/starter-downgrade";

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
const trialAt = (endOffsetDays: number) =>
  computeTrialState(
    {
      status: "trial",
      trial: true,
      trialStartsAt: new Date(NOW.getTime() + (endOffsetDays - 30) * DAY),
      trialEndsAt: new Date(NOW.getTime() + endOffsetDays * DAY),
    },
    NOW,
  );

console.log("\nTrial expiry + Starter downgrade — pure core\n");

// ────────────────────────────────── paused rule ─────────────────────────────
check("paused ⇔ trial-governed AND expired", () => {
  assert.strictEqual(isTrialPaused(trialAt(-1)), true, "expired trial pauses");
  assert.strictEqual(isTrialPaused(trialAt(10)), false, "active trial stays open");
  assert.strictEqual(
    isTrialPaused(
      computeTrialState(
        { status: "active", trial: false, trialStartsAt: null, trialEndsAt: null },
        NOW,
      ),
    ),
    false,
    "non-trial tenants never pause",
  );
  assert.strictEqual(isTrialPaused(undefined), false, "absent brand blob never pauses");
});

// ───────────────────────────────── the two combos ───────────────────────────
check("exactly two combos: FAQ+Protocols and Calculator+Order Tracking", () => {
  assert.deepStrictEqual(
    STARTER_COMBOS.map((c) => c.id),
    ["a", "b"],
  );
  assert.match(STARTER_COMBOS[0].title, /FAQ/);
  assert.match(STARTER_COMBOS[0].title, /Protocols/);
  assert.match(STARTER_COMBOS[1].title, /Calculator/);
  assert.match(STARTER_COMBOS[1].title, /Track/i);
});

check("combo lookup: known ids resolve, unknown ids don't", () => {
  assert.strictEqual(starterCombo("a")?.id, "a");
  assert.strictEqual(starterCombo("b")?.id, "b");
  assert.strictEqual(starterCombo("x"), undefined);
  assert.strictEqual(starterCombo(""), undefined);
});

check("combo A keeps FAQ+Protocols: calculator revoked, FAQ/protocol pages shown", () => {
  const a = starterCombo("a")!;
  assert.ok(a.revokes.includes(FEATURES.STORE_CALCULATOR), "revokes the calculator");
  assert.ok(
    planFeatureSet("starter").has(FEATURES.STORE_CALCULATOR),
    "sanity: calculator IS in the starter ceiling (so it needs a revocation)",
  );
  assert.strictEqual(a.pageToggles.showPageFAQ, true);
  assert.strictEqual(a.pageToggles.showPageProtocols, true);
  assert.strictEqual(a.pageToggles.showPageCalculator, false);
  assert.strictEqual(a.pageToggles.showPageTrack, false);
});

check("combo B keeps Calculator+Tracking: order tracking granted beyond the ceiling", () => {
  const b = starterCombo("b")!;
  assert.ok(b.grants.includes(FEATURES.STORE_ORDER_TRACKING), "grants order tracking");
  assert.ok(
    !planFeatureSet("starter").has(FEATURES.STORE_ORDER_TRACKING),
    "sanity: order tracking is OUTSIDE the starter ceiling (so it needs a grant)",
  );
  assert.strictEqual(b.pageToggles.showPageCalculator, true);
  assert.strictEqual(b.pageToggles.showPageTrack, true);
  assert.strictEqual(b.pageToggles.showPageFAQ, false);
  assert.strictEqual(b.pageToggles.showPageProtocols, false);
});

check("grants and revokes never overlap within a combo", () => {
  for (const combo of STARTER_COMBOS) {
    const grants = new Set<string>(combo.grants);
    for (const r of combo.revokes) {
      assert.ok(!grants.has(r), `${combo.id}: ${r} both granted and revoked`);
    }
  }
});

// ────────────────────────────── 10-product cap ──────────────────────────────
check("downgraded stores cap at 10 products; legacy stores never do", () => {
  assert.strictEqual(STARTER_DOWNGRADE_PRODUCT_CAP, 10);
  assert.strictEqual(canAddProductAfterDowngrade(9, true), true);
  assert.strictEqual(canAddProductAfterDowngrade(10, true), false);
  assert.strictEqual(canAddProductAfterDowngrade(500, true), false);
  assert.strictEqual(canAddProductAfterDowngrade(500, false), true);
});

// ──────────────────────────────────── summary ───────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
