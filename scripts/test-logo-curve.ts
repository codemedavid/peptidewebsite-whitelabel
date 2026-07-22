/**
 * Self-contained test for the logo curve core — the pure module the branding
 * editor ("Logo curve" select) and the storefront logo surfaces (header, hero
 * logo card, footer) depend on:
 *
 *   - src/lib/storefront/logo-curve.ts
 *       logoCurveCss()       — coerces the untrusted stored logoCurve value into
 *                              a CSS border-radius (percent), or undefined so the
 *                              stylesheet default applies
 *       LOGO_CURVE_PRESETS   — the friendly preset menu (Square/Soft/Rounded/Circle)
 *       logoCurveLabel()     — stored value → preset label (collapsed-select display)
 *
 * Runs the REAL module (no DB, no Next runtime, no browser):
 *
 *   npm run test:logo-curve
 */

import assert from "node:assert";

import { LOGO_CURVE_PRESETS, logoCurveCss, logoCurveLabel } from "../src/lib/storefront/logo-curve";

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
  }
}

// ──────────────────────────── logoCurveCss ───────────────────────────────────
console.log("logoCurveCss");
check("unset (undefined) → undefined so CSS defaults apply", () => {
  assert.equal(logoCurveCss(undefined), undefined);
});
check("0 (Square) → undefined — same as the pre-feature look", () => {
  assert.equal(logoCurveCss(0), undefined);
});
check("12 → '12%'", () => {
  assert.equal(logoCurveCss(12), "12%");
});
check("50 (Circle) → '50%'", () => {
  assert.equal(logoCurveCss(50), "50%");
});
check("values above 50 clamp to '50%'", () => {
  assert.equal(logoCurveCss(120), "50%");
});
check("negative values → undefined", () => {
  assert.equal(logoCurveCss(-8), undefined);
});
check("NaN → undefined", () => {
  assert.equal(logoCurveCss(Number.NaN), undefined);
});
check("non-number garbage from stored config → undefined", () => {
  assert.equal(logoCurveCss("circle" as unknown as number), undefined);
  assert.equal(logoCurveCss(null as unknown as number), undefined);
  assert.equal(logoCurveCss({} as unknown as number), undefined);
});
check("fractional values are kept (not rounded away)", () => {
  assert.equal(logoCurveCss(12.5), "12.5%");
});

// ──────────────────────────── LOGO_CURVE_PRESETS ─────────────────────────────
console.log("LOGO_CURVE_PRESETS");
check("Square preset stores undefined (pruned from branding.config)", () => {
  assert.ok("Square" in LOGO_CURVE_PRESETS);
  assert.equal(LOGO_CURVE_PRESETS["Square"], undefined);
});
check("Circle preset stores 50", () => {
  assert.equal(LOGO_CURVE_PRESETS["Circle"], 50);
});
check("every non-Square preset survives the css round-trip", () => {
  for (const [label, value] of Object.entries(LOGO_CURVE_PRESETS)) {
    if (value === undefined) continue;
    assert.equal(logoCurveCss(value), `${value}%`, `${label} should map to ${value}%`);
  }
});

// ──────────────────────────── logoCurveLabel ─────────────────────────────────
console.log("logoCurveLabel");
check("unset → 'Square'", () => {
  assert.equal(logoCurveLabel(undefined), "Square");
});
check("50 → 'Circle'", () => {
  assert.equal(logoCurveLabel(50), "Circle");
});
check("non-preset stored value falls back to 'Square' instead of crashing", () => {
  assert.equal(logoCurveLabel(33), "Square");
});

// ──────────────────────────── summary ────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
