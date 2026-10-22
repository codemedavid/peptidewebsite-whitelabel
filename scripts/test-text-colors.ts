// Per-part text colours — RED/GREEN gate (npm run test:text-colors).
//
// Brand.textColors is an optional map of website part → hex, set from the
// super admin Brand tab (and the store-admin COA field). It is untrusted
// branding.config JSON that ends up inside a <style> tag, so the helpers must
// fail closed: unknown parts and anything that isn't a plain hex are dropped.
//
// Journeys covered:
//  1. Operator sets product names + prices → CSS rules for exactly those parts.
//  2. Tenant never touched it → no CSS at all (pre-feature look).
//  3. raw-glow-wellness sets the COA page to dark purple → COA selectors emitted.
//  4. Hostile config (CSS injection, unknown keys, non-strings) → nothing emitted.

import {
  TEXT_COLOR_PARTS,
  normalizeTextColors,
  textColorsCss,
  withTextColor,
} from "../src/lib/storefront/text-colors";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ""}`);
  }
}

console.log("registry");
{
  const ids = TEXT_COLOR_PARTS.map((p) => p.id);
  check("part ids are unique", new Set(ids).size === ids.length, ids);
  check("every part has selectors", TEXT_COLOR_PARTS.every((p) => p.selectors.length > 0));
  check("COA part exists", ids.includes("coa"));
}

console.log("normalizeTextColors — untrusted config in, safe map out");
{
  check("unset → {}", Object.keys(normalizeTextColors(undefined)).length === 0);
  check("array → {}", Object.keys(normalizeTextColors(["#000"])).length === 0);

  const ok = normalizeTextColors({ productName: "#5E3591", price: "#abc" });
  check("valid hexes kept", ok.productName === "#5E3591" && ok.price === "#abc", ok);

  const bad = normalizeTextColors({
    productName: "red;}body{display:none",
    price: 42,
    notAPart: "#000000",
    coa: "",
  });
  check("injection / non-string / unknown / empty dropped", Object.keys(bad).length === 0, bad);
}

console.log("textColorsCss — map in, scoped CSS out");
{
  check("nothing set → empty string", textColorsCss(undefined) === "");

  const css = textColorsCss({ productName: "#5E3591", price: "#112233" });
  check("emits product name colour", css.includes("product-card__name") && css.includes("color:#5E3591"), css);
  check("emits price colour", css.includes("product-card__price") && css.includes("color:#112233"), css);
  check("does not emit unset parts", !css.includes("coa__title") && !css.includes("site-footer"), css);
  check("every rule is scoped under .sf-root", css.split("}").filter(Boolean).every((r) => r.trim().startsWith(".sf-root")), css);

  const coa = textColorsCss({ coa: "#5E3591" });
  check("COA → title, chip, purity, link", ["coa__title", "coa__shield-chip", "coa-card__purity", "coa-card__cta"].every((c) => coa.includes(c)), coa);

  check("hostile config → empty string", textColorsCss({ price: "#000;}*{color:red" }) === "");
}

console.log("withTextColor — immutable set / clear");
{
  const before = { coa: "#5E3591" };
  const added = withTextColor(before, "price", "#112233");
  check("set adds the part", added?.price === "#112233" && added?.coa === "#5E3591", added);
  check("set does not mutate the input", Object.keys(before).length === 1, before);
  check("clear drops the key", withTextColor(added, "price", undefined)?.price === undefined);
  check("clearing the last part → undefined", withTextColor(before, "coa", undefined) === undefined);
  check("set on unset config works", withTextColor(undefined, "faq", "#000")?.faq === "#000");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall text-colors checks passed");
