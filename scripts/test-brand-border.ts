// Brand border customization — RED/GREEN gate (npm run test:brand-border).
//
// Guards the pure core behind the branding editors' "Border" controls:
// src/lib/storefront/brand-border.ts. The stored values live on
// branding.config (borderColor: hex string, borderWidth: px number) and are
// untrusted JSON, so the normalizer must fail closed: anything invalid must
// resolve to "no override" so the theme default (--brand-border from
// storefront.css / the preset palette) keeps applying.
//
// Journeys covered:
//  1. Owner sets a border color + width → both --brand-* vars are emitted.
//  2. Tenant never touched the setting → no vars emitted (pre-feature look).
//  3. Operator sets hpglow's border to black → #000000 round-trips.

import {
  normalizeBrandBorder,
  brandBorderVars,
  borderWidthLabel,
  BRAND_BORDER_WIDTH_PRESETS,
  MAX_BORDER_WIDTH,
} from "../src/lib/storefront/brand-border";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ""}`);
  }
}

console.log("normalizeBrandBorder — untrusted config in, safe values out");
{
  // Journey 2: unset → no overrides at all.
  const empty = normalizeBrandBorder({});
  check("unset config → {}", empty.borderColor === undefined && empty.borderWidth === undefined, empty);

  // Journey 1: valid hex + width survive.
  const ok = normalizeBrandBorder({ borderColor: "#1A2B3C", borderWidth: 2 });
  check("valid 6-digit hex kept", ok.borderColor === "#1A2B3C", ok);
  check("valid width kept", ok.borderWidth === 2, ok);

  // Journey 3: black must round-trip (the hpglow ask).
  const black = normalizeBrandBorder({ borderColor: "#000000" });
  check("black #000000 kept", black.borderColor === "#000000", black);

  // 3-digit hex is a legitimate hand-typed value.
  const short = normalizeBrandBorder({ borderColor: "#000" });
  check("3-digit hex kept", short.borderColor === "#000", short);

  // Fail closed on anything that isn't a hex color (CSS injection surface —
  // these values land in inline style properties).
  for (const bad of ["red", "javascript:alert(1)", "#000;} .x{", "#12345", "", 42, null, { hex: "#000" }]) {
    const out = normalizeBrandBorder({ borderColor: bad });
    check(`invalid color dropped: ${JSON.stringify(bad)}`, out.borderColor === undefined, out);
  }

  // Width: finite number, clamped to [1, MAX_BORDER_WIDTH]; junk → unset.
  check("width clamps high", normalizeBrandBorder({ borderWidth: 99 }).borderWidth === MAX_BORDER_WIDTH);
  check("width 0 → unset (default)", normalizeBrandBorder({ borderWidth: 0 }).borderWidth === undefined);
  check("negative width → unset", normalizeBrandBorder({ borderWidth: -3 }).borderWidth === undefined);
  check("NaN width → unset", normalizeBrandBorder({ borderWidth: NaN }).borderWidth === undefined);
  check('string width "2" → unset (strict)', normalizeBrandBorder({ borderWidth: "2" }).borderWidth === undefined);
  check("fractional width rounds", normalizeBrandBorder({ borderWidth: 2.6 }).borderWidth === 3);
}

console.log("brandBorderVars — CSS custom properties for applyBrandStyle");
{
  // Journey 2: no config → no vars → stylesheet defaults win.
  check("unset → no vars", Object.keys(brandBorderVars({})).length === 0, brandBorderVars({}));

  // Journey 1: both set → both vars.
  const both = brandBorderVars({ borderColor: "#000000", borderWidth: 2 });
  check("color var emitted", both["--brand-border"] === "#000000", both);
  check("width var emitted in px", both["--brand-border-width"] === "2px", both);

  // Color-only (the hpglow case): width var must be absent so the 1px default applies.
  const colorOnly = brandBorderVars({ borderColor: "#000000" });
  check("color-only → no width var", colorOnly["--brand-border"] === "#000000" && !("--brand-border-width" in colorOnly), colorOnly);

  // Invalid values emit nothing (never emit an unvalidated string into style).
  const junk = brandBorderVars({ borderColor: "});alert(1);(", borderWidth: "wide" });
  check("junk → no vars", Object.keys(junk).length === 0, junk);
}

console.log("width presets — editor select round-trip");
{
  check("default preset stores undefined", Object.values(BRAND_BORDER_WIDTH_PRESETS).includes(undefined));
  const labels = Object.keys(BRAND_BORDER_WIDTH_PRESETS);
  check("at least 3 choices", labels.length >= 3, labels);
  for (const [label, value] of Object.entries(BRAND_BORDER_WIDTH_PRESETS)) {
    check(`label round-trips: ${label}`, borderWidthLabel(value) === label);
  }
  check("unknown width falls back to default label", borderWidthLabel(97 as number) === Object.keys(BRAND_BORDER_WIDTH_PRESETS)[0]);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll brand-border checks passed");
