/**
 * Self-contained test for the per-tenant default product image — the pure module
 * the storefront uses to fall back to a brand-level image when a product has no
 * photo of its own:
 *
 *   src/lib/storefront/product-image.ts
 *     normalizeDefaultProductImage() — coerces the untrusted branding.config value
 *                                      into a safe http(s) URL (or undefined) before
 *                                      it is stamped onto the Brand handed to the
 *                                      client, so a stored value can't smuggle
 *                                      javascript:/data: into an <img src>
 *     resolveProductImage()          — product's own image wins; otherwise the
 *                                      brand default; otherwise null (SVG placeholder)
 *
 * Plus structural checks that the public render surfaces actually consume the
 * fallback (Catalog, MerchantPage, TwoWaysHome, GroupBuyPage, SEO product page)
 * and that page.tsx normalizes the config value server-side.
 *
 * Runs the REAL module (no DB, no Next runtime, no browser):
 *
 *   npm run test:default-product-image
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  normalizeDefaultProductImage,
  resolveProductImage,
} from "../src/lib/storefront/product-image";
import {
  applyDefaultProductImage,
  brandingAssetRules,
  isBrandingAssetKind,
  validateBrandingAssetFile,
} from "../src/lib/upload/branding-assets";
import { BRANDING_ASSET_MAX_BYTES, STOREFRONT_IMAGE_MAX_BYTES } from "../src/lib/upload/limits";

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

// ──────────────────────────── normalizeDefaultProductImage ──────────────────
console.log("normalizeDefaultProductImage");
check("keeps https URLs", () => {
  assert.equal(
    normalizeDefaultProductImage("https://ik.imagekit.io/x/tenant/peptibesties/default.jpeg"),
    "https://ik.imagekit.io/x/tenant/peptibesties/default.jpeg",
  );
});
check("keeps http URLs", () => {
  assert.equal(normalizeDefaultProductImage("http://localhost:3100/x.png"), "http://localhost:3100/x.png");
});
check("trims surrounding whitespace", () => {
  assert.equal(normalizeDefaultProductImage("  https://cdn.example/a.png  "), "https://cdn.example/a.png");
});
check("rejects javascript: URLs", () => {
  assert.equal(normalizeDefaultProductImage("javascript:alert(1)"), undefined);
});
check("rejects data: URLs (product images must be hosted)", () => {
  assert.equal(normalizeDefaultProductImage("data:image/png;base64,AAAA"), undefined);
});
check("rejects relative paths", () => {
  assert.equal(normalizeDefaultProductImage("/uploads/x.png"), undefined);
});
check("rejects empty string", () => {
  assert.equal(normalizeDefaultProductImage(""), undefined);
});
check("rejects non-strings", () => {
  assert.equal(normalizeDefaultProductImage(42), undefined);
  assert.equal(normalizeDefaultProductImage(null), undefined);
  assert.equal(normalizeDefaultProductImage({ url: "https://x" }), undefined);
});

// ──────────────────────────── resolveProductImage ────────────────────────────
console.log("resolveProductImage");
const DEFAULT = "https://ik.imagekit.io/x/tenant/peptibesties/default.jpeg";
check("product's own image wins over the brand default", () => {
  assert.equal(resolveProductImage("https://cdn.example/own.png", DEFAULT), "https://cdn.example/own.png");
});
check("falls back to the brand default when image is null", () => {
  assert.equal(resolveProductImage(null, DEFAULT), DEFAULT);
});
check("falls back to the brand default when image is empty string", () => {
  assert.equal(resolveProductImage("", DEFAULT), DEFAULT);
});
check("returns null when neither exists (SVG placeholder path)", () => {
  assert.equal(resolveProductImage(null, undefined), null);
  assert.equal(resolveProductImage(undefined, null), null);
});

// ──────────────────────── structural: surfaces consume the fallback ─────────
console.log("render surfaces use the fallback");
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

for (const file of [
  "src/storefront/components/Catalog.tsx",
  "src/storefront/pages/MerchantPage.tsx",
  "src/storefront/components/TwoWaysHome.tsx",
  "src/storefront/pages/GroupBuyPage.tsx",
]) {
  check(`${file} resolves images through the brand default`, () => {
    assert.ok(
      read(file).includes("resolveProductImage"),
      `${file} does not call resolveProductImage`,
    );
  });
}
check("Brand type declares defaultProductImage", () => {
  assert.ok(read("src/storefront/types.ts").includes("defaultProductImage"));
});
check("storefront page.tsx normalizes config.defaultProductImage server-side", () => {
  assert.ok(read("src/app/(tenant)/(storefront)/page.tsx").includes("normalizeDefaultProductImage"));
});
check("SEO product detail page falls back to the brand default", () => {
  assert.ok(
    read("src/app/(tenant)/(storefront)/products/[slug]/page.tsx").includes(
      "normalizeDefaultProductImage",
    ),
  );
});

// ──────────────────── operator upload: kinds, rules, validation ─────────────
// The super admin sets this image from the tenant Branding editor, alongside
// the logo and favicon. A product photo is not a 2 MB logo, so the upload rules
// are per-kind rather than shared.
console.log("branding asset kinds");
check("the three uploadable branding assets are recognised", () => {
  assert.equal(isBrandingAssetKind("logo"), true);
  assert.equal(isBrandingAssetKind("favicon"), true);
  assert.equal(isBrandingAssetKind("defaultProductImage"), true);
});
check("anything else is rejected (guards the server action)", () => {
  assert.equal(isBrandingAssetKind("hero"), false);
  assert.equal(isBrandingAssetKind(""), false);
  assert.equal(isBrandingAssetKind(null), false);
  assert.equal(isBrandingAssetKind(undefined), false);
  assert.equal(isBrandingAssetKind({ kind: "logo" }), false);
});

console.log("brandingAssetRules");
check("logo and favicon keep the small 2 MB budget", () => {
  assert.equal(brandingAssetRules("logo").maxBytes, BRANDING_ASSET_MAX_BYTES);
  assert.equal(brandingAssetRules("favicon").maxBytes, BRANDING_ASSET_MAX_BYTES);
});
check("the default product image gets the 10 MB photo budget", () => {
  assert.equal(brandingAssetRules("defaultProductImage").maxBytes, STOREFRONT_IMAGE_MAX_BYTES);
});
check("the default product image accepts photo types", () => {
  const { allowedTypes } = brandingAssetRules("defaultProductImage");
  assert.ok(allowedTypes.has("image/jpeg"));
  assert.ok(allowedTypes.has("image/png"));
  assert.ok(allowedTypes.has("image/webp"));
});
check("the default product image rejects icon/vector types a product card can't use well", () => {
  const { allowedTypes } = brandingAssetRules("defaultProductImage");
  assert.equal(allowedTypes.has("image/x-icon"), false);
  assert.equal(allowedTypes.has("image/svg+xml"), false);
});
check("favicons still accept .ico", () => {
  assert.ok(brandingAssetRules("favicon").allowedTypes.has("image/x-icon"));
});

console.log("validateBrandingAssetFile");
check("a valid photo passes for the default product image", () => {
  assert.equal(
    validateBrandingAssetFile("defaultProductImage", { type: "image/jpeg", size: 3 * 1024 * 1024 }),
    null,
  );
});
check("the same 3 MB photo is too large for a logo", () => {
  const err = validateBrandingAssetFile("logo", { type: "image/jpeg", size: 3 * 1024 * 1024 });
  assert.ok(err && /too large/i.test(err), `expected a size error, got ${String(err)}`);
});
check("an oversized default product image is rejected with its own 10 MB limit", () => {
  const err = validateBrandingAssetFile("defaultProductImage", {
    type: "image/png",
    size: STOREFRONT_IMAGE_MAX_BYTES + 1,
  });
  assert.ok(err && /too large/i.test(err), `expected a size error, got ${String(err)}`);
  assert.ok(/10 MB/.test(err!), `error should name the 10 MB limit, got ${err}`);
});
check("an unsupported type is rejected by name", () => {
  const err = validateBrandingAssetFile("defaultProductImage", {
    type: "application/pdf",
    size: 1024,
  });
  assert.ok(err && /unsupported/i.test(err), `expected a type error, got ${String(err)}`);
});
check("an empty file is rejected", () => {
  const err = validateBrandingAssetFile("defaultProductImage", { type: "image/png", size: 0 });
  assert.ok(err, "a zero-byte upload must not be accepted");
});

// ──────────────── operator upload: branding.config read-modify-write ────────
// The upload persists straight into branding.config (like the logo persists
// straight onto its column), so both the action and the editor merge through
// this one function — see the clobber guard asserted further down.
console.log("applyDefaultProductImage");
const CONFIG = { name: "K Glow", accent: "#111", defaultProductImage: "https://cdn.example/old.png" };
check("sets the image without touching the rest of the config", () => {
  const next = applyDefaultProductImage(CONFIG, "https://cdn.example/new.png");
  assert.equal(next.defaultProductImage, "https://cdn.example/new.png");
  assert.equal(next.name, "K Glow");
  assert.equal(next.accent, "#111");
});
check("never mutates the config it was given", () => {
  const before = { ...CONFIG };
  applyDefaultProductImage(CONFIG, "https://cdn.example/new.png");
  assert.deepEqual(CONFIG, before);
});
check("removing drops the key entirely (storefront falls back to the placeholder)", () => {
  const next = applyDefaultProductImage(CONFIG, null);
  assert.equal("defaultProductImage" in next, false);
  assert.equal(next.name, "K Glow");
});
check("trims the stored URL", () => {
  const next = applyDefaultProductImage({}, "  https://cdn.example/new.png  ");
  assert.equal(next.defaultProductImage, "https://cdn.example/new.png");
});
check("a blank URL removes the key rather than storing an empty string", () => {
  const next = applyDefaultProductImage(CONFIG, "   ");
  assert.equal("defaultProductImage" in next, false);
});
check("what it stores survives the storefront normalizer (no dead value in the DB)", () => {
  const next = applyDefaultProductImage({}, "https://ik.imagekit.io/x/tenant/k-glow/default.jpeg");
  assert.equal(
    normalizeDefaultProductImage(next.defaultProductImage),
    "https://ik.imagekit.io/x/tenant/k-glow/default.jpeg",
  );
});

// ────────────── structural: the operator surfaces are actually wired ────────
console.log("operator surfaces");
check("the branding action validates uploads per kind", () => {
  assert.ok(
    read("src/actions/branding.ts").includes("validateBrandingAssetFile"),
    "actions/branding.ts must validate through the shared per-kind rules",
  );
});
check("the branding action persists the image into branding.config", () => {
  // The action dispatches on assetTarget() and merges through the generalized
  // applyBrandingAsset (of which applyDefaultProductImage is the named wrapper),
  // so config-blob kinds can never fall through to the Branding-column branch.
  const src = read("src/actions/branding.ts");
  assert.ok(src.includes("applyBrandingAsset"), "actions/branding.ts must merge, not overwrite");
  assert.ok(src.includes("assetTarget"), "actions/branding.ts must dispatch on the asset's store");
});
check("the Branding editor offers the upload control to the super admin", () => {
  assert.ok(
    read("src/components/admin/BrandingEditor.tsx").includes('kind="defaultProductImage"'),
    "BrandingEditor must render an AssetUpload for the default product image",
  );
});
check("the editor mirrors the uploaded URL into cfg (Save branding can't clobber it)", () => {
  // The upload writes branding.config server-side; `cfg` is written back
  // wholesale by Save branding, so a stale `cfg` would silently undo the upload.
  const src = read("src/components/admin/BrandingEditor.tsx");
  // The editor mirrors EVERY config-backed asset through one generic helper
  // (mirrorAssetIntoCfg → applyBrandingAsset), so the default product image and
  // the loading-screen mark cannot drift apart in how they survive a save.
  assert.ok(
    src.includes("applyBrandingAsset"),
    "BrandingEditor must merge the uploaded URL into cfg via applyBrandingAsset",
  );
  assert.ok(/setCfg\([\s\S]{0,200}applyBrandingAsset/.test(src), "the merge must go through setCfg");
  assert.ok(
    /mirrorAssetIntoCfg\("defaultProductImage"/.test(src),
    "the default product image must still be mirrored after an upload",
  );
});

// ──────────────────────────── summary ────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
