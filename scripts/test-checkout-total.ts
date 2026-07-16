/**
 * Self-contained test for the get-started checkout total (no DB, no Next):
 *
 *   checkoutQuote() in src/lib/onboarding/pricing.ts is the single source of
 *   the wizard's "Amount to pay" — first payment (trial / first-month promo /
 *   list) + Starter extra add-ons + the one-time setup fee (skipped when the
 *   plan waives it or the Business trial is chosen — trial = FREE setup).
 *
 *   npm run test:checkout-total
 */

import assert from "node:assert";

import { checkoutQuote } from "../src/lib/onboarding/pricing";
import { defaultPlanConfig } from "../src/lib/platform/plan-config";
import { packagesFrom } from "../src/marketing/config";
import {
  PRO_TRIAL_PRICE_CENTS,
  STARTER_EXTRA_FEATURE_PRICE_CENTS,
} from "../src/lib/onboarding/schema";

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

console.log("\nCheckout total — setup fees wired in\n");

const pkgs = packagesFrom(defaultPlanConfig().plans);
const pkg = (k: string) => pkgs.find((p) => p.key === k)!;

check("Starter = ₱799 first month + ₱499 setup = ₱1,298", () => {
  const q = checkoutQuote(pkg("starter"), { trial: false, extraFeatureCount: 0 });
  assert.strictEqual(q.baseCents, 79_900);
  assert.strictEqual(q.setupFeeCents, 49_900);
  assert.strictEqual(q.setupFeeWaived, false);
  assert.strictEqual(q.addonCents, 0);
  assert.strictEqual(q.totalCents, 129_800);
});

check("Starter extras bill on top (2 × ₱1,500)", () => {
  const q = checkoutQuote(pkg("starter"), { trial: false, extraFeatureCount: 2 });
  assert.strictEqual(q.addonCents, 2 * STARTER_EXTRA_FEATURE_PRICE_CENTS);
  assert.strictEqual(q.totalCents, 129_800 + 300_000);
});

check("Business default = first-month ₱699, setup waived → ₱699 total", () => {
  const q = checkoutQuote(pkg("pro"), { trial: false, extraFeatureCount: 0 });
  assert.strictEqual(q.baseCents, 69_900); // effective (promo) price
  assert.strictEqual(q.setupFeeCents, 0); // waived → nothing charged
  assert.strictEqual(q.setupFeeWaived, true); // but shown as FREE (₱999 struck)
  assert.strictEqual(q.totalCents, 69_900);
});

check("Business trial = ₱699, setup always FREE even if un-waived", () => {
  const unwaived = { ...pkg("pro"), setupFeeWaived: false };
  const q = checkoutQuote(unwaived, { trial: true, extraFeatureCount: 0 });
  assert.strictEqual(q.baseCents, PRO_TRIAL_PRICE_CENTS);
  assert.strictEqual(q.setupFeeCents, 0);
  assert.strictEqual(q.setupFeeWaived, true);
  assert.strictEqual(q.totalCents, PRO_TRIAL_PRICE_CENTS);
});

check("operator-un-waived Business without promo = ₱1,499 + ₱999 = ₱2,498", () => {
  const p = { ...pkg("pro"), discountLabel: undefined, priceCents: 149_900, setupFeeWaived: false };
  const q = checkoutQuote(p, { trial: false, extraFeatureCount: 0 });
  assert.strictEqual(q.totalCents, 149_900 + 99_900);
});

check("Automated = ₱2,999 + ₱1,999 setup = ₱4,998", () => {
  const q = checkoutQuote(pkg("enterprise"), { trial: false, extraFeatureCount: 0 });
  assert.strictEqual(q.setupFeeCents, 199_900);
  assert.strictEqual(q.totalCents, 499_800);
});

check("zero setup fee stays zero and un-waived (no line to show)", () => {
  const p = { ...pkg("starter"), setupFeeCents: 0 };
  const q = checkoutQuote(p, { trial: false, extraFeatureCount: 0 });
  assert.strictEqual(q.setupFeeCents, 0);
  assert.strictEqual(q.setupFeeWaived, false);
  assert.strictEqual(q.totalCents, 79_900);
});

check("extras never apply to non-Starter-style negative counts", () => {
  const q = checkoutQuote(pkg("enterprise"), { trial: false, extraFeatureCount: -3 });
  assert.strictEqual(q.addonCents, 0);
});

// ──────────────────────────── summary ────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
