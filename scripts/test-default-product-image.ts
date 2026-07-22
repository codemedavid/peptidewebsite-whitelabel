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

// ──────────────────────────── summary ────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
