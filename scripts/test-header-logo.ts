// Configurable header logo — RED/GREEN gate (npm run test:header-logo).
//
// The storefront header always rendered a logo mark in the upper-left: either
// brand.logoUrl as an <img>, or a letter-tile fallback when logoUrl was empty.
// There was NO way to show no logo at all. We add a reusable `headerShowLogo`
// toggle so any tenant (Luminara first) can hide the logo mark entirely while
// keeping the rest of the header (brand text, nav, cart, CTA).
//
// Contract:
//   - Brand.headerShowLogo?: boolean — default-on (checked as !== false), so
//     every existing tenant is unaffected. Only an explicit `false` hides it.
//   - Header.tsx gates the logo mark block (img + letter-tile fallback) on
//     brand.headerShowLogo !== false. The brand-text wordmark stays governed by
//     headerShowBrand, independent of this toggle.
//   - The branding editor (BrandTweaksForm) exposes it as a header toggle.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ""}`);
  }
}
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

console.log("Type — Brand.headerShowLogo exists and is optional boolean");
{
  const types = read("src/storefront/types.ts");
  check("headerShowLogo declared on Brand", /headerShowLogo\??:\s*boolean/.test(types), types.match(/headerShowLogo[^;]*/)?.[0]);
}

console.log("Header — logo mark is gated on headerShowLogo !== false");
{
  const header = read("src/storefront/components/Header.tsx");
  check("Header reads brand.headerShowLogo", /brand\.headerShowLogo/.test(header));
  check(
    "gate uses default-on !== false semantics",
    /brand\.headerShowLogo\s*!==\s*false/.test(header),
    header.match(/brand\.headerShowLogo[^\n]*/)?.[0],
  );
  // The logo <img> and the letter-tile fallback must both sit behind the gate:
  // find the gate and ensure the logo-mark markup follows within the same block.
  const gateIdx = header.search(/brand\.headerShowLogo\s*!==\s*false/);
  const after = gateIdx >= 0 ? header.slice(gateIdx, gateIdx + 400) : "";
  check("logo img sits behind the gate", /brand\.logoUrl/.test(after), after.slice(0, 80));
  check("letter-tile fallback sits behind the gate", /site-header__logo-mark/.test(after));
}

console.log("Admin — branding editor exposes the toggle");
{
  const form = read("src/storefront/tweaks/BrandTweaksForm.tsx");
  check("BrandTweaksForm has a headerShowLogo toggle", /setTweak\(\s*["']headerShowLogo["']/.test(form));
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll header-logo checks passed");
