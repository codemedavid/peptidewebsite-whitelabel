/**
 * Self-contained test for the new-feature spotlight picker (pure core — no DB,
 * no Next runtime). The spotlight is the gold strip on the trial dashboard:
 * whenever the operator flags a released feature as "new" (feature registry
 * newKeys — the same source as the "New" module tags), trial and unentitled
 * stores see it advertised as a Business exclusive with an "Unlock with
 * Business" button.
 *
 *   - src/lib/features/feature-spotlight.ts
 *       pickFeatureSpotlight(newKeys, isEntitled, trialActive)
 *         → { key, label, description } | undefined
 *
 *   npm run test:feature-spotlight
 */

import assert from "node:assert";

import { FEATURES, FEATURE_META } from "../src/lib/features/catalog";
import { pickFeatureSpotlight } from "../src/lib/features/feature-spotlight";

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

const SA = FEATURES.STORE_SALES_ANALYTICS;
const CARD = FEATURES.STORE_CARD_STUDIO;
const entitledTo =
  (...keys: string[]) =>
  (key: string) =>
    keys.includes(key);
const none = () => false;
const all = () => true;

console.log("\nFeature spotlight — pure core\n");

check("no operator-kept new keys → no spotlight", () => {
  assert.strictEqual(pickFeatureSpotlight([], none, true), undefined);
});

check("active trial spotlights the first new feature even when entitled", () => {
  const s = pickFeatureSpotlight([SA], all, true);
  assert.ok(s, "expected a spotlight");
  assert.strictEqual(s!.key, SA);
  assert.strictEqual(s!.label, FEATURE_META[SA].label);
  assert.strictEqual(s!.description, FEATURE_META[SA].description);
});

check("outside a trial, entitled features are skipped — first unentitled wins", () => {
  const s = pickFeatureSpotlight([SA, CARD], entitledTo(SA), false);
  assert.ok(s, "expected a spotlight");
  assert.strictEqual(s!.key, CARD);
});

check("outside a trial with every new feature entitled → no spotlight", () => {
  assert.strictEqual(pickFeatureSpotlight([SA, CARD], all, false), undefined);
});

check("unknown / retired keys are skipped, never crash the render", () => {
  const s = pickFeatureSpotlight(["totally.unknown", SA], none, false);
  assert.ok(s, "expected a spotlight");
  assert.strictEqual(s!.key, SA);
});

check("order is respected: the first eligible key is the spotlight", () => {
  const s = pickFeatureSpotlight([CARD, SA], none, true);
  assert.strictEqual(s!.key, CARD);
});

// ──────────────────────────────────── summary ───────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
