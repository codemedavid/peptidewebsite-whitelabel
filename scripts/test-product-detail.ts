/**
 * Self-contained gate for the storefront "click a product card to see the full
 * detail" feature. Before this, a product card exposed only a 2-line clamped
 * description and the buy controls — the customer had no way to read the full
 * description or the spec fields (molecular weight, CAS, sequence, storage,
 * sizes) the seller filled in. Clicking the card now opens a quick-view modal
 * built from these pure helpers.
 *
 * Runs the REAL pure helpers (no DB, no React runtime):
 *
 *   - src/lib/storefront/product-detail.ts
 *       productSpecRows(product)  — the ordered, present-only spec rows the
 *           detail modal lists. Empty/whitespace fields are dropped so the modal
 *           never shows a blank "CAS: —" row.
 *       buildProductDetail(product, defaultImage) — the full view model the
 *           modal renders: resolved image, options (reusing buildProductOptions),
 *           purity, stock/buyability, price-on-request, and the spec rows.
 *
 * Plus structural checks that the card is actually wired to open the modal
 * (an import passing type-check is not proof the JSX uses it):
 *
 *   - src/storefront/components/Catalog.tsx renders ProductDetailModal and the
 *       card calls onOpenDetail.
 *
 *   npm run test:product-detail
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Product } from "../src/storefront/types";
import {
  buildProductDetail,
  productSpecRows,
} from "../src/lib/storefront/product-detail";

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
    console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

// A minimal catalog product; only the fields under test are set per case.
const baseProduct = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  name: "Tirzepatide",
  description: "A very long research-only description that the card clamps to two lines.",
  price: 2500,
  currency: "₱",
  category: "peptides",
  featured: false,
  image: null,
  stock: 5,
  ...over,
});

console.log("\nProduct detail — quick-view modal view model\n");

// ───────────────────────────── productSpecRows ──────────────────────────────
console.log("productSpecRows");

check("a product with no spec fields lists nothing", () => {
  assert.deepEqual(productSpecRows(baseProduct()), []);
});

check("lists only the fields the seller actually filled in", () => {
  const rows = productSpecRows(
    baseProduct({ molecularWeight: "4813.5 g/mol", cas: "2023788-19-2" }),
  );
  assert.deepEqual(rows, [
    { label: "Molecular Weight", value: "4813.5 g/mol" },
    { label: "CAS Number", value: "2023788-19-2" },
  ]);
});

check("keeps the canonical field order regardless of object key order", () => {
  const rows = productSpecRows(
    baseProduct({
      sizes: "10ml",
      storage: "-20°C",
      sequence: "AB-CD",
      cas: "1-2-3",
      molecularWeight: "100",
    }),
  );
  assert.deepEqual(
    rows.map((r) => r.label),
    ["Molecular Weight", "CAS Number", "Sequence", "Storage", "Sizes"],
  );
});

check("drops a blank/whitespace-only field instead of showing an empty row", () => {
  const rows = productSpecRows(baseProduct({ cas: "   ", storage: "" }));
  assert.deepEqual(rows, []);
});

check("trims surrounding whitespace off the value it shows", () => {
  const rows = productSpecRows(baseProduct({ storage: "  -20°C  " }));
  assert.deepEqual(rows, [{ label: "Storage", value: "-20°C" }]);
});

// ──────────────────────────── buildProductDetail ────────────────────────────
console.log("buildProductDetail");

check("carries the identity + full (unclamped) description through", () => {
  const p = baseProduct({ description: "Full text the modal shows in whole." });
  const d = buildProductDetail(p);
  assert.equal(d.id, "p1");
  assert.equal(d.name, "Tirzepatide");
  assert.equal(d.description, "Full text the modal shows in whole.");
  assert.equal(d.currency, "₱");
  assert.equal(d.basePrice, 2500);
});

check("resolves the brand default image when the product has none", () => {
  const d = buildProductDetail(baseProduct({ image: null }), "https://cdn/x.jpg");
  assert.equal(d.image, "https://cdn/x.jpg");
});

check("the product's own image wins over the brand default", () => {
  const d = buildProductDetail(
    baseProduct({ image: "https://cdn/own.jpg" }),
    "https://cdn/default.jpg",
  );
  assert.equal(d.image, "https://cdn/own.jpg");
});

check("reuses buildProductOptions — variations flow into the modal picker", () => {
  const d = buildProductDetail(
    baseProduct({ price: 1500, variations: [{ name: "10mg", price: 2500 }] }),
  );
  assert.equal(d.showOptions, true);
  assert.deepEqual(d.options, [
    { name: "Standard", price: 1500 },
    { name: "10mg", price: 2500, variation: { name: "10mg", price: 2500 } },
  ]);
});

check("no variations → no picker and an empty option list", () => {
  const d = buildProductDetail(baseProduct());
  assert.equal(d.showOptions, false);
  assert.deepEqual(d.options, []);
});

check("flags out-of-stock so the modal disables its Add to Cart", () => {
  const d = buildProductDetail(baseProduct({ stock: 0 }));
  assert.equal(d.outOfStock, true);
  assert.equal(d.stock, 0);
});

check("a negative/absent stock is clamped to 0 (out of stock), never negative", () => {
  assert.equal(buildProductDetail(baseProduct({ stock: -3 })).stock, 0);
  assert.equal(buildProductDetail(baseProduct({ stock: undefined })).stock, 0);
  assert.equal(buildProductDetail(baseProduct({ stock: undefined })).outOfStock, true);
});

check("surfaces price-on-request so the modal hides the price + blocks buying", () => {
  const d = buildProductDetail(baseProduct({ priceOnRequest: true }));
  assert.equal(d.priceOnRequest, true);
});

check("carries purity through, and null when absent", () => {
  assert.equal(buildProductDetail(baseProduct({ purity: "99%" })).purity, "99%");
  assert.equal(buildProductDetail(baseProduct()).purity, null);
});

check("includes the spec rows so the modal shows richer detail than the card", () => {
  const d = buildProductDetail(baseProduct({ cas: "1-2-3" }));
  assert.deepEqual(d.specs, [{ label: "CAS Number", value: "1-2-3" }]);
});

check("does not mutate the product it reads", () => {
  const p = baseProduct({ cas: "1-2-3", variations: [{ name: "10mg", price: 2500 }] });
  const before = JSON.stringify(p);
  buildProductDetail(p, "https://cdn/x.jpg");
  assert.equal(JSON.stringify(p), before, "buildProductDetail mutated its input");
});

// ─────────────────────── structural wiring in Catalog.tsx ────────────────────
console.log("Catalog card → modal wiring");

const catalogSrc = readFileSync(
  join(process.cwd(), "src/storefront/components/Catalog.tsx"),
  "utf8",
);

check("the card exposes an onOpenDetail handler", () => {
  assert.ok(
    /onOpenDetail/.test(catalogSrc),
    "ProductCard has no onOpenDetail prop — the card cannot open the detail modal",
  );
});

check("the card's media/name actually invokes onOpenDetail (it is clickable)", () => {
  assert.ok(
    /onClick=\{\(\)\s*=>\s*onOpenDetail/.test(catalogSrc) ||
      /onClick=\{onOpenDetail/.test(catalogSrc),
    "no onClick wired to onOpenDetail — the card is still not clickable",
  );
});

check("the catalog renders the ProductDetailModal", () => {
  assert.ok(
    /<ProductDetailModal/.test(catalogSrc),
    "ProductDetailModal is not rendered by the catalog",
  );
});

check("the modal is driven by a selected-product state, cleared on close", () => {
  // The initializer may be a lazy one — a shared /p/<slug> link seeds the state
  // on the first render so the modal is in the server HTML (see
  // scripts/test-product-link.ts). What matters here is that the state exists
  // and that closing clears it.
  assert.ok(
    /useState<Product \| null>\((null|\(\) =>)/.test(catalogSrc),
    "no selected-product state — the modal has nothing to open/close on",
  );
  assert.ok(
    /setSelected\(null\)/.test(catalogSrc),
    "closing the modal never clears the selected product",
  );
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
