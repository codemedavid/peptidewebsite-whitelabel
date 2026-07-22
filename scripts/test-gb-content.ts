// Self-contained test gate for the editable Group Buy storefront copy
// (src/lib/storefront/gb-content.ts): the owner-editable "How group buys work"
// section (title + steps) and the live-round terms line, shared by the two-ways
// home and the dedicated group-buy page. Pure — no DB, no React.
//
//   npm run test:gb-content
//
// Covers: defaults for missing/garbage config, per-field fallback, trimming,
// empty-step dropping, caps (step count + lengths), {eta} placeholder rendering
// with and without a delivery ETA, and immutability of inputs/defaults.

import {
  GB_CONTENT_DEFAULTS,
  GB_CONTENT_LIMITS,
  normalizeGroupBuyContent,
  renderGbCopy,
  type GroupBuyContent,
} from "../src/lib/storefront/gb-content";

let failures = 0;
let checks = 0;

function ok(name: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq<T>(name: string, actual: T, expected: T) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── Defaults ─────────────────────────────────────────────────────────────────
console.log("defaults");

// The defaults ARE today's hardcoded storefront copy — regression anchor.
eq("default title matches current storefront copy", GB_CONTENT_DEFAULTS.howTitle, "How group buys work");
eq("default steps are today's 4 steps", GB_CONTENT_DEFAULTS.steps, [
  "Browse what's on hand for instant shipping, or join the live group buy for a lower price.",
  "Pay to lock your slot at the group price while the round is open.",
  "When the round closes, we place one bulk order with the supplier.",
  "Your order ships {eta}, COA posted before shipping.",
]);
eq("default terms match the live banner line", GB_CONTENT_DEFAULTS.terms,
  "Pay now to lock your slot. Ships {eta}. COA posted before shipping.");

// ── Normalization: missing / garbage input ──────────────────────────────────
console.log("normalize: missing / garbage");

eq("undefined → defaults", normalizeGroupBuyContent(undefined), GB_CONTENT_DEFAULTS);
eq("null → defaults", normalizeGroupBuyContent(null), GB_CONTENT_DEFAULTS);
eq("string → defaults", normalizeGroupBuyContent("nope"), GB_CONTENT_DEFAULTS);
eq("number → defaults", normalizeGroupBuyContent(42), GB_CONTENT_DEFAULTS);
eq("array → defaults", normalizeGroupBuyContent([1, 2]), GB_CONTENT_DEFAULTS);
eq("empty object → defaults", normalizeGroupBuyContent({}), GB_CONTENT_DEFAULTS);

// ── Normalization: per-field fallback ───────────────────────────────────────
console.log("normalize: per-field fallback");

{
  const r = normalizeGroupBuyContent({ terms: "Custom terms." });
  eq("custom terms kept", r.terms, "Custom terms.");
  eq("missing steps fall back to defaults", r.steps, GB_CONTENT_DEFAULTS.steps);
  eq("missing title falls back to default", r.howTitle, GB_CONTENT_DEFAULTS.howTitle);
}
{
  const r = normalizeGroupBuyContent({ howTitle: "   ", steps: [], terms: "" });
  eq("blank title → default", r.howTitle, GB_CONTENT_DEFAULTS.howTitle);
  eq("empty steps → default steps", r.steps, GB_CONTENT_DEFAULTS.steps);
  eq("empty terms → default terms", r.terms, GB_CONTENT_DEFAULTS.terms);
}

// ── Normalization: trimming + dropping ──────────────────────────────────────
console.log("normalize: trimming + dropping");

{
  const r = normalizeGroupBuyContent({
    howTitle: "  Paano ito gumagana  ",
    steps: ["  Step one  ", "", "   ", "Step two", 42, null, "Step three"],
    terms: "  Lock it in.  ",
  });
  eq("title trimmed", r.howTitle, "Paano ito gumagana");
  eq("steps trimmed, empties and non-strings dropped", r.steps, ["Step one", "Step two", "Step three"]);
  eq("terms trimmed", r.terms, "Lock it in.");
}

// ── Normalization: caps ─────────────────────────────────────────────────────
console.log("normalize: caps");

{
  const many = Array.from({ length: 12 }, (_, i) => `Step ${i + 1}`);
  const r = normalizeGroupBuyContent({ steps: many });
  eq("step count capped", r.steps.length, GB_CONTENT_LIMITS.maxSteps);
  eq("keeps the first steps in order", r.steps[0], "Step 1");
}
{
  const long = "x".repeat(1000);
  const r = normalizeGroupBuyContent({ howTitle: long, steps: [long], terms: long });
  ok("title length capped", r.howTitle.length <= GB_CONTENT_LIMITS.maxTitleLen,
    `got ${r.howTitle.length}`);
  ok("step length capped", r.steps[0].length <= GB_CONTENT_LIMITS.maxTextLen,
    `got ${r.steps[0].length}`);
  ok("terms length capped", r.terms.length <= GB_CONTENT_LIMITS.maxTextLen,
    `got ${r.terms.length}`);
}

// ── {eta} rendering ─────────────────────────────────────────────────────────
console.log("renderGbCopy");

eq("substitutes the delivery ETA",
  renderGbCopy("Ships {eta}.", "3–4 weeks after the group buy closes"),
  "Ships 3–4 weeks after the group buy closes.");
eq("empty ETA falls back",
  renderGbCopy("Ships {eta}.", ""),
  "Ships after the round closes.");
eq("replaces every occurrence",
  renderGbCopy("{eta} then {eta}", "soon"),
  "soon then soon");
eq("text without placeholder is untouched",
  renderGbCopy("No placeholder here.", "soon"),
  "No placeholder here.");
eq("default terms render into the exact K Glow banner line",
  renderGbCopy(GB_CONTENT_DEFAULTS.terms, "3–4 weeks after the group buy closes"),
  "Pay now to lock your slot. Ships 3–4 weeks after the group buy closes. COA posted before shipping.");

// ── Immutability ────────────────────────────────────────────────────────────
console.log("immutability");

{
  const input = { steps: ["  A  ", ""], terms: " t " };
  const snapshot = JSON.stringify(input);
  normalizeGroupBuyContent(input);
  eq("input is never mutated", JSON.stringify(input), snapshot);
}
{
  const a: GroupBuyContent = normalizeGroupBuyContent(undefined);
  a.steps.push("mutated");
  (a as { howTitle: string }).howTitle = "mutated";
  const b = normalizeGroupBuyContent(undefined);
  eq("defaults survive result mutation", b, GB_CONTENT_DEFAULTS);
  eq("exported defaults untouched", GB_CONTENT_DEFAULTS.howTitle, "How group buys work");
}

// ── Result ──────────────────────────────────────────────────────────────────
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`FAIL: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("PASS: gb-content");
