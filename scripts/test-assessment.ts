/**
 * Self-contained test for the storefront Assessment core (no DB, no network).
 *
 * The assessment is a short customer quiz (The Peppy Lab's "Peptide
 * Compatibility Assessment"): consent → about you → medical history → goals →
 * experience & preferences, then a recommendation built from the store's own
 * catalog. Submissions carry health data, so validation is strict and
 * fail-closed; the owner edits the goal → product keyword map.
 *
 *   npm run test:assessment
 */

import assert from "node:assert";

import {
  DEFAULT_ASSESSMENT,
  NONE_OF_THE_ABOVE,
  normalizeAssessmentConfig,
  recommendProducts,
  validateAssessmentSubmission,
  type AssessmentConfig,
} from "../src/lib/storefront/assessment";

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

console.log("\nAssessment\n");

// ──────────────────────────── config ────────────────────────────────────────
check("defaults: the seven goals of the original assessment", () => {
  assert.deepStrictEqual(
    DEFAULT_ASSESSMENT.goals.map((g) => g.label),
    ["Weight Loss", "Muscle Gain", "Anti-Aging/Longevity", "Energy & Focus", "Better Sleep", "Injury Recovery", "Skin Health"],
  );
  assert.ok(DEFAULT_ASSESSMENT.goals[0].keywords.includes("Tirzepatide"));
});

check("config: absent/junk config normalizes to the defaults", () => {
  assert.deepStrictEqual(normalizeAssessmentConfig(undefined), DEFAULT_ASSESSMENT);
  assert.deepStrictEqual(normalizeAssessmentConfig("nope"), DEFAULT_ASSESSMENT);
});

check("config: owner goals are cleaned — blank labels dropped, keywords trimmed + deduped", () => {
  const c = normalizeAssessmentConfig({
    goals: [
      { label: "  Glow  ", keywords: [" GHK-Cu ", "ghk-cu", "", 7] },
      { label: "   ", keywords: ["x"] },
    ],
  });
  assert.deepStrictEqual(c.goals, [{ id: "glow", label: "Glow", keywords: ["GHK-Cu"] }]);
});

check("config: an owner who empties every goal falls back to the defaults", () => {
  const c = normalizeAssessmentConfig({ goals: [] });
  assert.deepStrictEqual(c.goals, DEFAULT_ASSESSMENT.goals);
});

check("config: copy fields are capped and enabled defaults on", () => {
  const c = normalizeAssessmentConfig({ title: "t".repeat(400), enabled: "yes" });
  assert.strictEqual(c.title.length, 120);
  assert.strictEqual(c.enabled, true);
  assert.strictEqual(normalizeAssessmentConfig({ enabled: false }).enabled, false);
});

// ──────────────────────────── submission ────────────────────────────────────
const VALID = {
  fullName: "Jane Doe",
  email: "jane@example.com",
  ageRange: "26-35",
  location: "Makati, Metro Manila",
  conditions: [NONE_OF_THE_ABOVE],
  goals: ["Weight Loss", "Skin Health"],
  experience: "beginner",
  frequency: "Weekly",
  consent: true,
};

check("submission: a complete, consented answer set is accepted", () => {
  const r = validateAssessmentSubmission(VALID, DEFAULT_ASSESSMENT);
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.strictEqual(r.value.email, "jane@example.com");
  assert.deepStrictEqual(r.value.goals, ["Weight Loss", "Skin Health"]);
});

check("submission: no consent, no submission", () => {
  const r = validateAssessmentSubmission({ ...VALID, consent: false }, DEFAULT_ASSESSMENT);
  assert.ok(!r.ok);
});

check("submission: name, email and age range are required", () => {
  assert.ok(!validateAssessmentSubmission({ ...VALID, fullName: " " }, DEFAULT_ASSESSMENT).ok);
  assert.ok(!validateAssessmentSubmission({ ...VALID, email: "not-an-email" }, DEFAULT_ASSESSMENT).ok);
  assert.ok(!validateAssessmentSubmission({ ...VALID, ageRange: "12-17" }, DEFAULT_ASSESSMENT).ok);
});

check("submission: at least one goal, and only goals the store offers", () => {
  assert.ok(!validateAssessmentSubmission({ ...VALID, goals: [] }, DEFAULT_ASSESSMENT).ok);
  const r = validateAssessmentSubmission({ ...VALID, goals: ["Weight Loss", "Telekinesis"] }, DEFAULT_ASSESSMENT);
  assert.ok(r.ok && r.value.goals.length === 1);
});

check("submission: 'None of the above' is exclusive; unknown conditions are dropped", () => {
  const r = validateAssessmentSubmission(
    { ...VALID, conditions: ["Diabetes", NONE_OF_THE_ABOVE, "Made up"] },
    DEFAULT_ASSESSMENT,
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepStrictEqual(r.value.conditions, ["Diabetes"]);
});

check("submission: experience must be a known level; frequency falls back to No Preference", () => {
  assert.ok(!validateAssessmentSubmission({ ...VALID, experience: "guru" }, DEFAULT_ASSESSMENT).ok);
  const r = validateAssessmentSubmission({ ...VALID, frequency: "Hourly" }, DEFAULT_ASSESSMENT);
  assert.ok(r.ok && r.value.frequency === "No Preference");
});

check("submission: free text is trimmed and capped; location optional", () => {
  const r = validateAssessmentSubmission(
    { ...VALID, fullName: `  ${"n".repeat(300)}  `, location: undefined },
    DEFAULT_ASSESSMENT,
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.strictEqual(r.value.fullName.length, 120);
  assert.strictEqual(r.value.location, "");
});

check("submission: non-object input fails closed", () => {
  assert.ok(!validateAssessmentSubmission(null, DEFAULT_ASSESSMENT).ok);
});

// ──────────────────────────── recommendations ───────────────────────────────
const CATALOG = [
  { id: "1", name: "Tirzepatide 15mg", description: "Purpose: Weight loss", available: true },
  { id: "2", name: "Retatrutide 10mg", description: "Purpose: Fat loss", available: true },
  { id: "3", name: "GHKCU 100mg", description: "Purpose: Skin repair & anti-aging", available: true },
  { id: "4", name: "GHK-Cu 100mg + KPV 10mg", description: "Skin and recovery blend", available: true },
  { id: "5", name: "NAD 500mg", description: "Purpose: Energy & cell repair", available: true },
  { id: "6", name: "Tirzepatide 30mg", description: "Purpose: Weight loss", available: false },
  { id: "7", name: "Bacteriostatic water", description: "Mixing", available: true },
  { id: "8", name: "Glow Serum", description: "Contains GHK-Cu for radiance", available: true },
];

const ids = (list: { id: string }[]) => list.map((p) => p.id);

check("recommend: the first goal fills Core, the rest fill Supportive", () => {
  const r = recommendProducts(CATALOG, ["Weight Loss", "Skin Health"], DEFAULT_ASSESSMENT);
  assert.deepStrictEqual(ids(r.primary), ["1", "2"]);
  assert.deepStrictEqual(ids(r.secondary), ["3", "4", "8"]);
});

check("recommend: punctuation-insensitive names — GHK-Cu finds 'GHKCU'", () => {
  const r = recommendProducts(CATALOG, ["Skin Health"], DEFAULT_ASSESSMENT);
  assert.ok(ids(r.primary).includes("3"));
});

check("recommend: name matches rank ahead of description-only matches", () => {
  const r = recommendProducts(CATALOG, ["Skin Health"], DEFAULT_ASSESSMENT);
  assert.deepStrictEqual(ids(r.primary), ["3", "4", "8"]);
});

check("recommend: unavailable products are never recommended", () => {
  const r = recommendProducts(CATALOG, ["Weight Loss"], DEFAULT_ASSESSMENT);
  assert.ok(!ids(r.primary).includes("6"));
});

check("recommend: a product is never listed twice across sections", () => {
  const r = recommendProducts(CATALOG, ["Anti-Aging/Longevity", "Energy & Focus", "Skin Health"], DEFAULT_ASSESSMENT);
  const all = [...ids(r.primary), ...ids(r.secondary)];
  assert.strictEqual(new Set(all).size, all.length);
});

check("recommend: at most three per section", () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, name: `Tirzepatide ${i}`, description: "", available: true }));
  const r = recommendProducts(many, ["Weight Loss"], DEFAULT_ASSESSMENT);
  assert.strictEqual(r.primary.length, 3);
});

check("recommend: short keywords match whole words only in descriptions", () => {
  const custom: AssessmentConfig = normalizeAssessmentConfig({ goals: [{ label: "Energy", keywords: ["NAD"] }] });
  const r = recommendProducts(
    [{ id: "x", name: "Lipo C", description: "Made in Canada", available: true }],
    ["Energy"],
    custom,
  );
  assert.deepStrictEqual(r.primary, []);
});

check("recommend: unknown goals yield empty sections, not a crash", () => {
  const r = recommendProducts(CATALOG, ["Nope"], DEFAULT_ASSESSMENT);
  assert.deepStrictEqual(r, { primary: [], secondary: [] });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
