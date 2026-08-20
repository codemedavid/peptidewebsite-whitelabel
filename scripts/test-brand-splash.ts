/**
 * Self-contained test for the BRAND SPLASH — the per-tenant branded loading
 * screen every storefront shows while it boots:
 *
 *   src/lib/storefront/brand-splash.ts
 *     normalizeBrandSplash()  — coerces the untrusted branding.config.brandSplash
 *                               blob into a usable config. Fails ON: a tenant that
 *                               has never been configured still gets a splash.
 *     splashLogoUrl()         — uploaded splash mark > the header logo > "" (monogram)
 *     splashVarsCss()         — only the operator's SET color overrides become CSS
 *                               vars, so an unset color keeps inheriting the theme
 *
 *   src/lib/upload/branding-assets.ts
 *     assetTarget()           — WHERE a branding asset is stored: its own Branding
 *                               column, or a path inside the shared config blob.
 *                               "splashLogo" is a config-path kind; without this
 *                               dispatch the upload action's `kind === "logo" ?
 *                               logoUrl : faviconUrl` fallthrough would overwrite
 *                               the tenant's FAVICON with the splash mark.
 *     applyBrandingAsset()    — the immutable nested merge behind that write
 *
 * Runs the REAL modules (no DB, no Next runtime, no browser):
 *
 *   npm run test:brand-splash
 */

import assert from "node:assert";

import {
  BRAND_SPLASH_DEFAULT,
  MAX_SPLASH_TAGLINE,
  SPLASH_DESIGNS,
  isBrandSplashEnabled,
  normalizeBrandSplash,
  splashLogoUrl,
  splashVarsCss,
} from "../src/lib/storefront/brand-splash";
import {
  applyBrandingAsset,
  applyDefaultProductImage,
  assetTarget,
  brandingAssetRules,
  isBrandingAssetKind,
  validateBrandingAssetFile,
} from "../src/lib/upload/branding-assets";
import { BRANDING_ASSET_MAX_BYTES } from "../src/lib/upload/limits";

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

// ──────────────────────────── default-ON semantics ──────────────────────────
// The whole point of the feature: it ships to every tenant without a grant. Any
// config shape the normalizer doesn't recognise must still produce a splash.
console.log("normalizeBrandSplash — default ON");
check("absent config still yields an enabled splash", () => {
  assert.equal(normalizeBrandSplash(undefined).enabled, true);
  assert.equal(normalizeBrandSplash(null).enabled, true);
});
check("junk config (string / array / number) yields the safe default", () => {
  for (const junk of ["nope", [], 42, true]) {
    assert.equal(normalizeBrandSplash(junk).enabled, true, `junk: ${JSON.stringify(junk)}`);
    assert.equal(normalizeBrandSplash(junk).design, BRAND_SPLASH_DEFAULT.design);
  }
});
check("a literal false — and only a literal false — disables it", () => {
  assert.equal(normalizeBrandSplash({ enabled: false }).enabled, false);
});
check('the string "false" does NOT disable it', () => {
  // Config that round-trips through a form post arrives as strings, and
  // "false" is truthy in JS. A looser check would blank tenants by accident.
  assert.equal(normalizeBrandSplash({ enabled: "false" }).enabled, true);
  assert.equal(normalizeBrandSplash({ enabled: 0 }).enabled, true);
});
check("isBrandSplashEnabled reads raw config without pre-normalizing", () => {
  assert.equal(isBrandSplashEnabled(undefined), true);
  assert.equal(isBrandSplashEnabled({ enabled: false }), false);
});
check("never mutates the input config object", () => {
  const input = { enabled: true, tagline: "hi" };
  const frozen = Object.freeze({ ...input });
  normalizeBrandSplash(frozen);
  assert.deepEqual(frozen, input);
});

// ──────────────────────────── design picker ─────────────────────────────────
console.log("\nnormalizeBrandSplash — design");
check("a known design is preserved", () => {
  for (const design of SPLASH_DESIGNS) {
    assert.equal(normalizeBrandSplash({ design }).design, design);
  }
});
check("an unknown design falls back to the default", () => {
  assert.equal(normalizeBrandSplash({ design: "explode" }).design, BRAND_SPLASH_DEFAULT.design);
  assert.equal(normalizeBrandSplash({ design: 7 }).design, BRAND_SPLASH_DEFAULT.design);
});
check("the default design is one of the offered designs", () => {
  assert.ok(SPLASH_DESIGNS.includes(BRAND_SPLASH_DEFAULT.design));
});

// ──────────────────────────── colors (free hex, inline style) ───────────────
// bgColor/accentColor/textColor render into an inline style attribute, so the
// normalizer is the trust boundary: anything that isn't a plain hex is dropped.
console.log("\nnormalizeBrandSplash — colors");
check("accepts #rgb and #rrggbb, case-insensitively", () => {
  assert.equal(normalizeBrandSplash({ bgColor: "#fff" }).bgColor, "#fff");
  assert.equal(normalizeBrandSplash({ bgColor: "#A1B2C3" }).bgColor, "#A1B2C3");
  assert.equal(normalizeBrandSplash({ accentColor: "  #123456  " }).accentColor, "#123456");
});
check("drops a non-hex color instead of storing it", () => {
  for (const bad of ["red", "rgb(1,2,3)", "#12", "#1234567", "javascript:alert(1)", 42, null]) {
    assert.equal(
      normalizeBrandSplash({ bgColor: bad }).bgColor,
      undefined,
      `should have dropped: ${JSON.stringify(bad)}`,
    );
  }
});
check("a CSS injection attempt cannot survive normalization", () => {
  const evil = "#fff;background-image:url(https://evil.example/x.png)";
  assert.equal(normalizeBrandSplash({ bgColor: evil }).bgColor, undefined);
});
check("an unset color stays undefined so the theme keeps applying", () => {
  const splash = normalizeBrandSplash({});
  assert.equal(splash.bgColor, undefined);
  assert.equal(splash.accentColor, undefined);
  assert.equal(splash.textColor, undefined);
});

// ──────────────────────────── splashVarsCss ─────────────────────────────────
console.log("\nsplashVarsCss");
check("emits no vars when the operator set no colors", () => {
  assert.deepEqual(splashVarsCss(normalizeBrandSplash({})), {});
});
check("emits only the vars that were actually set", () => {
  const vars = splashVarsCss(normalizeBrandSplash({ bgColor: "#101010" }));
  assert.deepEqual(vars, { "--splash-bg": "#101010" });
});
check("emits all three when all three are set", () => {
  const vars = splashVarsCss(
    normalizeBrandSplash({ bgColor: "#111", accentColor: "#222", textColor: "#333" }),
  );
  assert.deepEqual(vars, {
    "--splash-bg": "#111",
    "--splash-accent": "#222",
    "--splash-text": "#333",
  });
});

// ──────────────────────────── logo precedence ───────────────────────────────
console.log("\nsplashLogoUrl");
const HOSTED = "https://ik.imagekit.io/x/tenant/acme/splash.png";
const HEADER = "https://ik.imagekit.io/x/tenant/acme/logo.png";
check("the uploaded splash mark wins", () => {
  assert.equal(splashLogoUrl(normalizeBrandSplash({ logoUrl: HOSTED }), HEADER), HOSTED);
});
check("falls back to the header logo when no splash mark is set", () => {
  assert.equal(splashLogoUrl(normalizeBrandSplash({}), HEADER), HEADER);
});
check("falls back to empty (monogram) when the tenant has no logo at all", () => {
  assert.equal(splashLogoUrl(normalizeBrandSplash({}), null), "");
  assert.equal(splashLogoUrl(normalizeBrandSplash({}), undefined), "");
});
check("only http(s) survives — no javascript:/data: into an <img src>", () => {
  for (const bad of ["javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz4=", "/local.png"]) {
    assert.equal(
      normalizeBrandSplash({ logoUrl: bad }).logoUrl,
      "",
      `should have rejected: ${bad}`,
    );
  }
});
check("a rejected splash logo still falls through to the header logo", () => {
  assert.equal(splashLogoUrl(normalizeBrandSplash({ logoUrl: "javascript:x" }), HEADER), HEADER);
});

// ──────────────────────────── tagline + durations ───────────────────────────
console.log("\nnormalizeBrandSplash — tagline & durations");
check("the tagline is trimmed and clamped, never rejected", () => {
  assert.equal(normalizeBrandSplash({ tagline: "  hello  " }).tagline, "hello");
  const long = "x".repeat(MAX_SPLASH_TAGLINE + 50);
  assert.equal(normalizeBrandSplash({ tagline: long }).tagline.length, MAX_SPLASH_TAGLINE);
});
check("a non-string tagline reads as empty, not as \"undefined\"", () => {
  assert.equal(normalizeBrandSplash({ tagline: 42 }).tagline, "");
});
check("durations fall back to the defaults when absent or junk", () => {
  const splash = normalizeBrandSplash({ minDurationMs: "soon", maxDurationMs: null });
  assert.equal(splash.minDurationMs, BRAND_SPLASH_DEFAULT.minDurationMs);
  assert.equal(splash.maxDurationMs, BRAND_SPLASH_DEFAULT.maxDurationMs);
});
check("a max duration is capped — an operator cannot hide a store behind the splash", () => {
  const splash = normalizeBrandSplash({ maxDurationMs: 999_999 });
  assert.ok(splash.maxDurationMs <= 5000, `max was ${splash.maxDurationMs}`);
});
check("min never exceeds max", () => {
  const splash = normalizeBrandSplash({ minDurationMs: 4000, maxDurationMs: 600 });
  assert.ok(
    splash.minDurationMs <= splash.maxDurationMs,
    `min ${splash.minDurationMs} > max ${splash.maxDurationMs}`,
  );
});
check("negative durations clamp to zero rather than inverting the animation", () => {
  assert.ok(normalizeBrandSplash({ minDurationMs: -500 }).minDurationMs >= 0);
});

// ──────────────────────────── the splashLogo asset kind ─────────────────────
console.log("\nbranding-assets — splashLogo kind");
check("splashLogo is a recognised branding asset kind", () => {
  assert.equal(isBrandingAssetKind("splashLogo"), true);
});
check("splashLogo takes the small-mark rules (2 MB, vectors allowed)", () => {
  const rules = brandingAssetRules("splashLogo");
  assert.equal(rules.maxBytes, BRANDING_ASSET_MAX_BYTES);
  assert.ok(rules.allowedTypes.has("image/svg+xml"), "a splash mark may be a vector");
  assert.equal(validateBrandingAssetFile("splashLogo", { type: "image/png", size: 1000 }), null);
  assert.ok(validateBrandingAssetFile("splashLogo", { type: "image/png", size: 5e6 }));
});

// ──────────────────────────── assetTarget dispatch ──────────────────────────
// This is the guard against the real bug: upload/removeBrandingAssetAction each
// end in `kind === "logo" ? { logoUrl } : { faviconUrl }`. A config-blob kind
// that reaches that line silently overwrites the tenant's favicon.
console.log("\nbranding-assets — assetTarget");
check("logo and favicon own their Branding columns", () => {
  assert.deepEqual(assetTarget("logo"), { store: "column", column: "logoUrl" });
  assert.deepEqual(assetTarget("favicon"), { store: "column", column: "faviconUrl" });
});
check("defaultProductImage is a config-blob kind", () => {
  assert.deepEqual(assetTarget("defaultProductImage"), {
    store: "config",
    path: ["defaultProductImage"],
  });
});
check("splashLogo is a config-blob kind — it must NOT reach the column branch", () => {
  const target = assetTarget("splashLogo");
  assert.equal(target.store, "config", "splashLogo would overwrite faviconUrl as a column kind");
  assert.deepEqual(target.store === "config" ? target.path : null, ["brandSplash", "logoUrl"]);
});

// ──────────────────────────── applyBrandingAsset ────────────────────────────
console.log("\nbranding-assets — applyBrandingAsset");
check("writes a nested config path without disturbing siblings", () => {
  const config = { name: "Acme", brandSplash: { design: "ring", tagline: "keep me" } };
  const next = applyBrandingAsset(config, "splashLogo", HOSTED);
  assert.equal((next.brandSplash as Record<string, unknown>).logoUrl, HOSTED);
  assert.equal((next.brandSplash as Record<string, unknown>).design, "ring");
  assert.equal((next.brandSplash as Record<string, unknown>).tagline, "keep me");
  assert.equal(next.name, "Acme");
});
check("creates the parent object when the tenant has no splash config yet", () => {
  const next = applyBrandingAsset({ name: "Acme" }, "splashLogo", HOSTED);
  assert.equal((next.brandSplash as Record<string, unknown>).logoUrl, HOSTED);
});
check("clearing DELETES the key rather than storing an empty string", () => {
  const config = { brandSplash: { design: "ring", logoUrl: HOSTED } };
  const next = applyBrandingAsset(config, "splashLogo", null);
  const splash = next.brandSplash as Record<string, unknown>;
  assert.ok(!("logoUrl" in splash), "logoUrl should be removed, not blanked");
  assert.equal(splash.design, "ring", "clearing the logo must not drop the rest of the config");
});
check("is immutable — the input config and its nested objects are untouched", () => {
  const nested = { design: "ring" };
  const config = { brandSplash: nested };
  const next = applyBrandingAsset(config, "splashLogo", HOSTED);
  assert.equal("logoUrl" in nested, false, "the nested object was mutated in place");
  assert.notEqual(next.brandSplash, nested, "the nested object must be copied, not shared");
});
check("refuses a column-backed kind loudly instead of silently no-oping", () => {
  assert.throws(() => applyBrandingAsset({}, "logo", HOSTED), /column/i);
});
check("applyDefaultProductImage still behaves exactly as before", () => {
  assert.equal(applyDefaultProductImage({}, HOSTED).defaultProductImage, HOSTED);
  assert.ok(!("defaultProductImage" in applyDefaultProductImage({ defaultProductImage: HOSTED }, null)));
});

// ──────────────────────────── summary ────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
