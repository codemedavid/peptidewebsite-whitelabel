/**
 * Structural test for the BRAND SPLASH's surfaces — where the branded loading
 * screen is rendered, where it is configured, and (just as load-bearing) where
 * it must NOT appear.
 *
 * The pure core is covered by scripts/test-brand-splash.ts. This suite asserts
 * the wiring that a unit test of a pure module cannot see:
 *
 *   1. The storefront layout actually mounts the splash, brand-scoped.
 *   2. The overlay renders from the shared core rather than re-deriving config.
 *   3. The splash lifts WITHOUT JavaScript. A fixed full-viewport overlay that
 *      only a useEffect can dismiss is a white-labeled outage for every tenant
 *      the moment hydration fails, so the stylesheet carries its own forced
 *      dismissal.
 *   4. The operator configures it on the per-tenant Branding page, and an
 *      uploaded splash mark is mirrored into `cfg` — Save branding writes that
 *      object back wholesale, so a stale cfg would silently undo the upload.
 *   5. The STORE OWNER can neither see nor edit it. This is an operator-only
 *      feature; if it ever leaks into the store admin, that is a regression.
 *
 *   npm run test:brand-splash-admin
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

// ──────────────────────────── 1. the storefront mounts it ───────────────────
console.log("storefront layout");
const LAYOUT = "src/app/(tenant)/(storefront)/layout.tsx";
check("the storefront layout renders the splash", () => {
  assert.ok(read(LAYOUT).includes("<BrandSplash"), `${LAYOUT} must mount <BrandSplash>`);
});
check("the layout gates on the tenant's own config", () => {
  assert.ok(
    /brandSplash/.test(read(LAYOUT)),
    "the layout must read branding.config.brandSplash",
  );
});

// ──────────────────────────── 2. one contract, not two ──────────────────────
console.log("\nBrandSplash overlay");
const OVERLAY = "src/storefront/components/BrandSplash.tsx";
check("the overlay renders from the shared pure core", () => {
  const src = read(OVERLAY);
  for (const fn of ["splashLogoUrl", "splashVarsCss"]) {
    assert.ok(src.includes(fn), `BrandSplash must resolve through ${fn}()`);
  }
});
check("it falls back to the monogram when the tenant has no mark at all", () => {
  assert.ok(read(OVERLAY).includes("Monogram"), "a logo-less tenant needs a drawn fallback");
});
check("it announces itself to assistive tech", () => {
  const src = read(OVERLAY);
  assert.ok(src.includes('role="status"'), "the overlay must expose a live status role");
  assert.ok(/aria-label/.test(src), "the overlay must be labelled");
});
check("it respects prefers-reduced-motion", () => {
  const css = read("src/storefront/brand-splash.css");
  assert.ok(css.includes("prefers-reduced-motion"), "motion must be opt-out");
});

// ──────────────────────────── 3. it lifts without JS ────────────────────────
console.log("\nfail-safe dismissal");
const CSS = "src/storefront/brand-splash.css";
check("the stylesheet dismisses the overlay on its own", () => {
  const css = read(CSS);
  assert.ok(
    css.includes("forwards"),
    "the dismissal animation must use animation-fill-mode: forwards, or the overlay springs back",
  );
  assert.ok(
    /visibility:\s*hidden/.test(css),
    "the dismissed overlay must stop capturing clicks, not just fade to transparent",
  );
});
check("the overlay never traps a shopper behind an opaque layer", () => {
  assert.ok(
    /pointer-events:\s*none/.test(read(CSS)),
    "the dismissed overlay must let clicks through",
  );
});
check("the splash stylesheet is its own file, not appended to storefront.css", () => {
  // storefront.css has a recorded cascade hazard: later small-screen blocks have
  // silently overridden earlier same-specificity rules. A separate file that is
  // imported after it keeps these rules out of that fight.
  assert.ok(
    read(LAYOUT).includes("brand-splash.css"),
    "the layout must import the splash stylesheet explicitly",
  );
});

// ──────────────────────────── 4. the operator surface ───────────────────────
console.log("\noperator controls (per-tenant Branding page)");
const EDITOR = "src/components/admin/BrandingEditor.tsx";
const PANEL = "src/components/admin/BrandSplashEditor.tsx";
check("the Branding editor exposes a Loading screen section", () => {
  assert.ok(read(EDITOR).includes("BrandSplashEditor"), "BrandingEditor must render the panel");
});
check("the operator can upload a splash-only mark", () => {
  assert.ok(
    read(PANEL).includes('kind="splashLogo"'),
    "the panel must offer an upload bound to the splashLogo asset kind",
  );
});
check("an uploaded mark is mirrored into cfg so Save branding can't undo it", () => {
  const src = read(EDITOR);
  assert.ok(
    src.includes("applyBrandingAsset"),
    "the editor must merge the uploaded URL into cfg via applyBrandingAsset",
  );
  assert.ok(/setCfg\([\s\S]{0,400}applyBrandingAsset/.test(src), "the merge must go through setCfg");
});
check("the config rides the existing Save branding, with no second save action", () => {
  // saveBrandingAction writes the editor's cfg wholesale, so a separate
  // per-splash action would simply be clobbered by the next save.
  assert.ok(
    read(PANEL).includes("brandSplash"),
    "the panel must write brandSplash into the shared config state",
  );
  assert.ok(
    !/saveBrandSplashAction/.test(read("src/actions/branding.ts")),
    "there must be no separate splash save action to drift from Save branding",
  );
});
check("all three colors are operator-editable", () => {
  const src = read(PANEL);
  for (const field of ["bgColor", "accentColor", "textColor"]) {
    assert.ok(src.includes(field), `the panel must expose ${field}`);
  }
});
check("the loading design is operator-selectable", () => {
  assert.ok(read(PANEL).includes("SPLASH_DESIGNS"), "the panel must offer the design menu");
});

// ──────────────────────────── 5. invisible to the store owner ───────────────
// The feature is operator-only by design. These greps are what keep that true
// as the store admin grows.
console.log("\nowner-invisibility");
const OWNER_SURFACES = [
  "src/storefront/admin/staff-permissions.ts",
  "src/storefront/admin/admin-nav.ts",
  "src/actions/storefront-admin.ts",
];
for (const surface of OWNER_SURFACES) {
  check(`${surface} does not expose the splash`, () => {
    const src = read(surface);
    for (const token of ["brandSplash", "splashLogo", "BrandSplash"]) {
      assert.ok(
        !src.includes(token),
        `"${token}" leaked into an owner-facing surface — the splash is operator-only`,
      );
    }
  });
}
check("no store-admin panel exists for the splash", () => {
  const src = read("src/storefront/admin/AdminPage.tsx");
  assert.ok(!src.includes("BrandSplash"), "the store admin must not render a splash panel");
});

// ──────────────────────────── summary ────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
