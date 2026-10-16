// Self-contained test gate for owner-uploaded category images: the picture a
// category's round badge / tile shows on the storefront home.
//
//   npm run test:category-images
//
// Covers: sanitising the stored image (only a plain image URL survives — a
// javascript: or oversized data: URL in config never reaches <img>), the
// immutable set/clear helper the admin uses, the storefront tile preferring the
// owner's image over the automatic product photo (and falling back to it), and
// that every writer keeps the image instead of silently dropping it.

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { categoryImage, withCategoryImage } from "../src/lib/storefront/categories";
import { buildCategoryTiles } from "../src/lib/storefront/boutique-home";
import type { Category, Product } from "../src/storefront/types";

const ROOT = join(__dirname, "..");
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

const IK = (n: string) => `https://ik.imagekit.io/demo/${n}.png`;
const product = (p: Partial<Product> & { id: string }): Product =>
  ({ name: p.id, price: 100, stock: 5, category: "peptides", ...p }) as Product;

// ── categoryImage ────────────────────────────────────────────────────────────
console.log("\ncategoryImage — only a plain image URL survives");

check("a hosted https image is kept (trimmed)", () => {
  assert.equal(categoryImage(`  ${IK("vials")}  `), IK("vials"));
});

check("blank / missing / non-string → no image", () => {
  assert.equal(categoryImage(""), undefined);
  assert.equal(categoryImage("   "), undefined);
  assert.equal(categoryImage(undefined), undefined);
  assert.equal(categoryImage(42), undefined);
});

check("unsafe schemes are refused", () => {
  assert.equal(categoryImage("javascript:alert(1)"), undefined);
  assert.equal(categoryImage("data:text/html;base64,PHNjcmlwdD4="), undefined);
  assert.equal(categoryImage("ftp://example.com/x.png"), undefined);
});

// ── withCategoryImage ────────────────────────────────────────────────────────
console.log("\nwithCategoryImage — the admin's set / clear, immutable");

const CATS: Category[] = [
  { id: "peptides", label: "Peptides" },
  { id: "skincare", label: "Skincare", image: IK("old") },
];

check("sets an image on the matching category only", () => {
  const next = withCategoryImage(CATS, "peptides", IK("new"));
  assert.equal(next[0].image, IK("new"));
  assert.equal(next[1].image, IK("old"));
});

check("clearing removes the key entirely (back to automatic)", () => {
  const next = withCategoryImage(CATS, "skincare", undefined);
  assert.ok(!("image" in next[1]), "no empty image key left behind");
  assert.equal(next[1].label, "Skincare");
});

check("an unsafe image is treated as a clear, never stored", () => {
  const next = withCategoryImage(CATS, "skincare", "javascript:alert(1)");
  assert.ok(!("image" in next[1]));
});

check("never mutates the input list", () => {
  const snapshot = JSON.stringify(CATS);
  withCategoryImage(CATS, "peptides", IK("new"));
  withCategoryImage(CATS, "skincare", undefined);
  assert.equal(JSON.stringify(CATS), snapshot);
});

// ── buildCategoryTiles ───────────────────────────────────────────────────────
console.log("\nbuildCategoryTiles — the owner's image wins, the product photo is the fallback");

const PRODUCTS = [
  product({ id: "a", category: "peptides", image: IK("product-a") }),
  product({ id: "b", category: "skincare", image: IK("product-b") }),
];

const SHOWCASE = { categoryImages: true } as const;

check("Showcase: an uploaded category image is the tile's picture", () => {
  const tiles = buildCategoryTiles(PRODUCTS, [{ id: "peptides", label: "Peptides", image: IK("cat") }], null, SHOWCASE);
  assert.equal(tiles[0].image, IK("cat"));
});

check("other layouts ignore uploaded category images (Showcase-only feature)", () => {
  const tiles = buildCategoryTiles(PRODUCTS, [{ id: "peptides", label: "Peptides", image: IK("cat") }]);
  assert.equal(tiles[0].image, IK("product-a"), "Boutique keeps its automatic product photo");
});

check("no uploaded image → the first product photo, as before", () => {
  const tiles = buildCategoryTiles(PRODUCTS, [{ id: "skincare", label: "Skincare" }], null, SHOWCASE);
  assert.equal(tiles[0].image, IK("product-b"));
});

check("an unsafe stored image falls back to the product photo", () => {
  const tiles = buildCategoryTiles(PRODUCTS, [
    { id: "peptides", label: "Peptides", image: "javascript:alert(1)" },
  ], null, SHOWCASE);
  assert.equal(tiles[0].image, IK("product-a"));
});

check("an image never makes an EMPTY category show up", () => {
  const tiles = buildCategoryTiles(PRODUCTS, [{ id: "empty", label: "Empty", image: IK("cat") }], null, SHOWCASE);
  assert.equal(tiles.length, 0);
});

// ── Writers keep the image ───────────────────────────────────────────────────
console.log("\nwriters — saving categories never drops the image");

check("the server's category save keeps a sanitised image", () => {
  const src = readFileSync(join(ROOT, "src/actions/storefront-admin.ts"), "utf8");
  const fn = src.slice(src.indexOf("function normalizeCategories"));
  assert.ok(/categoryImage\(/.test(fn.slice(0, 1200)), "normalizeCategories passes image through categoryImage()");
});

check("the store admin's Categories screen can upload and clear an image", () => {
  const src = readFileSync(join(ROOT, "src/storefront/admin/AdminCategoriesManager.tsx"), "utf8");
  assert.ok(src.includes("uploadStorefrontImageAction"), "uploads through the store's own media action");
  assert.ok(src.includes("withCategoryImage"), "sets / clears through the shared helper");
  assert.ok(/isShowcaseLayout\(brand\.homeLayout\)/.test(src), "the picker shows only for the Showcase layout");
});

check("only the Showcase home asks for category images", () => {
  const showcase = readFileSync(join(ROOT, "src/storefront/components/ShowcaseHome.tsx"), "utf8");
  assert.ok(/categoryImages:\s*true/.test(showcase), "ShowcaseHome opts in");
  for (const file of ["src/storefront/components/BoutiqueHome.tsx", "src/storefront/StorefrontApp.tsx"]) {
    assert.ok(!/categoryImages:\s*true/.test(readFileSync(join(ROOT, file), "utf8")), `${file} must not opt in`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
