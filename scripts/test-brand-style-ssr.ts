/**
 * Gate for the server-painted brand palette (lib/storefront/brand-style.ts).
 * The first paint must already carry the tenant's --brand-* vars: before this,
 * storefront.css's pink :root defaults showed until hydration on every refresh.
 *
 *   npm run test:brand-style-ssr
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { brandStyleCss, brandStyleVars } from "../src/lib/storefront/brand-style";
import { BRAND } from "../src/storefront/data";
import type { Brand } from "../src/storefront/types";

const blue: Brand = { ...BRAND, main: "#1E3A8A", accent: "#2F6FD6", background: "#EEF5FE", headingFont: "Fredoka", bodyFont: "Nunito" };

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check("server CSS carries the tenant palette, not the stylesheet's pink", () => {
  const css = brandStyleCss(blue);
  assert.ok(css.startsWith(":root{"));
  assert.ok(css.includes("--brand-main:#1E3A8A"));
  assert.ok(css.includes("--brand-background:#EEF5FE"));
  assert.ok(css.includes('--brand-heading-font:"Fredoka"'));
  assert.ok(!css.includes("#FFF7FA"), "pink default background leaked");
});

check("unset optional vars are removed, not emitted", () => {
  const vars = brandStyleVars({ ...blue, headerBg: undefined, buttonFont: undefined });
  assert.strictEqual(vars["--brand-header"], null);
  assert.strictEqual(vars["--brand-button-font"], null);
  assert.ok(!brandStyleCss({ ...blue, headerBg: undefined }).includes("--brand-header:"));
});

check("a value that could break out of the rule or the <style> tag is dropped", () => {
  const css = brandStyleCss({ ...blue, main: "#fff}</style><script>x()</script>", accent: "red;background:url(x)" });
  assert.ok(!css.includes("<"), css);
  assert.ok(!css.includes("--brand-main:"), css);
  assert.ok(!css.includes("--brand-accent:"), css);
  assert.strictEqual(css.match(/[{}]/g)?.length, 2);
});

check("client applyBrandStyle and the server sheet read the same rule", () => {
  const store = readFileSync("src/storefront/store.tsx", "utf8");
  assert.ok(store.includes("brandStyleVars(b)"));
  assert.ok(!/setProperty\("--brand-main"/.test(store), "store.tsx keeps a private copy of the var list");
  const app = readFileSync("src/storefront/StorefrontApp.tsx", "utf8");
  assert.ok(app.includes("<BrandStyle brand={brand} />"));
});

console.log(`\n${passed} passed`);
