/**
 * Self-contained test for the mstomato category re-file.
 *
 * WHY: that tenant's storefront showed the SEED peptide chips ("Peptides",
 * "GLP-1 Agonists", "Insulin Resistance") because `branding.config.categories`
 * was never saved — `store.tsx` falls back to SEED_CATEGORIES when it is null.
 * Meanwhile its 21 products carried human-readable category LABELS in
 * `metadata.category` ("Vial Cases", "Sample Products"). Catalog.tsx filters
 * with `p.category === category`, where `category` is a category **id**, so no
 * chip ever matched a product. Exactly the bug fix-peppies-categories.ts fixed.
 *
 * The owner asked for two categories — vial caps and vial cases — and chose to
 * add a third, Accessories, for the seven products that are neither.
 *
 * The trap this file exists to catch: "Hard Cartridge Caps – Pen Cartridge"
 * contains the word "Caps" but is NOT a vial cap, and "3 mL Vial Topper" and
 * "Cartridge Spacer" contain "Vial"/"Cartridge" without being either. A naive
 * `name.includes("Caps")` files three products wrongly and the owner only finds
 * out by clicking every chip on the live storefront.
 *
 *   npm run test:mstomato-categories
 */

import assert from "node:assert";

import {
  ACCESSORIES,
  MSTOMATO_CATEGORY_LABELS,
  VIAL_CAPS,
  VIAL_CASES,
  buildMstomatoCategories,
  classifyMstomatoProduct,
} from "./lib/mstomato-categories";

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

/**
 * The live catalog, verbatim (note the en-dash "–" the seller actually typed),
 * with the category each product must land in. This roster IS the spec: if a
 * product is renamed or added, this list is what tells you the classifier needs
 * revisiting rather than the storefront quietly filing it under Accessories.
 */
const CATALOG: readonly [name: string, expected: string][] = [
  ["Hard Vial Caps – 10 mL", VIAL_CAPS],
  ["Hard Vial Caps – 3 mL", VIAL_CAPS],
  ["Soft Vial Caps – 10 mL", VIAL_CAPS],
  ["Soft Vial Caps – 3 mL", VIAL_CAPS],

  ["Single Vial Case – 10 mL", VIAL_CASES],
  ["Single Vial Case – 3 mL", VIAL_CASES],
  ["Single Vial Case – 5 mL", VIAL_CASES],
  ["Single Vial Case – GTT (Fuan & Korean)", VIAL_CASES],
  ["Dual Vial Case – 10 mL + 10 mL", VIAL_CASES],
  ["Dual Vial Case – 10 mL + GTT", VIAL_CASES],
  ["Dual Vial Case – 3 mL + 10 mL", VIAL_CASES],
  ["Dual Vial Case – 3 mL + 3 mL", VIAL_CASES],
  ["Dual Vial Case – 3 mL + GTT", VIAL_CASES],
  ["Dual Vial Case – GTT + GTT", VIAL_CASES],

  ["3 mL Vial Topper – Character Head", ACCESSORIES],
  ["Cartridge Spacer – Pen Cartridge", ACCESSORIES],
  ["Hard Cartridge Caps – Pen Cartridge", ACCESSORIES],
  ["Sample Care Package", ACCESSORIES],
  ["Sample Essentials Organizer", ACCESSORIES],
  ["Sample Gift Box", ACCESSORIES],
  ["Sample Pink Storage Pouch", ACCESSORIES],
];

console.log("\nmstomato category re-file — caps, cases, accessories\n");

// ────────────────────────────── the label set ────────────────────────────────
console.log("the three categories");

check("exactly three labels, in shelf order", () => {
  assert.deepEqual(MSTOMATO_CATEGORY_LABELS, [VIAL_CAPS, VIAL_CASES, ACCESSORIES]);
});

check("the owner's two names are spelled as products read them", () => {
  assert.equal(VIAL_CAPS, "Vial Caps");
  assert.equal(VIAL_CASES, "Vial Cases");
  assert.equal(ACCESSORIES, "Accessories");
});

// ─────────────────────────── the real catalog roster ─────────────────────────
console.log("\nevery live product lands in the right category");

for (const [name, expected] of CATALOG) {
  check(`${name} → ${expected}`, () => {
    assert.equal(classifyMstomatoProduct(name), expected);
  });
}

check("the roster splits 4 caps / 10 cases / 7 accessories (21 total)", () => {
  const tally = CATALOG.reduce<Record<string, number>>((acc, [name]) => {
    const c = classifyMstomatoProduct(name);
    acc[c] = (acc[c] ?? 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(tally, { [VIAL_CAPS]: 4, [VIAL_CASES]: 10, [ACCESSORIES]: 7 });
  assert.equal(CATALOG.length, 21, "the live catalog has 21 products");
});

// ──────────────────── the near-misses that motivated the tests ───────────────
console.log("\nnear-misses that a substring match would get wrong");

check('"Hard Cartridge Caps" is a CAP but not a VIAL cap → Accessories', () => {
  assert.equal(
    classifyMstomatoProduct("Hard Cartridge Caps – Pen Cartridge"),
    ACCESSORIES,
    "matching on 'Caps' alone files a cartridge part under Vial Caps",
  );
});

check('"Vial Topper" contains "Vial" but is neither cap nor case', () => {
  assert.equal(classifyMstomatoProduct("3 mL Vial Topper – Character Head"), ACCESSORIES);
});

check('"Cartridge Spacer" is not a case', () => {
  assert.equal(classifyMstomatoProduct("Cartridge Spacer – Pen Cartridge"), ACCESSORIES);
});

check("a singular product name maps to the plural category label", () => {
  // Products read "Single Vial Case"; the shelf reads "Vial Cases".
  assert.equal(classifyMstomatoProduct("Single Vial Case – 3 mL"), VIAL_CASES);
});

// ──────────────────────────────── robustness ─────────────────────────────────
console.log("\nrobustness");

check("classification ignores case and surrounding whitespace", () => {
  assert.equal(classifyMstomatoProduct("  hard vial caps – 10 ml  "), VIAL_CAPS);
  assert.equal(classifyMstomatoProduct("DUAL VIAL CASE – GTT + GTT"), VIAL_CASES);
});

check("an unknown product falls back to Accessories instead of going unfiled", () => {
  // Never return "" — the product editor rejects a falsy category, and an
  // unfiled product is invisible to every chip on the storefront.
  assert.equal(classifyMstomatoProduct("Mystery Widget 2000"), ACCESSORIES);
});

check("a blank or junk name still yields a real category", () => {
  for (const junk of ["", "   ", "???"]) {
    const got = classifyMstomatoProduct(junk);
    assert.ok(
      MSTOMATO_CATEGORY_LABELS.includes(got),
      `${JSON.stringify(junk)} produced ${JSON.stringify(got)}`,
    );
  }
});

check("every classification is one of the three labels", () => {
  for (const [name] of CATALOG) {
    assert.ok(MSTOMATO_CATEGORY_LABELS.includes(classifyMstomatoProduct(name)), name);
  }
});

// ───────────────────────── the persisted category list ───────────────────────
console.log("\nbuildMstomatoCategories — what gets written to branding.config");

check('the synthetic "all" tab leads the list', () => {
  const cats = buildMstomatoCategories((i) => `cat_test_${i}`);
  assert.equal(cats[0].id, "all", "AdminCategoriesManager always re-stamps 'all' first");
  assert.equal(cats[0].label, "All Products");
});

check("the three real categories follow, in shelf order", () => {
  const cats = buildMstomatoCategories((i) => `cat_test_${i}`);
  assert.deepEqual(
    cats.slice(1).map((c) => c.label),
    [VIAL_CAPS, VIAL_CASES, ACCESSORIES],
  );
  assert.equal(cats.length, 4, "'all' + three real categories");
});

check("ids are unique and none collides with the synthetic tab", () => {
  const cats = buildMstomatoCategories((i) => `cat_test_${i}`);
  const ids = cats.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate category id");
  assert.equal(ids.filter((id) => id === "all").length, 1);
});

check("the id factory is called once per real category", () => {
  const seen: number[] = [];
  buildMstomatoCategories((i) => {
    seen.push(i);
    return `cat_test_${i}`;
  });
  assert.deepEqual(seen, [0, 1, 2]);
});

// ─────────────────────────────── summary ─────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
