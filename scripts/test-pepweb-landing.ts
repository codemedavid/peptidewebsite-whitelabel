/**
 * Self-contained test for the Pepweb landing redesign's pure data layer
 * (no DB, no Next):
 *
 *   1. Plan defaults move to the monthly model — Starter ₱799, Business
 *      ₱1,499 (first month ₱699 via discountPriceCents), Automated ₱2,999 —
 *      and PLAN_META mirrors the same monthly prices.
 *   2. Plans gain a one-time setup fee (setupFeeCents + setupFeeWaived) with
 *      the same clamp/fallback discipline as plan prices, and packagesFrom
 *      carries it through to the marketing/wizard Package shape.
 *   3. marketing/config exports the new landing copy: Pepweb brand, hero
 *      stats, intro offer (trial link preserved), why-monthly checklist,
 *      plan-comparison rows, value props, and the 7-question FAQ.
 *
 *   npm run test:pepweb-landing
 */

import assert from "node:assert";

import {
  defaultPlanConfig,
  normalizePlanConfig,
  DEFAULT_TRIAL_PRICE_CENTS,
} from "../src/lib/platform/plan-config";
import { planPriceCents } from "../src/lib/admin/plans";
import {
  SITE,
  HERO_STATS,
  INTRO_OFFER,
  WHY_MONTHLY,
  COMPARISON,
  VALUE_PROPS,
  FAQS,
  packagesFrom,
} from "../src/marketing/config";

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

console.log("\nPepweb landing — pricing model + copy data\n");

// ───────────────────── monthly plan defaults ─────────────────────
const plans = defaultPlanConfig().plans;
const byKey = (k: string) => {
  const p = plans.find((p) => p.key === k);
  assert.ok(p, `plan ${k} exists`);
  return p!;
};

check("default monthly prices are ₱799 / ₱1,499 / ₱2,999", () => {
  assert.strictEqual(byKey("starter").priceCents, 79_900);
  assert.strictEqual(byKey("pro").priceCents, 149_900);
  assert.strictEqual(byKey("enterprise").priceCents, 299_900);
});

check("PLAN_META mirrors the same monthly prices", () => {
  assert.strictEqual(planPriceCents("starter"), 79_900);
  assert.strictEqual(planPriceCents("pro"), 149_900);
  assert.strictEqual(planPriceCents("enterprise"), 299_900);
});

check("Business first month is the ₱699 trial price (discountPriceCents)", () => {
  assert.strictEqual(byKey("pro").discountPriceCents, 69_900);
  assert.strictEqual(byKey("pro").discountPriceCents, DEFAULT_TRIAL_PRICE_CENTS);
});

// ───────────────────── setup fees ─────────────────────
check("default setup fees are ₱499 / ₱999 (waived) / ₱1,999", () => {
  assert.strictEqual(byKey("starter").setupFeeCents, 49_900);
  assert.strictEqual(byKey("pro").setupFeeCents, 99_900);
  assert.strictEqual(byKey("enterprise").setupFeeCents, 199_900);
  assert.strictEqual(byKey("starter").setupFeeWaived, false);
  assert.strictEqual(byKey("pro").setupFeeWaived, true);
  assert.strictEqual(byKey("enterprise").setupFeeWaived, false);
});

check("operator-set setup fee round-trips through normalize", () => {
  const cfg = normalizePlanConfig({
    plans: [{ key: "starter", setupFeeCents: 25_000, setupFeeWaived: true }],
  });
  const starter = cfg.plans.find((p) => p.key === "starter")!;
  assert.strictEqual(starter.setupFeeCents, 25_000);
  assert.strictEqual(starter.setupFeeWaived, true);
});

check("garbage setup fees fall back to the default (0 allowed = no fee)", () => {
  const bad = normalizePlanConfig({
    plans: [
      { key: "starter", setupFeeCents: -5 },
      { key: "pro", setupFeeCents: "nope", setupFeeWaived: "yes" },
    ],
  });
  assert.strictEqual(bad.plans.find((p) => p.key === "starter")!.setupFeeCents, 49_900);
  assert.strictEqual(bad.plans.find((p) => p.key === "pro")!.setupFeeCents, 99_900);
  assert.strictEqual(bad.plans.find((p) => p.key === "pro")!.setupFeeWaived, true);
  const zero = normalizePlanConfig({ plans: [{ key: "starter", setupFeeCents: 0 }] });
  assert.strictEqual(zero.plans.find((p) => p.key === "starter")!.setupFeeCents, 0);
});

// ───────────────────── packagesFrom mapping ─────────────────────
check("packagesFrom carries setup fee + monthly framing into Package", () => {
  const pkgs = packagesFrom(defaultPlanConfig().plans);
  const pro = pkgs.find((p) => p.key === "pro")!;
  const starter = pkgs.find((p) => p.key === "starter")!;
  assert.strictEqual(starter.setupFeeCents, 49_900);
  assert.strictEqual(starter.setupFeeWaived, false);
  assert.strictEqual(pro.setupFeeWaived, true);
  // effective (checkout) price = first-month promo when set
  assert.strictEqual(pro.priceCents, 69_900);
  assert.strictEqual(pro.discountLabel, "₱699");
  assert.strictEqual(pro.priceLabel, "₱1,499");
});

// ───────────────────── landing copy exports ─────────────────────
check("brand is Pepweb", () => {
  assert.strictEqual(SITE.brand, "Pepweb");
});

check("hero stats show 24/7, setup time, and the ₱799 entry price", () => {
  assert.strictEqual(HERO_STATS.length, 3);
  const values = HERO_STATS.map((s) => s.value).join(" ");
  assert.ok(values.includes("24/7"), "24/7 stat");
  assert.ok(values.includes("₱799"), "₱799/mo stat");
});

check("intro offer keeps the trial link (?plan=pro&trial=1)", () => {
  assert.ok(INTRO_OFFER.href.includes("plan=pro"), "targets Business");
  assert.ok(INTRO_OFFER.href.includes("trial=1"), "enters trial mode");
});

check("why-monthly checklist has the 8 included items", () => {
  assert.strictEqual(WHY_MONTHLY.items.length, 8);
  assert.ok(WHY_MONTHLY.items.some((i) => /hosting/i.test(i)));
  assert.ok(WHY_MONTHLY.items.some((i) => /security/i.test(i)));
});

check("comparison table covers 14 features across the 3 plans", () => {
  assert.strictEqual(COMPARISON.length, 14);
  for (const row of COMPARISON) {
    assert.ok(row.label.length > 0);
    for (const v of [row.starter, row.pro, row.enterprise])
      assert.strictEqual(typeof v, "boolean");
  }
  const storefront = COMPARISON.find((r) => r.label === "Storefront")!;
  assert.deepStrictEqual(
    [storefront.starter, storefront.pro, storefront.enterprise],
    [false, true, true],
  );
  const analytics = COMPARISON.find((r) => r.label === "Analytics dashboard")!;
  assert.deepStrictEqual(
    [analytics.starter, analytics.pro, analytics.enterprise],
    [false, false, true],
  );
});

check("value props are the 4 'platform, not just a website' cards", () => {
  assert.strictEqual(VALUE_PROPS.length, 4);
  assert.ok(VALUE_PROPS.some((v) => /always improving/i.test(v.title)));
});

check("FAQ is the 7-question set incl. the pepweb.store domain answer", () => {
  assert.strictEqual(FAQS.length, 7);
  assert.ok(FAQS.some((f) => f.a.includes("pepweb.store")), "domain FAQ");
  assert.ok(FAQS.some((f) => /setup fee/i.test(f.q)), "setup-fee FAQ");
});

// ──────────────────────────── summary ────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
