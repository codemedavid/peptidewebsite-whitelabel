/**
 * System fonts as store fonts (thepeppylab asked for Times New Roman, 2026-10-17).
 *
 * Times New Roman is not on Google Fonts, and css2 fails the WHOLE stylesheet
 * request when one family is unknown — so naming it raw would also break every
 * other font on the page. It is not installed on Android either. The rule:
 *   - the loader fetches its metric-compatible web twin (Tinos) instead;
 *   - the CSS stack names the real font first, then the twin, then a generic.
 * Any ordinary Google font is untouched.
 *
 *   npm run test:system-fonts
 */

import assert from "node:assert";
import { fontStack, googleFontsUrl } from "../src/lib/theme/tokens";
import { priceFontVar } from "../src/lib/storefront/price-font";

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

console.log("\nSystem fonts — real font where installed, web twin elsewhere\n");

check("loader asks Google for Tinos, never Times New Roman", () => {
  const url = googleFontsUrl("Times New Roman", "Times New Roman");
  assert.ok(url.includes("family=Tinos"), url);
  assert.ok(!url.includes("Times+New+Roman"), url);
  assert.equal(url.match(/family=Tinos/g)?.length, 1, "twin should be deduped");
});

check("loader leaves ordinary Google fonts alone", () => {
  const url = googleFontsUrl("Playfair Display", "Inter");
  assert.ok(url.includes("family=Playfair+Display"));
  assert.ok(url.includes("family=Inter"));
});

check("stack names the real font first, then its twin, then the generic", () => {
  assert.equal(fontStack("Times New Roman", "Georgia, serif"), `"Times New Roman", "Tinos", Georgia, serif`);
});

check("ordinary font stack is unchanged", () => {
  assert.equal(fontStack("Inter", "system-ui, sans-serif"), `"Inter", system-ui, sans-serif`);
});

check("pinned price font uses the same stack", () => {
  assert.equal(priceFontVar({ priceFont: "Times New Roman" }), `"Times New Roman", "Tinos", system-ui, sans-serif`);
  assert.equal(priceFontVar({ priceFont: "Inter" }), `"Inter", system-ui, sans-serif`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
