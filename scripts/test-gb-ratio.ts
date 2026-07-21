/**
 * Tests for the Order Ratio Control engine — the peptide ↔ bacteriostatic-water
 * ratio floor that rides the existing Group Buy Rules engine
 * (src/lib/storefront/group-buy-rules.ts) plus the shared product classifier
 * (src/lib/storefront/product-class.ts).
 *
 * Grounding: unlike the existing `bacWater.maxPerPeptide` CEILING, this is a
 * FLOOR — "every peptide needs at least N bac water". Three modes: strict
 * (blocks), warn (soft), auto_add (the cart injects the shortfall; a residual
 * gap still blocks like strict). Classification prefers the admin's per-product
 * tag (metadata.productClass) and falls back to the legacy name regex.
 *
 *   npm run test:gb-ratio
 */

import assert from "node:assert";

import { classifyProductClass, type ProductClass } from "../src/lib/storefront/product-class";
import {
  DEFAULT_GROUP_BUY_RULES,
  normalizeGroupBuyRules,
  ratioCounts,
  requiredBacWater,
  ratioViolation,
  autoAddPlan,
  type GroupBuyRules,
  type RatioLine,
} from "../src/lib/storefront/group-buy-rules";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((e) => {
      failed++;
      console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
    });
}

/** A rules object with the ratio block turned on at the given mode/ratio. */
function rulesWith(over: Partial<GroupBuyRules["ratio"]>): GroupBuyRules {
  return normalizeGroupBuyRules({
    enabled: true,
    ratio: {
      enabled: true,
      mode: "strict",
      bacWaterPerPeptide: 1,
      defaultBacWaterProductId: "bac1",
      message: "",
      ...over,
    },
  });
}

const line = (name: string, qty: number, productClass?: ProductClass): RatioLine => ({
  name,
  qty,
  ...(productClass ? { productClass } : {}),
});

async function main() {
  console.log("\nOrder Ratio Control — classifier\n");

  await check("explicit tag wins over the name regex", () => {
    // A product literally named "Bac Water" but tagged peptide → peptide.
    assert.equal(classifyProductClass({ name: "Bac Water", productClass: "peptide" }), "peptide");
    // A generic name tagged bacWater → bacWater.
    assert.equal(classifyProductClass({ name: "Sterile Solution", productClass: "bacWater" }), "bacWater");
    // Explicit "other" is respected even for a peptide-looking name.
    assert.equal(classifyProductClass({ name: "BPC-157 Peptide", productClass: "other" }), "other");
  });

  await check("falls back to the name regex when untagged", () => {
    assert.equal(classifyProductClass({ name: "Bacteriostatic Water 10ml" }), "bacWater");
    assert.equal(classifyProductClass({ name: "BacWater" }), "bacWater");
    assert.equal(classifyProductClass({ name: "Semaglutide Peptide" }), "peptide");
    // Amino sequence is a peptide signal even without the word "peptide".
    assert.equal(classifyProductClass({ name: "GHK-Cu", sequence: "Gly-His-Lys" }), "peptide");
    // Neither → other (e.g. syringes).
    assert.equal(classifyProductClass({ name: "Insulin Syringes 1ml" }), "other");
  });

  console.log("\nOrder Ratio Control — engine defaults & normalize\n");

  await check("DEFAULT rules ship the ratio block OFF", () => {
    assert.equal(DEFAULT_GROUP_BUY_RULES.ratio.enabled, false);
    assert.equal(DEFAULT_GROUP_BUY_RULES.ratio.mode, "strict");
    assert.equal(DEFAULT_GROUP_BUY_RULES.ratio.bacWaterPerPeptide, 1);
    assert.equal(DEFAULT_GROUP_BUY_RULES.ratio.defaultBacWaterProductId, null);
  });

  await check("normalize coerces junk into a well-formed ratio block", () => {
    const r = normalizeGroupBuyRules({
      enabled: true,
      ratio: { enabled: true, mode: "bogus", bacWaterPerPeptide: 0, defaultBacWaterProductId: 42, message: 99 },
    });
    assert.equal(r.ratio.enabled, true);
    assert.equal(r.ratio.mode, "strict", "unknown mode → strict");
    assert.equal(r.ratio.bacWaterPerPeptide, 1, "ratio floors at 1");
    assert.equal(r.ratio.defaultBacWaterProductId, null, "non-string id → null");
    assert.equal(r.ratio.message, "", "non-string message → empty");
  });

  await check("normalize keeps a valid custom ratio & auto_add id", () => {
    const r = normalizeGroupBuyRules({
      enabled: true,
      ratio: { enabled: true, mode: "auto_add", bacWaterPerPeptide: 2, defaultBacWaterProductId: "bac9", message: "Add water!" },
    });
    assert.equal(r.ratio.mode, "auto_add");
    assert.equal(r.ratio.bacWaterPerPeptide, 2);
    assert.equal(r.ratio.defaultBacWaterProductId, "bac9");
    assert.equal(r.ratio.message, "Add water!");
  });

  console.log("\nOrder Ratio Control — counts & required\n");

  await check("ratioCounts sums peptide vs bac water, ignoring 'other'", () => {
    const lines = [line("Semaglutide", 3, "peptide"), line("Bac Water", 1), line("Syringes", 5)];
    const c = ratioCounts(lines);
    assert.equal(c.peptide, 3);
    assert.equal(c.bacWater, 1);
  });

  await check("requiredBacWater = ceil(peptide × ratio)", () => {
    assert.equal(requiredBacWater(rulesWith({ bacWaterPerPeptide: 1 }), 3), 3);
    assert.equal(requiredBacWater(rulesWith({ bacWaterPerPeptide: 2 }), 3), 6);
    assert.equal(requiredBacWater(rulesWith({ bacWaterPerPeptide: 1 }), 0), 0);
  });

  console.log("\nOrder Ratio Control — violation (floor)\n");

  await check("no violation when the engine or ratio block is off", () => {
    const off = normalizeGroupBuyRules({ enabled: false, ratio: { enabled: true, defaultBacWaterProductId: "bac1" } });
    assert.equal(ratioViolation(off, [line("Semaglutide", 2, "peptide")]), null);
    const ratioOff = rulesWith({ enabled: false });
    assert.equal(ratioViolation(ratioOff, [line("Semaglutide", 2, "peptide")]), null);
  });

  await check("no violation when the cart holds no peptides", () => {
    assert.equal(ratioViolation(rulesWith({}), [line("Bac Water", 3), line("Syringes", 1)]), null);
  });

  await check("STRICT: peptides without enough bac water → blocking violation", () => {
    const v = ratioViolation(rulesWith({ mode: "strict" }), [line("Semaglutide", 2, "peptide"), line("Bac Water", 1)]);
    assert.ok(v, "expected a violation");
    assert.equal(v!.blocking, true);
    assert.match(v!.message, /1|water/i);
  });

  await check("STRICT: exactly-met ratio → no violation", () => {
    assert.equal(ratioViolation(rulesWith({ mode: "strict" }), [line("Semaglutide", 2, "peptide"), line("Bac Water", 2)]), null);
    // Over-met is fine too (floor, not ceiling).
    assert.equal(ratioViolation(rulesWith({ mode: "strict" }), [line("Semaglutide", 2, "peptide"), line("Bac Water", 5)]), null);
  });

  await check("2:1 ratio needs two bac water per peptide", () => {
    const rules = rulesWith({ bacWaterPerPeptide: 2 });
    assert.ok(ratioViolation(rules, [line("Semaglutide", 2, "peptide"), line("Bac Water", 3)]), "3 < 4 required → violation");
    assert.equal(ratioViolation(rules, [line("Semaglutide", 2, "peptide"), line("Bac Water", 4)]), null);
  });

  await check("WARN: violation is non-blocking", () => {
    const v = ratioViolation(rulesWith({ mode: "warn" }), [line("Semaglutide", 3, "peptide"), line("Bac Water", 0)]);
    assert.ok(v);
    assert.equal(v!.blocking, false, "warn mode never blocks checkout");
  });

  await check("AUTO_ADD: a residual shortfall (e.g. bac water sold out) still blocks", () => {
    const v = ratioViolation(rulesWith({ mode: "auto_add" }), [line("Semaglutide", 3, "peptide"), line("Bac Water", 1)]);
    assert.ok(v);
    assert.equal(v!.blocking, true, "auto_add is not a bypass — a residual gap blocks like strict");
  });

  await check("custom message interpolates {ratio} and {shortfall}", () => {
    const v = ratioViolation(
      rulesWith({ mode: "strict", bacWaterPerPeptide: 2, message: "Need {ratio}:1 — add {shortfall} more water." }),
      [line("Semaglutide", 2, "peptide"), line("Bac Water", 1)],
    );
    assert.equal(v!.message, "Need 2:1 — add 3 more water.");
  });

  await check("classification tag flows through the engine", () => {
    // A product NAMED like bac water but TAGGED peptide counts as a peptide,
    // so the cart needs bac water for it.
    const lines = [line("Mystery Vial", 2, "peptide"), line("Clear Fluid", 0, "bacWater")];
    const v = ratioViolation(rulesWith({ mode: "strict" }), lines);
    assert.ok(v, "2 tagged-peptide vials with 0 bac water → violation");
  });

  console.log("\nOrder Ratio Control — auto-add plan\n");

  await check("autoAddPlan reports the shortfall only in auto_add mode", () => {
    const strict = autoAddPlan(rulesWith({ mode: "strict" }), [line("Semaglutide", 3, "peptide"), line("Bac Water", 1)]);
    assert.equal(strict.shortfall, 0, "strict mode never auto-adds");
    const auto = autoAddPlan(rulesWith({ mode: "auto_add" }), [line("Semaglutide", 3, "peptide"), line("Bac Water", 1)]);
    assert.equal(auto.shortfall, 2, "needs 3, has 1 → add 2");
  });

  await check("autoAddPlan is zero when the ratio is already met", () => {
    const auto = autoAddPlan(rulesWith({ mode: "auto_add" }), [line("Semaglutide", 2, "peptide"), line("Bac Water", 2)]);
    assert.equal(auto.shortfall, 0);
  });

  await check("autoAddPlan is zero with no peptides", () => {
    const auto = autoAddPlan(rulesWith({ mode: "auto_add" }), [line("Bac Water", 5)]);
    assert.equal(auto.shortfall, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
