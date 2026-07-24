// Configurable price font — RED/GREEN gate (npm run test:price-font).
//
// Prices used to inherit the serif heading font (.font-display →
// --brand-heading-font). We decoupled them into their own token so prices read
// in a clean sans by default across the whole SaaS, and any tenant (Luminara
// first) can pin a distinct price face.
//
// Contract (src/lib/storefront/price-font.ts):
//   - resolvePriceFont(brand): the effective family — brand.priceFont if set,
//     else brand.bodyFont, else "Inter". This is what a tenant's prices show.
//   - priceFontVar(brand): the CSS value to write to --brand-price-font ONLY
//     when priceFont is explicitly chosen; null when unset so the CSS default
//     (--brand-price-font: var(--brand-body-font)) keeps applying. Mirrors the
//     buttonFont pattern in store.tsx applyBrandStyle.
//
// Journeys:
//  1. priceFont set → resolvePriceFont returns it; priceFontVar is a quoted family.
//  2. priceFont unset → resolvePriceFont returns the body font; priceFontVar null.
//  3. priceFont blank/whitespace → treated as unset (falls back to body).
//  4. neither priceFont nor bodyFont → "Inter" safety fallback.
//  5. CSS: --brand-price-font defaults to the body font; the card + detail price
//     rules use var(--brand-price-font).
//  6. Wiring: store.tsx sets --brand-price-font, and the storefront font loader
//     passes priceFont to googleFontsUrl (so a custom price face is loaded).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePriceFont, priceFontVar } from "../src/lib/storefront/price-font";
import type { Brand } from "../src/storefront/types";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ""}`);
  }
}
function brand(o: Partial<Brand>): Brand {
  return { ...(o as object) } as Brand;
}
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

console.log("resolvePriceFont — priceFont wins, body font is the default");
{
  check("priceFont set → itself", resolvePriceFont(brand({ priceFont: "Manrope", bodyFont: "Inter" })) === "Manrope");
  check("priceFont unset → body font", resolvePriceFont(brand({ bodyFont: "Inter" })) === "Inter");
  check("priceFont blank → body font", resolvePriceFont(brand({ priceFont: "  ", bodyFont: "Sora" })) === "Sora");
  check("neither → Inter fallback", resolvePriceFont(brand({})) === "Inter");
}

console.log("priceFontVar — only overrides when explicitly chosen");
{
  check("set → quoted css family", priceFontVar(brand({ priceFont: "Manrope" })) === `"Manrope", system-ui, sans-serif`, priceFontVar(brand({ priceFont: "Manrope" })));
  check("unset → null (use default)", priceFontVar(brand({ bodyFont: "Inter" })) === null);
  check("blank → null (use default)", priceFontVar(brand({ priceFont: "   " })) === null);
}

console.log("CSS — price uses its own token, defaulting to the body font");
{
  const css = read("src/storefront/storefront.css");
  check(
    "--brand-price-font defaults to var(--brand-body-font)",
    /--brand-price-font:\s*var\(--brand-body-font\)/.test(css),
    css.match(/--brand-price-font:[^;]*/)?.[0],
  );
  const priceRule = css.match(/\.sf-root \.product-card__price\s*\{[^}]*\}/)?.[0] ?? "";
  check("product-card__price uses var(--brand-price-font)", /font-family:\s*var\(--brand-price-font\)/.test(priceRule), priceRule);
  const detailRule = css.match(/\.sf-root \.sf-detail__price\s*\{[^}]*\}/)?.[0] ?? "";
  check("sf-detail__price uses var(--brand-price-font)", /font-family:\s*var\(--brand-price-font\)/.test(detailRule), detailRule);
}

console.log("Wiring — runtime var + font loader");
{
  const store = read("src/storefront/store.tsx");
  check("store.tsx sets --brand-price-font", /--brand-price-font/.test(store));
  const layout = read("src/app/(tenant)/(storefront)/layout.tsx");
  check("storefront layout loads priceFont", /priceFont/.test(layout));
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll price-font checks passed");
