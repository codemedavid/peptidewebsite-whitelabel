/**
 * Yearly subscription at get-started checkout (pure — no DB, no Next runtime).
 *
 *   The wizard's package step now offers a billing cycle: Monthly (the usual
 *   list price) or Yearly — ₱5,899 Starter / ₱9,899 Business / ₱15,899
 *   Automated. The one-time setup fee is charged exactly as before (waived on
 *   Business, waived on trial), and Starter's extra add-on features stay a flat
 *   ₱1,500 each on either cycle — a Starter picking more than the included 2 is
 *   nudged toward the Business package instead.
 *
 *   checkoutQuote() stays the single source of the "Amount to pay" the client
 *   sees, and amountDueFromConfig() the server-authoritative stamp; both must
 *   agree per cycle.
 *
 *   npm run test:yearly-subscription
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  checkoutQuote,
  amountDueFromConfig,
  yearlySavingsCents,
  yearlySavingsPercent,
} from "../src/lib/onboarding/pricing";
import { defaultPlanConfig, normalizePlanConfig } from "../src/lib/platform/plan-config";
import { packagesFrom } from "../src/marketing/config";
import {
  onboardingSchema,
  normalizeOnboardingCycle,
  ONBOARDING_BILLING_CYCLES,
  STARTER_EXTRA_FEATURE_PRICE_CENTS,
} from "../src/lib/onboarding/schema";
import { draftToPayload, INITIAL_DRAFT } from "../src/components/onboarding/useOnboardingForm";

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

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

console.log("\nYearly subscription — get-started checkout\n");

const config = defaultPlanConfig();
const pkgs = packagesFrom(config.plans);
const pkg = (k: string) => pkgs.find((p) => p.key === k)!;

const YEARLY = { starter: 589_900, pro: 989_900, enterprise: 1_589_900 };

// ──────────────────────────── plan config carries yearly prices ─────────────
check("default plan config prices the year: ₱5,899 / ₱9,899 / ₱15,899", () => {
  const byKey = Object.fromEntries(config.plans.map((p) => [p.key, p.yearlyPriceCents]));
  assert.strictEqual(byKey.starter, YEARLY.starter);
  assert.strictEqual(byKey.pro, YEARLY.pro);
  assert.strictEqual(byKey.enterprise, YEARLY.enterprise);
});

check("operator can edit the yearly price (normalize keeps a valid one)", () => {
  const edited = normalizePlanConfig({
    ...config,
    plans: config.plans.map((p) => (p.key === "starter" ? { ...p, yearlyPriceCents: 499_900 } : p)),
  });
  assert.strictEqual(edited.plans.find((p) => p.key === "starter")!.yearlyPriceCents, 499_900);
});

check("garbage / zero / negative yearly prices fall back to the plan default", () => {
  for (const bad of [0, -1, "abc", null, undefined, NaN]) {
    const n = normalizePlanConfig({
      plans: [{ key: "pro", yearlyPriceCents: bad }],
    });
    assert.strictEqual(
      n.plans.find((p) => p.key === "pro")!.yearlyPriceCents,
      YEARLY.pro,
      `bad value ${String(bad)} should fall back`,
    );
  }
});

check("packagesFrom exposes the yearly price + label to the wizard", () => {
  assert.strictEqual(pkg("starter").yearlyPriceCents, YEARLY.starter);
  assert.strictEqual(pkg("pro").yearlyPriceLabel, "₱9,899");
  assert.strictEqual(pkg("enterprise").yearlyPriceCents, YEARLY.enterprise);
});

// ──────────────────────────── checkoutQuote per cycle ───────────────────────
check("monthly is unchanged: Starter ₱799 + ₱499 setup = ₱1,298", () => {
  const q = checkoutQuote(pkg("starter"), {
    trial: false,
    extraFeatureCount: 0,
    billingCycle: "monthly",
  });
  assert.strictEqual(q.billingCycle, "monthly");
  assert.strictEqual(q.baseCents, 79_900);
  assert.strictEqual(q.totalCents, 129_800);
});

check("an omitted cycle still means monthly (back-compat with existing callers)", () => {
  const q = checkoutQuote(pkg("pro"), { trial: false, extraFeatureCount: 0 });
  assert.strictEqual(q.billingCycle, "monthly");
  assert.strictEqual(q.baseCents, 149_900);
});

check("Starter yearly = ₱5,899 + ₱499 setup as usual = ₱6,398", () => {
  const q = checkoutQuote(pkg("starter"), {
    trial: false,
    extraFeatureCount: 0,
    billingCycle: "yearly",
  });
  assert.strictEqual(q.billingCycle, "yearly");
  assert.strictEqual(q.baseCents, YEARLY.starter);
  assert.strictEqual(q.setupFeeCents, 49_900);
  assert.strictEqual(q.setupFeeWaived, false);
  assert.strictEqual(q.totalCents, YEARLY.starter + 49_900);
});

check("Business yearly = ₱9,899, setup still FREE (₱999 struck through)", () => {
  const q = checkoutQuote(pkg("pro"), { trial: false, extraFeatureCount: 0, billingCycle: "yearly" });
  assert.strictEqual(q.baseCents, YEARLY.pro);
  assert.strictEqual(q.setupFeeCents, 0);
  assert.strictEqual(q.setupFeeWaived, true);
  assert.strictEqual(q.totalCents, YEARLY.pro);
});

check("Automated yearly = ₱15,899 + ₱1,999 setup = ₱17,898", () => {
  const q = checkoutQuote(pkg("enterprise"), {
    trial: false,
    extraFeatureCount: 0,
    billingCycle: "yearly",
  });
  assert.strictEqual(q.totalCents, YEARLY.enterprise + 199_900);
});

check("Starter extras stay a flat ₱1,500 each on yearly (not ×12)", () => {
  const q = checkoutQuote(pkg("starter"), {
    trial: false,
    extraFeatureCount: 2,
    billingCycle: "yearly",
  });
  assert.strictEqual(q.addonCents, 2 * STARTER_EXTRA_FEATURE_PRICE_CENTS);
  assert.strictEqual(q.totalCents, YEARLY.starter + 49_900 + 2 * STARTER_EXTRA_FEATURE_PRICE_CENTS);
});

check("a first-month promo never applies to the yearly price", () => {
  const promo = normalizePlanConfig({
    ...config,
    plans: config.plans.map((p) => (p.key === "pro" ? { ...p, discountPriceCents: 99_900 } : p)),
  });
  const promoPkg = packagesFrom(promo.plans).find((p) => p.key === "pro")!;
  assert.strictEqual(promoPkg.priceCents, 99_900); // monthly headline is the promo
  const q = checkoutQuote(promoPkg, { trial: false, extraFeatureCount: 0, billingCycle: "yearly" });
  assert.strictEqual(q.baseCents, YEARLY.pro); // yearly is untouched by it
});

check("the trial is a one-month offer — it overrides a yearly pick", () => {
  const q = checkoutQuote(pkg("pro"), { trial: true, extraFeatureCount: 0, billingCycle: "yearly" });
  assert.strictEqual(q.billingCycle, "monthly");
  assert.strictEqual(q.baseCents, config.trialPriceCents);
  assert.strictEqual(q.totalCents, config.trialPriceCents);
});

// ──────────────────────────── yearly savings copy ───────────────────────────
check("yearly savings vs 12 months: Starter saves ₱3,689 (38%)", () => {
  assert.strictEqual(yearlySavingsCents(79_900, YEARLY.starter), 79_900 * 12 - YEARLY.starter);
  assert.strictEqual(yearlySavingsPercent(79_900, YEARLY.starter), 38);
});

check("savings never go negative when a yearly price is set above 12 months", () => {
  assert.strictEqual(yearlySavingsCents(79_900, 1_200_000), 0);
  assert.strictEqual(yearlySavingsPercent(79_900, 1_200_000), 0);
});

// ──────────────────── server-authoritative stamp per cycle ──────────────────
check("amountDueFromConfig: Starter yearly = ₱6,398 (matches the paybox)", () => {
  assert.strictEqual(
    amountDueFromConfig(config, {
      planKey: "starter",
      trial: false,
      extraFeatureCount: 0,
      billingCycle: "yearly",
    }),
    YEARLY.starter + 49_900,
  );
});

check("amountDueFromConfig: Business yearly = ₱9,899 via a legacy alias too", () => {
  assert.strictEqual(
    amountDueFromConfig(config, {
      planKey: "business",
      trial: false,
      extraFeatureCount: 0,
      billingCycle: "yearly",
    }),
    YEARLY.pro,
  );
});

check("amountDueFromConfig: monthly totals are untouched by this change", () => {
  assert.strictEqual(
    amountDueFromConfig(config, { planKey: "enterprise", trial: false, extraFeatureCount: 0 }),
    499_800,
  );
});

// ──────────────────────────── payload plumbing ──────────────────────────────
check("the onboarding payload carries billingCycle, defaulting to monthly", () => {
  assert.deepStrictEqual([...ONBOARDING_BILLING_CYCLES], ["monthly", "yearly"]);
  const base = { businessName: "Peptide Co", email: "a@b.com", termsAccepted: true };
  assert.strictEqual(onboardingSchema.parse(base).billingCycle, "monthly");
  assert.strictEqual(onboardingSchema.parse({ ...base, billingCycle: "yearly" }).billingCycle, "yearly");
  assert.strictEqual(onboardingSchema.safeParse({ ...base, billingCycle: "weekly" }).success, false);
});

check("normalizeOnboardingCycle narrows untrusted input to monthly", () => {
  assert.strictEqual(normalizeOnboardingCycle("yearly"), "yearly");
  for (const bad of ["quarterly", "", null, undefined, 12, {}]) {
    assert.strictEqual(normalizeOnboardingCycle(bad), "monthly", `bad cycle ${String(bad)}`);
  }
});

check("the wizard draft starts monthly and maps its cycle into the payload", () => {
  assert.strictEqual(INITIAL_DRAFT.billingCycle, "monthly");
  assert.strictEqual(draftToPayload({ ...INITIAL_DRAFT, billingCycle: "yearly" }).billingCycle, "yearly");
});

// ──────────────────────────── wiring (source markers) ───────────────────────
check("the package step renders a monthly / yearly cycle toggle", () => {
  const src = read("src/components/onboarding/steps/index.tsx");
  assert.ok(src.includes("mk-cycle-toggle"), "expected a mk-cycle-toggle control");
  assert.ok(src.includes("billingCycle"), "expected the step to drive draft.billingCycle");
  assert.ok(/\/year/.test(src), "expected a /year price suffix");
});

check("the checkout paybox quotes the chosen cycle", () => {
  const src = read("src/components/onboarding/steps/index.tsx");
  assert.ok(
    /billingCycle:\s*draft\.billingCycle/.test(src),
    "expected checkoutQuote to be fed draft.billingCycle",
  );
});

check("a Starter picking beyond the included features is nudged to Business", () => {
  const src = read("src/components/onboarding/steps/index.tsx");
  assert.ok(src.includes("mk-upsell"), "expected a Business upsell nudge");
  assert.ok(
    /packageKey:\s*"pro"/.test(src),
    "expected the nudge to switch the draft to the Business package",
  );
});

check("the server action stamps the cycle and honors it in the total", () => {
  const src = read("src/actions/public-onboarding.ts");
  assert.ok(src.includes("billingCycle"), "expected billingCycle in the action");
  assert.ok(src.includes("normalizeOnboardingCycle"), "expected untrusted input to be narrowed");
  assert.ok(src.includes("subscriptionCycle"), "expected the tenant's cycle to be seeded");
});

check("OnboardingSubmission persists the billing cycle", () => {
  const schema = read("prisma/schema.prisma");
  const model = schema.slice(schema.indexOf("model OnboardingSubmission"));
  assert.ok(/billingCycle\s+String\s+@default\("monthly"\)/.test(model.slice(0, 3000)));
});

check("the operator sees the cycle on the onboarding record", () => {
  assert.ok(read("src/lib/admin/onboarding-types.ts").includes("billingCycle"));
  assert.ok(read("src/lib/admin/onboarding-data.ts").includes("billingCycle"));
  assert.ok(read("src/components/admin/pages/OnboardingDetail.tsx").includes("billingCycle"));
});

check("the operator can edit yearly prices on /admin/plans", () => {
  assert.ok(read("src/components/admin/pages/PlansManager.tsx").includes("yearlyPriceCents"));
});

// ──────────────────────────── summary ────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
