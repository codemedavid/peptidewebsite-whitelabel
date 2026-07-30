/**
 * Tests for the Order Ratio Control engine — the peptide ↔ bacteriostatic-water
 * ratio rule that rides the existing Group Buy Rules engine
 * (src/lib/storefront/group-buy-rules.ts) plus the shared product classifier
 * (src/lib/storefront/product-class.ts).
 *
 * The rule runs in one of two DIRECTIONS:
 *   • floor (default) — "every peptide needs at least N bac water". Three modes:
 *     strict (blocks), warn (soft), auto_add (the cart injects the shortfall; a
 *     residual gap still blocks like strict).
 *   • cap — "bac water must not exceed N per peptide vial". Peptide-only carts
 *     are always fine (nothing to cap); a cart with bac water and no peptides is
 *     blocked, since 0 peptides allow 0 water. auto_add never injects here.
 *
 * Classification prefers the admin's per-product tag (metadata.productClass)
 * and falls back to the legacy name regex.
 *
 *   npm run test:gb-ratio
 */

import assert from "node:assert";

import { classifyProductClass, type ProductClass } from "../src/lib/storefront/product-class";
import {
  DEFAULT_GROUP_BUY_RULES,
  normalizeGroupBuyRules,
  groupBuyViolations,
  ratioCounts,
  requiredBacWater,
  allowedBacWater,
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

/** The same rules object with the ratio running as a CAP instead of a floor. */
function capRulesWith(over: Partial<GroupBuyRules["ratio"]>): GroupBuyRules {
  return rulesWith({ direction: "cap", ...over });
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

  await check("DEFAULT rules ship the ratio block OFF, direction floor", () => {
    assert.equal(DEFAULT_GROUP_BUY_RULES.ratio.enabled, false);
    assert.equal(DEFAULT_GROUP_BUY_RULES.ratio.mode, "strict");
    assert.equal(DEFAULT_GROUP_BUY_RULES.ratio.bacWaterPerPeptide, 1);
    assert.equal(DEFAULT_GROUP_BUY_RULES.ratio.defaultBacWaterProductId, null);
    // Floor is the historical behavior, so a stored config that predates the
    // direction switch keeps meaning exactly what it meant before.
    assert.equal(DEFAULT_GROUP_BUY_RULES.ratio.direction, "floor");
  });

  await check("normalize: absent or junk direction → floor, 'cap' is kept", () => {
    const absent = normalizeGroupBuyRules({ enabled: true, ratio: { enabled: true } });
    assert.equal(absent.ratio.direction, "floor", "absent → floor");
    const junk = normalizeGroupBuyRules({ enabled: true, ratio: { enabled: true, direction: "sideways" } });
    assert.equal(junk.ratio.direction, "floor", "unknown → floor");
    const cap = normalizeGroupBuyRules({ enabled: true, ratio: { enabled: true, direction: "cap" } });
    assert.equal(cap.ratio.direction, "cap");
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

  await check("allowedBacWater = peptide × ratio (the cap's ceiling)", () => {
    assert.equal(allowedBacWater(capRulesWith({ bacWaterPerPeptide: 1 }), 3), 3);
    assert.equal(allowedBacWater(capRulesWith({ bacWaterPerPeptide: 2 }), 3), 6);
    // No peptides → no water allowed at all.
    assert.equal(allowedBacWater(capRulesWith({ bacWaterPerPeptide: 1 }), 0), 0);
    // Negative/garbage quantities can't widen the ceiling.
    assert.equal(allowedBacWater(capRulesWith({ bacWaterPerPeptide: 1 }), -5), 0);
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

  console.log("\nOrder Ratio Control — violation (cap)\n");

  await check("CAP: a peptide-only cart is never nagged", () => {
    // The whole point of the cap: buying peptides alone is legitimate, so no
    // message at any quantity.
    assert.equal(ratioViolation(capRulesWith({}), [line("Semaglutide", 1, "peptide")]), null);
    assert.equal(ratioViolation(capRulesWith({}), [line("Semaglutide", 10, "peptide")]), null);
    // Peptides plus unrelated accessories still fine.
    assert.equal(
      ratioViolation(capRulesWith({}), [line("Semaglutide", 4, "peptide"), line("Syringes", 9)]),
      null,
    );
  });

  await check("CAP: bac water up to the peptide count is allowed", () => {
    assert.equal(
      ratioViolation(capRulesWith({}), [line("Semaglutide", 3, "peptide"), line("Bac Water", 1)]),
      null,
      "under the cap",
    );
    assert.equal(
      ratioViolation(capRulesWith({}), [line("Semaglutide", 3, "peptide"), line("Bac Water", 3)]),
      null,
      "exactly at the cap",
    );
  });

  await check("CAP: more bac water than peptide vials → blocking violation", () => {
    const v = ratioViolation(capRulesWith({ mode: "strict" }), [
      line("Semaglutide", 3, "peptide"),
      line("Bac Water", 4),
    ]);
    assert.ok(v, "4 water vs 3 peptide → violation");
    assert.equal(v!.blocking, true);
    assert.match(v!.message, /water/i);
  });

  await check("CAP: 2:1 cap allows two water per peptide, blocks the third", () => {
    const rules = capRulesWith({ bacWaterPerPeptide: 2 });
    assert.equal(
      ratioViolation(rules, [line("Semaglutide", 2, "peptide"), line("Bac Water", 4)]),
      null,
      "4 ≤ 2×2 allowed",
    );
    assert.ok(
      ratioViolation(rules, [line("Semaglutide", 2, "peptide"), line("Bac Water", 5)]),
      "5 > 4 allowed → violation",
    );
  });

  await check("CAP: bac water with no peptide is blocked", () => {
    const v = ratioViolation(capRulesWith({ mode: "strict" }), [line("Bac Water", 2)]);
    assert.ok(v, "0 peptides allow 0 bac water");
    assert.equal(v!.blocking, true);
    assert.match(v!.message, /add a peptide/i);
  });

  await check("CAP: an empty cart produces no violation", () => {
    assert.equal(ratioViolation(capRulesWith({}), []), null);
    assert.equal(ratioViolation(capRulesWith({}), [line("Syringes", 3)]), null);
  });

  await check("CAP + WARN: surplus violation is non-blocking", () => {
    const v = ratioViolation(capRulesWith({ mode: "warn" }), [
      line("Semaglutide", 1, "peptide"),
      line("Bac Water", 3),
    ]);
    assert.ok(v);
    assert.equal(v!.blocking, false, "warn mode never blocks checkout");
  });

  await check("CAP + AUTO_ADD: blocks like strict and never injects", () => {
    const lines = [line("Semaglutide", 1, "peptide"), line("Bac Water", 3)];
    const v = ratioViolation(capRulesWith({ mode: "auto_add" }), lines);
    assert.ok(v, "auto_add can't 'add' its way out of a surplus");
    assert.equal(v!.blocking, true);
    // The cart's reconcile effect must stay out of cap carts entirely.
    assert.equal(autoAddPlan(capRulesWith({ mode: "auto_add" }), lines).shortfall, 0);
    assert.equal(
      autoAddPlan(capRulesWith({ mode: "auto_add" }), [line("Semaglutide", 3, "peptide")]).shortfall,
      0,
      "a peptide-only cap cart must never be topped up with water",
    );
  });

  await check("CAP: the message interpolates the cap tokens", () => {
    const v = ratioViolation(
      capRulesWith({
        mode: "strict",
        message: "Max {ratio} per vial — {peptide} vials allow {allowed}, you have {bacWater}. Remove {surplus}.",
      }),
      [line("Semaglutide", 2, "peptide"), line("Bac Water", 5)],
    );
    assert.equal(v!.message, "Max 1 per vial — 2 vials allow 2, you have 5. Remove 3.");
  });

  await check("CAP: the built-in default message names the numbers", () => {
    const v = ratioViolation(capRulesWith({ mode: "strict" }), [
      line("Semaglutide", 2, "peptide"),
      line("Bac Water", 5),
    ]);
    assert.ok(v);
    // Whatever the wording, it must not tell the customer to ADD water.
    assert.doesNotMatch(v!.message, /\badd\b/i, "cap copy must never say 'add'");
    assert.match(v!.message, /2/, "mentions the 2 allowed");
    assert.match(v!.message, /5/, "mentions the 5 in the cart");
  });

  await check("CAP: classification tag decides what counts as water", () => {
    // Tagged bacWater despite an innocuous name → counted as water and capped.
    const v = ratioViolation(capRulesWith({}), [
      line("Semaglutide", 1, "peptide"),
      line("Clear Fluid", 3, "bacWater"),
    ]);
    assert.ok(v, "3 tagged-bacWater vs 1 peptide → violation");
  });

  await check("CAP supersedes the legacy maxPerPeptide ceiling (no double message)", () => {
    // A tenant with BOTH the old ceiling and the new cap configured must see one
    // message, not two near-identical ones.
    const rules = normalizeGroupBuyRules({
      enabled: true,
      bacWater: { restrictionsDisabled: false, allowUnlimited: false, maxPerPeptide: 1 },
      ratio: { enabled: true, direction: "cap", mode: "strict", bacWaterPerPeptide: 1 },
    });
    const legacy = groupBuyViolations(rules, [
      { name: "Semaglutide", qty: 1 },
      { name: "Bac Water", qty: 3 },
    ]);
    assert.deepEqual(legacy, [], "the legacy ceiling stays quiet while the cap owns the rule");
    // …and the cap itself still fires.
    assert.ok(
      ratioViolation(rules, [line("Semaglutide", 1, "peptide"), line("Bac Water", 3)]),
      "the cap is the single source of the message",
    );
  });

  await check("the legacy maxPerPeptide ceiling still works on its own", () => {
    const rules = normalizeGroupBuyRules({
      enabled: true,
      bacWater: { restrictionsDisabled: false, allowUnlimited: false, maxPerPeptide: 1 },
    });
    const errs = groupBuyViolations(rules, [
      { name: "Semaglutide", qty: 1 },
      { name: "Bac Water", qty: 3 },
    ]);
    assert.equal(errs.length, 1, "ratio block off → the old ceiling is unchanged");
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
