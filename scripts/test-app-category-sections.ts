/**
 * Category sections IN THE APP (FEATURES.STORE_CATEGORY_SECTIONS): the shop's
 * sectioned catalog and the store admin's per-category arranger, held to the
 * website's own rules (lib/storefront/category-sections). No DB / network.
 *
 *   npm run test:app-category-sections
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildCategorySections, OTHER_SECTION_ID } from "../src/lib/storefront/category-sections";
import { toShopSections } from "../src/lib/mobile/shop-sections";
import { headerIndex, sectionNav, sectionRows, shownProductCount } from "../mobile/src/features/shop/lib/sections";
import { categoryOrderOf, categoryProducts, moveId } from "../mobile/src/features/admin/catalog/category-arrange";
import type { ShopCatalog, ShopProduct } from "../src/lib/mobile/shop-contract";

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

const CATEGORIES = [
  { id: "all", label: "All Products" },
  { id: "peptides", label: "Peptides" },
  { id: "kits", label: "Kits" },
  { id: "empty", label: "Nothing here" },
];
// Store arrangement = array order (position stamped like arrangeStoreProducts).
const PRODUCTS = [
  { id: "p1", name: "BPC-157", category: "peptides", position: 0, featured: true },
  { id: "p2", name: "TB-500", category: "Peptides", position: 1 }, // loose label match
  { id: "p3", name: "Starter kit", category: "kits", position: 2 },
  { id: "p4", name: "GHK-Cu", category: "peptides", position: 3 },
  { id: "p5", name: "Mystery", category: "unknown", position: 4 }, // → Other
];
const ORDER = { peptides: ["p4", "p1"] };

const shop = (p: { id: string; name: string; category: string }): ShopProduct => ({
  id: p.id,
  name: p.name,
  category: p.category,
  description: "",
  image: null,
  extraImages: [],
  price: 100,
  compareAtPrice: null,
  stock: 5,
  purchasable: true,
  isGroupBuy: false,
  baseSelectable: true,
  variations: [],
});

console.log("\nshop: sectioned catalog");

check("sections are the website's: Featured first, owner's category order, per-category order, Other last", () => {
  const sections = toShopSections(PRODUCTS, CATEGORIES, ORDER);
  assert.deepEqual(
    sections.map((s) => [s.id, s.productIds]),
    [
      ["__featured", ["p1"]],
      ["peptides", ["p4", "p1", "p2"]],
      ["kits", ["p3"]],
      [OTHER_SECTION_ID, ["p5"]],
    ],
  );
  assert.ok(!sections.some((s) => s.id === "empty"), "an empty category is not a section");
});

const catalog: Pick<ShopCatalog, "products" | "sections"> = {
  products: PRODUCTS.map(shop),
  sections: toShopSections(PRODUCTS, CATEGORIES, ORDER),
};

check("the app lays sections out as a header then product pairs", () => {
  const rows = sectionRows(catalog, "");
  assert.deepEqual(
    rows.map((r) => (r.kind === "header" ? `# ${r.label} (${r.count})` : r.products.map((p) => p.id).join(","))),
    ["# Featured (1)", "p1", "# Peptides (3)", "p4,p1", "p2", "# Kits (1)", "p3", "# Other (1)", "p5"],
  );
  assert.deepEqual(sectionNav(rows).map((n) => n.id), ["__featured", "peptides", "kits", OTHER_SECTION_ID]);
  assert.equal(headerIndex(rows, "kits"), 5);
  assert.equal(shownProductCount(rows), 5, "Featured repeats are counted once");
});

check("search narrows each section and drops the ones left empty", () => {
  const rows = sectionRows(catalog, "tb");
  assert.deepEqual(sectionNav(rows).map((n) => n.id), ["peptides"]);
  assert.equal(sectionRows(catalog, "zzz").length, 0);
  assert.equal(sectionRows({ ...catalog, sections: null }, "").length, 0, "no sections = filter-chip catalog");
});

console.log("\nadmin: arrange inside a category");

check("the arranger lists a category exactly as the website's sections order it", () => {
  const web = buildCategorySections(PRODUCTS, CATEGORIES, ORDER);
  for (const id of ["peptides", "kits"]) {
    const app = categoryProducts(PRODUCTS, CATEGORIES, ORDER, id).map((p) => p.id);
    assert.deepEqual(app, web.find((s) => s.id === id)!.products.map((p) => p.id), id);
  }
});

check("moves are one place at a time and never fall off either end", () => {
  assert.deepEqual(moveId(["a", "b", "c"], "c", -1), ["a", "c", "b"]);
  assert.deepEqual(moveId(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
  assert.deepEqual(moveId(["a", "b", "c"], "x", 1), ["a", "b", "c"]);
});

check("the saved map is read defensively", () => {
  assert.deepEqual(categoryOrderOf({ categoryProductOrder: { a: ["1", 2, "3"], b: "junk" } }), { a: ["1", "3"] });
  assert.deepEqual(categoryOrderOf({ categoryProductOrder: [] }), {});
  assert.deepEqual(categoryOrderOf(undefined), {});
});

console.log("\nwiring");
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

check("the catalog ships sections only with the grant", () => {
  const src = read("src/lib/mobile/shop-catalog.ts");
  assert.ok(src.includes("brand.categorySectionsEntitled === true"));
  assert.ok(src.includes("toShopSections("));
});

check("the bridge allows the per-category save, and the app calls it", () => {
  assert.ok(read("src/lib/mobile/admin-bridge.ts").includes("saveCategoryProductOrderAction: storefrontAdmin.saveCategoryProductOrderAction"));
  assert.ok(read("mobile/src/app/(app)/manage/category-arrange.tsx").includes('"saveCategoryProductOrderAction", categoryId, next'));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
