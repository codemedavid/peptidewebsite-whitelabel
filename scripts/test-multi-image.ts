/**
 * Self-contained test for MULTIPLE IMAGES per product and per variation.
 *
 * WHY (2026-09-30): a product had exactly one photo, and a variation at most
 * one. Sellers asked for several — front/back/label shots of a vial, several
 * angles of a colorway. The model keeps `image` as the MAIN photo (every
 * existing reader — cart thumbs, share previews, exports, Card Studio — stays
 * correct untouched) and adds `extraImages` alongside it, on the product and on
 * each variation.
 *
 * The rules that carry the risk:
 *
 *   1. Persistence. Product photos ride the existing `images` column as
 *      [main, ...extras]; variation photos ride metadata.variations[]. Both
 *      coercion layers (normalizeProductInput AND cleanVariations) must carry
 *      the key — normalizeProductInput rebuilds each variation, and a key it
 *      omits is destroyed before the mapping layer sees it (the exact bug that
 *      once ate every variation `image`).
 *
 *   2. Hygiene. Extras are tenant-editable and land in an <img src>: only
 *      http(s), no duplicates (of each other or of the main photo), capped.
 *
 *   3. Gallery binding. Every photo of a variation carries that variation's
 *      option index, so swiping to its 2nd photo still selects it; the
 *      product's own extras carry `null` and select nothing.
 *
 *   4. Non-regression. A product with one photo and no variation photos still
 *      yields ONE slide, so the card renders exactly as before.
 *
 *   npm run test:multi-image
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MAX_PHOTOS_PER_ITEM,
  cleanExtraImages,
  photoList,
} from "../src/lib/storefront/product-photos";
import { buildProductGallery, hasGallery } from "../src/lib/storefront/product-gallery";
import {
  dbProductToStorefront,
  productToDbWrite,
  type DbProductRow,
} from "../src/lib/storefront/product-mapping";
import { normalizeProductInput } from "../src/lib/storefront/product-input";
import type { Product } from "../src/storefront/types";
import {
  draftFromProduct,
  makeMainPhoto,
  MAX_EXTRA_PHOTOS,
  toSavePayload,
  withMainPhoto,
} from "../mobile/src/features/admin/catalog/product-form";

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

const A = "https://ik.imagekit.io/t/a.jpg";
const B = "https://ik.imagekit.io/t/b.jpg";
const C = "https://ik.imagekit.io/t/c.jpg";
const D = "https://ik.imagekit.io/t/d.jpg";

function baseProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Case",
    description: "A case",
    price: 0,
    currency: "₱",
    purity: "",
    category: "cases",
    featured: false,
    image: A,
    ...overrides,
  };
}

/** Save → DB row → read back, the way the admin editor's save round-trips. */
function roundTrip(p: Product): Product {
  const write = productToDbWrite(p, "PHP", "₱");
  const row: DbProductRow = {
    id: p.id,
    sku: "sku",
    name: write.name,
    description: write.description,
    priceCents: write.priceCents,
    currency: write.currency,
    slug: "case",
    images: write.images,
    stock: write.stock,
    status: write.status,
    active: write.active,
    metadata: write.metadata,
  };
  return dbProductToStorefront(row, "₱");
}

console.log("\n1. Pure helpers (product-photos.ts)");

check("cleanExtraImages keeps http(s) only, dedupes, drops the main photo", () => {
  const out = cleanExtraImages(
    [B, "data:image/png;base64,xx", "javascript:alert(1)", B, A, `  ${C}  `, 42, null],
    A,
  );
  assert.deepStrictEqual(out, [B, C]);
});

check("cleanExtraImages caps the list so main + extras ≤ MAX_PHOTOS_PER_ITEM", () => {
  const many = Array.from({ length: 30 }, (_, i) => `https://x.io/${i}.jpg`);
  assert.strictEqual(cleanExtraImages(many, A).length, MAX_PHOTOS_PER_ITEM - 1);
});

check("cleanExtraImages tolerates a non-array", () => {
  assert.deepStrictEqual(cleanExtraImages("nope", A), []);
  assert.deepStrictEqual(cleanExtraImages(undefined, null), []);
});

check("photoList promotes the first extra when there is no main photo", () => {
  assert.deepStrictEqual(photoList(null, [B, C]), [B, C]);
  assert.deepStrictEqual(photoList(A, [B]), [A, B]);
  assert.deepStrictEqual(photoList(null, []), []);
});

console.log("\n2. Product persistence (product-mapping.ts)");

check("extra product photos persist in the images column after the main", () => {
  const write = productToDbWrite(baseProduct({ extraImages: [B, C] }), "PHP", "₱");
  assert.deepStrictEqual(write.images, [A, B, C]);
});

check("a DB row with several images reads back as main + extras", () => {
  const back = roundTrip(baseProduct({ extraImages: [B, C] }));
  assert.strictEqual(back.image, A);
  assert.deepStrictEqual(back.extraImages, [B, C]);
});

check("legacy single-image rows read back with no extras", () => {
  const back = roundTrip(baseProduct());
  assert.strictEqual(back.image, A);
  assert.deepStrictEqual(back.extraImages ?? [], []);
});

check("removing the main photo promotes the first extra instead of losing it", () => {
  const back = roundTrip(baseProduct({ image: null, extraImages: [B, C] }));
  assert.strictEqual(back.image, B);
  assert.deepStrictEqual(back.extraImages, [C]);
});

console.log("\n3. Variation persistence (both coercion layers)");

check("variation extraImages survive productToDbWrite → dbProductToStorefront", () => {
  const back = roundTrip(
    baseProduct({
      variations: [
        { name: "Silk Barbie", price: 100, image: B, extraImages: [C, D] },
        { name: "Roseberry", price: 100 },
      ],
    }),
  );
  assert.deepStrictEqual(back.variations?.[0].extraImages, [C, D]);
  assert.strictEqual(back.variations?.[1].extraImages, undefined, "no empty [] persisted");
});

check("a variation with extras but no main photo gets the first one promoted", () => {
  const back = roundTrip(
    baseProduct({ variations: [{ name: "Silk", price: 100, extraImages: [C, D] }] }),
  );
  assert.strictEqual(back.variations?.[0].image, C);
  assert.deepStrictEqual(back.variations?.[0].extraImages, [D]);
});

check("normalizeProductInput keeps product AND variation extras (the save path)", () => {
  const p = normalizeProductInput({
    name: "Case",
    image: A,
    extraImages: [B, "data:x", B],
    variations: [{ name: "Silk", price: 1, image: C, extraImages: [D, "javascript:x"] }],
  });
  assert.deepStrictEqual(p.extraImages, [B]);
  assert.deepStrictEqual(p.variations?.[0].extraImages, [D]);
});

console.log("\n4. Gallery slides (product-gallery.ts)");

check("a product's own extra photos become a gallery that selects nothing", () => {
  const slides = buildProductGallery(baseProduct({ price: 100, extraImages: [B, C] }));
  assert.deepStrictEqual(
    slides.map((s) => [s.src, s.optionIndex]),
    [
      [A, null],
      [B, null],
      [C, null],
    ],
  );
  assert.ok(hasGallery(slides));
});

check("every photo of a variation carries that variation's option index", () => {
  const slides = buildProductGallery(
    baseProduct({
      price: 100,
      variations: [
        { name: "Silk", price: 100, image: B, extraImages: [C] },
        { name: "Rose", price: 100, image: D },
      ],
    }),
  );
  assert.deepStrictEqual(
    slides.map((s) => [s.src, s.optionIndex]),
    [
      [A, null],
      [B, 0],
      [C, 0],
      [D, 1],
    ],
  );
});

check("option indexes still account for a prepended 'Standard' option", () => {
  // Base price 50 is distinct from every variation price, so buildProductOptions
  // prepends "Standard" — Silk is option 1, not 0.
  const slides = buildProductGallery(
    baseProduct({
      price: 50,
      variations: [{ name: "Silk", price: 100, image: B, extraImages: [C] }],
    }),
  );
  assert.deepStrictEqual(
    slides.filter((s) => s.optionIndex !== null).map((s) => s.optionIndex),
    [1, 1],
  );
});

check("non-regression: one photo, no variation photos → one slide, no gallery", () => {
  const slides = buildProductGallery(baseProduct({ price: 100 }));
  assert.strictEqual(slides.length, 1);
  assert.ok(!hasGallery(slides));
});

console.log("\n5. Wiring guards");

const root = join(__dirname, "..");
const catalog = readFileSync(join(root, "src/storefront/components/Catalog.tsx"), "utf8");
const editor = readFileSync(join(root, "src/storefront/admin/AdminAddProduct.tsx"), "utf8");

check("the pill→scroll effect doesn't yank a variation's 2nd photo back to its 1st", () => {
  assert.match(
    catalog,
    /slides\[activeRef\.current\]\?\.optionIndex === selectedIndex/,
    "ProductGallery must skip scrolling when the visible slide already shows the selected option",
  );
});

check("the admin editor sends product and variation extraImages", () => {
  assert.match(editor, /extraImages:\s*productExtras/, "product extras not in the save payload");
  assert.match(editor, /PhotoStrip/, "no multi-photo control in the editor");
});

console.log("\n6. Other writers carry extras through");

check("a save from the Expo app keeps product AND variation extras it can't edit", () => {
  const initial = baseProduct({
    extraImages: [B, C],
    variations: [{ name: "Silk", price: 100, image: B, extraImages: [D] }],
  });
  const payload = toSavePayload(draftFromProduct(initial, "cases"), initial, "₱");
  assert.deepStrictEqual(payload.extraImages, [B, C]);
  assert.deepStrictEqual(payload.variations?.[0].extraImages, [D]);
});

console.log("\n7. The Expo app edits extra photos");

const appEditor = readFileSync(join(root, "mobile/src/app/(app)/manage/product-edit.tsx"), "utf8");
const appParts = readFileSync(join(root, "mobile/src/features/admin/catalog/ProductEditorParts.tsx"), "utf8");

check("the app's extras cap matches the website's", () => {
  assert.strictEqual(MAX_EXTRA_PHOTOS, MAX_PHOTOS_PER_ITEM - 1);
});

check("product extras edited in the app are what gets saved", () => {
  const initial = baseProduct({ extraImages: [B, C] });
  const draft = { ...draftFromProduct(initial, "cases"), extraImages: [C, D] };
  assert.deepStrictEqual(toSavePayload(draft, initial, "₱").extraImages, [C, D]);
});

check("a new product added in the app saves its extras", () => {
  const draft = { ...draftFromProduct(null, "cases"), name: "X", extraImages: [B] };
  assert.deepStrictEqual(toSavePayload(draft, null, "₱").extraImages, [B]);
});

check("variation extras edited in the app are saved", () => {
  const initial = baseProduct({ variations: [{ name: "Silk", price: 100, image: B }] });
  const draft = draftFromProduct(initial, "cases");
  const edited = { ...draft, variations: draft.variations.map((v) => ({ ...v, extraImages: [C, D] })) };
  assert.deepStrictEqual(toSavePayload(edited, initial, "₱").variations?.[0].extraImages, [C, D]);
});

check("makeMainPhoto swaps an extra into main and keeps the old main as an extra", () => {
  assert.deepStrictEqual(makeMainPhoto(A, [B, C], C), { image: C, extraImages: [A, B] });
});

check("makeMainPhoto with no main just promotes", () => {
  assert.deepStrictEqual(makeMainPhoto("", [B, C], B), { image: B, extraImages: [C] });
});

check("makeMainPhoto does not keep a local data: preview as an extra", () => {
  assert.deepStrictEqual(makeMainPhoto("data:image/png;base64,xx", [B], B), { image: B, extraImages: [] });
});

check("photos added with no main photo promote the first to main", () => {
  assert.deepStrictEqual(withMainPhoto("", [B, C]), { image: B, extraImages: [C] });
  assert.deepStrictEqual(withMainPhoto(A, [B]), { image: A, extraImages: [B] });
});

check("the app editor has a multi-photo control for the product and each variation", () => {
  assert.match(appParts, /export function PhotoStrip/, "no PhotoStrip in ProductEditorParts");
  assert.match(appEditor, /<PhotoStrip/, "product-edit doesn't render the product gallery");
  assert.match(appParts, /<PhotoStrip[\s\S]*?extraImages/, "VariationsEditor doesn't render per-option extras");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
