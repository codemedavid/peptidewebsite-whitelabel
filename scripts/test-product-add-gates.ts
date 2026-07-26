/**
 * Tests for the two gates that decide whether a store owner can add a product.
 *
 * Grounding — the K Glow incident (tenant `k-glow`, 2026-07-21 → 2026-07-26):
 * the owner deleted every seeded category in the Categories manager. That
 * manager's `persist` always re-stamps the synthetic "all" tab, so
 * branding.config.categories became exactly `[{id:"all"}]` — non-null, which
 * defeats the `brandSeed.categories ?? SEED_CATEGORIES` fallback in store.tsx.
 * With zero SELECTABLE categories the Add Product form's Save button is
 * permanently disabled (`canSave` requires `category`) and saveProductAction
 * would reject with "Please choose a category." The store sat with 31 seeded
 * products and a dead Save button for five days.
 *
 *   1. resolveSelectableCategories — a tenant with no real categories always
 *      gets one assignable fallback, so Add Product is never a dead end.
 *   2. normalizeProductInput must carry the editor's "Order ratio class"
 *      (productClass) through to productToDbWrite. It previously dropped the
 *      key, so the dropdown was a no-op AND editing a seeded product wiped its
 *      existing class — which silently changes Order Ratio Control behaviour.
 *
 *   npm run test:product-add-gates
 */

import assert from "node:assert";

import {
  UNCATEGORIZED_CATEGORY,
  resolveSelectableCategories,
} from "../src/lib/storefront/categories";
import { normalizeProductInput } from "../src/lib/storefront/product-input";
import { productToDbWrite } from "../src/lib/storefront/product-mapping";
import type { Category } from "../src/storefront/types";

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

const ALL: Category = { id: "all", label: "All Products" };
const PEP: Category = { id: "cat_pep", label: "Peptides" };

console.log("\nresolveSelectableCategories — Add Product must never be a dead end");

check("the k-glow state ([all] only) still yields one assignable category", () => {
  const out = resolveSelectableCategories([ALL]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, UNCATEGORIZED_CATEGORY.id);
});

check("a completely empty list yields the fallback", () => {
  assert.deepEqual(resolveSelectableCategories([]), [UNCATEGORIZED_CATEGORY]);
});

check("an absent/undefined list yields the fallback", () => {
  assert.deepEqual(resolveSelectableCategories(undefined), [UNCATEGORIZED_CATEGORY]);
});

check("the synthetic 'all' tab is never assignable", () => {
  assert.ok(!resolveSelectableCategories([ALL, PEP]).some((c) => c.id === "all"));
});

check("real categories are returned untouched, with no fallback injected", () => {
  const out = resolveSelectableCategories([ALL, PEP]);
  assert.deepEqual(out, [PEP]);
});

check("the fallback id is a real, saveable category id", () => {
  // saveProductAction rejects a falsy category, so the fallback must be truthy
  // and must survive normalizeProductInput's 64-char cap unchanged.
  assert.ok(UNCATEGORIZED_CATEGORY.id.length > 0);
  assert.equal(
    normalizeProductInput({ name: "X", category: UNCATEGORIZED_CATEGORY.id }).category,
    UNCATEGORIZED_CATEGORY.id,
  );
});

console.log("\nnormalizeProductInput — the editor's Order ratio class must survive");

check("productClass 'peptide' survives normalization", () => {
  assert.equal(
    normalizeProductInput({ name: "BPC-157", productClass: "peptide" }).productClass,
    "peptide",
  );
});

check("productClass 'bacWater' survives normalization", () => {
  assert.equal(
    normalizeProductInput({ name: "Bac Water", productClass: "bacWater" }).productClass,
    "bacWater",
  );
});

check("productClass 'other' survives normalization", () => {
  // The strongest case: "other" on a peptide-sounding name is exactly the
  // override the name heuristic would get wrong (cf. 5-Amino-1MQ on k-glow).
  assert.equal(
    normalizeProductInput({ name: "5-Amino-1MQ", productClass: "other" }).productClass,
    "other",
  );
});

check("an unknown productClass is dropped, not passed through raw", () => {
  assert.equal(normalizeProductInput({ name: "X", productClass: "banana" }).productClass, undefined);
});

check("an absent productClass stays undefined (name heuristic still decides)", () => {
  assert.equal(normalizeProductInput({ name: "X" }).productClass, undefined);
});

check("productClass reaches the DB metadata through the full save pipeline", () => {
  const p = normalizeProductInput({
    name: "5-Amino-1MQ",
    category: "cat_pep",
    price: 2800,
    productClass: "other",
  });
  const write = productToDbWrite(p, "PHP", "₱");
  assert.equal((write.metadata as Record<string, unknown>).productClass, "other");
});

check("editing a classified product does not wipe its class", () => {
  // The regression that bit k-glow's seeded on-hand rows: the editor round-trips
  // the product, so a dropped key silently re-classifies it on every save.
  const seeded = { name: "AOD-9604", category: "cat_pep", price: 5100, productClass: "peptide" };
  const write = productToDbWrite(normalizeProductInput(seeded), "PHP", "₱");
  assert.equal((write.metadata as Record<string, unknown>).productClass, "peptide");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
