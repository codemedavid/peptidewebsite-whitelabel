/**
 * BRANDED PAGE LOADER — the tenant's own loading screen on ROUTE CHANGES, not
 * just on boot.
 *
 * The brand splash covered exactly one moment: the first server render. Every
 * navigation after that fell back to unbranded chrome — a generic ring in the
 * hash-routed SPA (StorefrontApp's PageSpinner) and two grey Skeleton walls in
 * the storefront's loading.tsx files. So a shopper opening a store saw its mark
 * once and then a stock skeleton for the rest of the visit, which is the exact
 * failure the splash was built to end.
 *
 * The fix carries the splash config down to those surfaces as CSS custom
 * properties on the storefront root, so a PROPS-LESS loader (usable from a
 * server loading.tsx and from a client next/dynamic fallback alike) can render
 * the tenant's mark without any of them plumbing tenant config of their own.
 *
 *   src/lib/storefront/brand-loader.ts
 *     brandLoaderVars()    — the root CSS vars: colors, the mark, the initials
 *     brandLoaderDesign()  — which indicator the transition loader animates
 *     monogramInitials()   — the one initials rule, shared with <Monogram>
 *
 * Runs the REAL modules plus source-text wiring checks (no DB, no React, no
 * browser):
 *
 *   npm run test:brand-page-loader
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BRAND_SPLASH_DEFAULT,
  DESIGNS_WITH_INDICATOR,
  normalizeBrandSplash,
  type SplashDesign,
} from "../src/lib/storefront/brand-splash";
import {
  brandLoaderDesign,
  brandLoaderVars,
  monogramInitials,
} from "../src/lib/storefront/brand-loader";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

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

const splashOf = (over: Record<string, unknown> = {}) =>
  normalizeBrandSplash({ ...BRAND_SPLASH_DEFAULT, ...over });

console.log("\nBRAND PAGE LOADER — root vars\n");

check("a disabled splash emits nothing, so the storefront keeps its plain spinner", () => {
  const splash = splashOf({ enabled: false });
  assert.deepStrictEqual(brandLoaderVars(splash, "K Glow", null), {});
  assert.strictEqual(brandLoaderDesign(splash), undefined);
});

check("an unconfigured tenant still gets a branded loader (fails ON, like the splash)", () => {
  const splash = normalizeBrandSplash(undefined);
  const vars = brandLoaderVars(splash, "K Glow", null);
  assert.ok(brandLoaderDesign(splash), "expected a design attribute for a default tenant");
  assert.ok(Object.keys(vars).length > 0, "expected root vars for a default tenant");
});

check("the operator's splash mark wins over the header logo", () => {
  const vars = brandLoaderVars(
    splashOf({ logoUrl: "https://cdn.example.com/splash.png" }),
    "K Glow",
    "https://cdn.example.com/header.png",
  );
  assert.strictEqual(vars["--splash-logo"], 'url("https://cdn.example.com/splash.png")');
});

check("no splash mark falls through to the header logo", () => {
  const vars = brandLoaderVars(splashOf(), "K Glow", "https://cdn.example.com/header.png");
  assert.strictEqual(vars["--splash-logo"], 'url("https://cdn.example.com/header.png")');
});

check("exactly one of --splash-logo / --splash-initials is ever emitted", () => {
  // The CSS shows the monogram through `content: var(--splash-initials)`, which
  // has no way to branch: if both were set the store would render its logo AND
  // its initials stacked together.
  const withLogo = brandLoaderVars(splashOf(), "K Glow", "https://cdn.example.com/h.png");
  assert.ok(withLogo["--splash-logo"], "expected a logo var");
  assert.strictEqual(withLogo["--splash-initials"], undefined);

  const noLogo = brandLoaderVars(splashOf(), "K Glow", null);
  assert.strictEqual(noLogo["--splash-logo"], undefined);
  assert.strictEqual(noLogo["--splash-initials"], '"KG"');
});

check("a logo URL that could break out of url() is dropped, not emitted", () => {
  // These land in an inline style attribute, so the quote/paren set is the trust
  // boundary — `https://x/a")​;background:url(evil` would smuggle a whole extra
  // declaration onto the storefront root.
  for (const hostile of [
    'https://cdn.example.com/a").x;background-image:url("https://evil.test/x',
    "https://cdn.example.com/a')",
    "https://cdn.example.com/a;b",
    "https://cdn.example.com/a b",
    "https://cdn.example.com/a\\b",
  ]) {
    const vars = brandLoaderVars(splashOf({ logoUrl: hostile }), "K Glow", hostile);
    assert.strictEqual(
      vars["--splash-logo"],
      undefined,
      `expected ${hostile} to be dropped from --splash-logo`,
    );
    // Dropping the mark must not blank the loader — it falls back to initials.
    assert.strictEqual(vars["--splash-initials"], '"KG"');
  }
});

check("a store name is escaped into a CSS string", () => {
  // Initials are the first letter of each of the first two words, so this name
  // yields a literal double quote followed by S — the character that would
  // otherwise close the CSS string early.
  const vars = brandLoaderVars(splashOf(), '"Quote\\ Store', null);
  assert.strictEqual(vars["--splash-initials"], '"\\"S"');
});

check("unset colors emit no var, so the loader inherits the tenant's theme", () => {
  const vars = brandLoaderVars(splashOf(), "K Glow", null);
  assert.strictEqual(vars["--splash-bg"], undefined);
  assert.strictEqual(vars["--splash-accent"], undefined);
  assert.strictEqual(vars["--splash-text"], undefined);
});

check("set colors are carried through", () => {
  const vars = brandLoaderVars(
    splashOf({ bgColor: "#0b0b0b", accentColor: "#e11d48", textColor: "#ffffff" }),
    "K Glow",
    null,
  );
  assert.strictEqual(vars["--splash-bg"], "#0b0b0b");
  assert.strictEqual(vars["--splash-accent"], "#e11d48");
  assert.strictEqual(vars["--splash-text"], "#ffffff");
});

check("the input splash config is never mutated", () => {
  const splash = splashOf({ logoUrl: "https://cdn.example.com/a.png" });
  const before = JSON.stringify(splash);
  brandLoaderVars(splash, "K Glow", "https://cdn.example.com/h.png");
  brandLoaderDesign(splash);
  assert.strictEqual(JSON.stringify(splash), before);
});

console.log("\nBRAND PAGE LOADER — which indicator animates\n");

check("ring and bar are honoured as chosen", () => {
  assert.strictEqual(brandLoaderDesign(splashOf({ design: "ring" })), "ring");
  assert.strictEqual(brandLoaderDesign(splashOf({ design: "bar" })), "bar");
});

check("the indicator-less designs fall back to one that moves", () => {
  // On boot a still mark is fine — the page is arriving behind it. Mid-visit it
  // is not: a motionless overlay during a route change reads as a page that
  // finished and came up empty.
  for (const quiet of ["logo-pulse", "wordmark", "fade"] as SplashDesign[]) {
    const design = brandLoaderDesign(splashOf({ design: quiet }));
    assert.ok(
      design && DESIGNS_WITH_INDICATOR.includes(design),
      `expected ${quiet} to fall back to a moving indicator, got ${String(design)}`,
    );
  }
});

check("monogramInitials is the same rule <Monogram> renders", () => {
  assert.strictEqual(monogramInitials("K Glow"), "KG");
  assert.strictEqual(monogramInitials("  hp   glow  studio "), "HG");
  assert.strictEqual(monogramInitials("Luminara"), "L");
  assert.strictEqual(monogramInitials("   "), "?");
  const monogram = read("src/components/Monogram.tsx");
  assert.ok(
    monogram.includes("monogramInitials"),
    "Monogram must share the initials rule, or the header and the loader will drift",
  );
});

console.log("\nBRAND PAGE LOADER — wiring\n");

check("the storefront layout puts the loader vars + design on the root", () => {
  const layout = read("src/app/(tenant)/(storefront)/layout.tsx");
  assert.ok(layout.includes("brandLoaderVars"), "layout must emit brandLoaderVars");
  assert.ok(layout.includes("brandLoaderDesign"), "layout must emit brandLoaderDesign");
  assert.ok(
    layout.includes("data-splash-design"),
    "layout must set data-splash-design so the props-less loader knows what to animate",
  );
});

check("the SPA's lazy-page fallback renders the branded loader", () => {
  const app = read("src/storefront/StorefrontApp.tsx");
  assert.ok(app.includes("BrandPageLoader"), "PageSpinner must render BrandPageLoader");
  assert.ok(
    !app.includes("sf-page-spinner__ring"),
    "the generic unbranded ring must be gone from the SPA fallback",
  );
});

check("both storefront loading.tsx walls render the branded loader, not a grey skeleton", () => {
  for (const file of [
    "src/app/(tenant)/(storefront)/loading.tsx",
    "src/app/(tenant)/(storefront)/products/[slug]/loading.tsx",
  ]) {
    const text = read(file);
    assert.ok(text.includes("BrandPageLoader"), `${file} must render BrandPageLoader`);
    assert.ok(!text.includes("Skeleton"), `${file} must not fall back to a grey skeleton`);
  }
});

check("the loader takes no props, so a server loading.tsx can render it", () => {
  const loader = read("src/storefront/components/BrandPageLoader.tsx");
  assert.ok(
    /export function BrandPageLoader\(\s*\)/.test(loader),
    "BrandPageLoader must be props-less — its config arrives as inherited CSS vars",
  );
  // Match the DIRECTIVE, not the phrase — the file's header explains why it has
  // no "use client", and a bare substring check flagged its own documentation.
  assert.ok(
    !/^\s*["']use client["']/m.test(loader),
    "BrandPageLoader must stay server-renderable so loading.tsx can use it",
  );
});

check("the loader reuses the splash's own class names, so the two cannot drift", () => {
  const loader = read("src/storefront/components/BrandPageLoader.tsx");
  for (const cls of ["sf-splash-page", "sf-splash__inner", "sf-splash__mark", "sf-splash__ring", "sf-splash__bar"]) {
    assert.ok(loader.includes(cls), `BrandPageLoader must render .${cls}`);
  }
});

check("a splash-disabled tenant still gets a VISIBLE loader, not a blank box", () => {
  // The regression this guards. Turning the splash off emits no vars and no
  // data-splash-design — correct, that is what keeps those tenants unbranded.
  // But every visible part of the loader was gated on that attribute, and the
  // generic PageSpinner these tenants used to fall back to was deleted in the
  // same change. The result was an empty 60vh box on every code-split route.
  const css = read("src/storefront/brand-splash.css");

  // The ring must be turned on by a rule that needs NO attribute — otherwise it
  // stays hidden by the global `.sf-splash__ring { display: none }` default.
  const base = css.match(/^\.sf-splash-page \.sf-splash__ring \{[^}]*\}/m);
  assert.ok(
    base,
    "expected an un-gated `.sf-splash-page .sf-splash__ring` rule — the ring must not depend on data-splash-design",
  );
  assert.ok(
    /display:\s*block/.test(base![0]),
    `the un-gated ring rule must show the ring, got: ${base![0]}`,
  );

  // ...and the empty mark box must not reserve space when there is no mark to
  // draw. data-splash-design is present exactly when the splash is enabled.
  assert.ok(
    /\[data-splash-design\] \.sf-splash-page \.sf-splash__mark/.test(css),
    "the mark must only occupy space when the splash is enabled",
  );
});

check("the bar design swaps the ring out rather than relying on it being hidden", () => {
  const css = read("src/storefront/brand-splash.css");
  assert.ok(
    /\[data-splash-design="bar"\] \.sf-splash-page \.sf-splash__ring \{[^}]*display:\s*none/.test(css),
    "now that the ring is on by default, the bar design must explicitly hide it",
  );
});

check("reduced motion never blanks a splash-disabled tenant's loader", () => {
  // The reduced-motion rule drops the ring because a static spinner reads as
  // broken — fine while a brand mark is left standing. With the splash off
  // there is no mark, so dropping the ring leaves nothing at all; a still ring
  // beats an empty screen.
  const css = read("src/storefront/brand-splash.css");
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf(".sf-splash-page")));
  assert.ok(
    /\[data-splash-design\][^{]*\.sf-splash__ring \{[^}]*display:\s*none/.test(reduced),
    "reduced motion may only hide the ring when a mark is there to replace it",
  );
});

check("the stylesheet drives the loader off the root's data-splash-design", () => {
  const css = read("src/storefront/brand-splash.css");
  assert.ok(css.includes(".sf-splash-page"), "brand-splash.css must style the page loader");
  // Every design brandLoaderDesign can emit must actually end up VISIBLE — the
  // ring through the un-gated default above, the rest through their own
  // attribute rule. Asserting each design is merely "mentioned" was what let the
  // splash-disabled blank box through: the ring was mentioned, and hidden.
  for (const design of DESIGNS_WITH_INDICATOR) {
    const shown = new RegExp(
      `(\\[data-splash-design="${design}"\\] )?\\.sf-splash-page \\.sf-splash__${design} \\{[^}]*display:\\s*block`,
    );
    assert.ok(
      shown.test(css),
      `brand-splash.css must actually display the "${design}" indicator`,
    );
  }
  assert.ok(
    css.includes("--splash-initials"),
    "the monogram fallback must render from var(--splash-initials)",
  );
  // The branch itself. `content: var(--splash-initials, "")` still GENERATES the
  // pseudo-element — an empty string is a box — so the monogram tile painted
  // over every tenant's uploaded logo. Only `none` suppresses it.
  assert.ok(
    /content:\s*var\(--splash-initials,\s*none\)/.test(css),
    'the monogram pseudo-element must fall back to `none`, not "" — an empty string still paints its tile over the logo',
  );
  assert.ok(
    css.includes("--splash-logo"),
    "the mark must render from var(--splash-logo)",
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
