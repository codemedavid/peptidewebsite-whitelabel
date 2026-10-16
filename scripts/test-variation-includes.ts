/**
 * Self-contained test for per-variation "what's included" lists.
 *
 * WHY (peppylab, 2026-10-17): sellers wrote "Complete Set includes: • 10ml vial
 * • 10 pcs syringes …" into the product DESCRIPTION, so a customer who picked
 * "Vial only" was still told the syringes, pads and case came with it. Each
 * variation now carries its own `includes` text, shown only while that option
 * is the one selected.
 *
 * Three layers are covered:
 *   1. The pure helpers in src/lib/storefront/variations.ts
 *        parseIncludes(text)            → the bullet lines
 *        selectedIncludes(options, idx) → the lines for the picked option
 *   2. Persistence: normalizeProductInput + productToDbWrite + dbProductToStorefront
 *      keep the text (and drop a blank one), so an admin save cannot erase it.
 *   3. Structural guards: the card, the detail modal and the admin editor
 *      actually wire it up.
 *
 *   npm run test:variation-includes
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildProductOptions,
  parseIncludes,
  selectedIncludes,
  MAX_INCLUDES_LENGTH,
} from "../src/lib/storefront/variations";
import { normalizeProductInput } from "../src/lib/storefront/product-input";
import {
  dbProductToStorefront,
  productToDbWrite,
  type DbProductRow,
} from "../src/lib/storefront/product-mapping";
import type { Product } from "../src/storefront/types";

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

const SET_TEXT = "• 10ml Lipo Vela vial\n- 10 pcs Insulin syringes\n\n* 20 pcs Alcohol Pads\n1 Big Clear Hard Case";

const lipoVela = (variations: Product["variations"]) =>
  ({ price: 899, variations }) as Parameters<typeof buildProductOptions>[0];

console.log("\nVariation includes — shown only for the picked option\n");

console.log("1. parseIncludes");

check("splits lines, strips bullet markers, drops blank lines", () => {
  assert.deepEqual(parseIncludes(SET_TEXT), [
    "10ml Lipo Vela vial",
    "10 pcs Insulin syringes",
    "20 pcs Alcohol Pads",
    "1 Big Clear Hard Case",
  ]);
});

check("handles CRLF line endings", () => {
  assert.deepEqual(parseIncludes("a\r\nb"), ["a", "b"]);
});

check("empty / missing / non-string → []", () => {
  assert.deepEqual(parseIncludes(""), []);
  assert.deepEqual(parseIncludes("   \n \n"), []);
  assert.deepEqual(parseIncludes(undefined), []);
  assert.deepEqual(parseIncludes(42 as unknown as string), []);
});

console.log("\n2. selectedIncludes");

const options = buildProductOptions(
  lipoVela([
    { name: "Vial only", price: 899 },
    { name: "Complete Set", price: 1099, includes: SET_TEXT },
  ]),
);

check("nothing picked → nothing shown", () => {
  assert.deepEqual(selectedIncludes(options, -1), []);
});

check("Vial only picked → nothing shown (the bug)", () => {
  assert.deepEqual(selectedIncludes(options, 0), []);
});

check("Complete Set picked → its list", () => {
  assert.equal(selectedIncludes(options, 1).length, 4);
  assert.equal(selectedIncludes(options, 1)[3], "1 Big Clear Hard Case");
});

check("out-of-range index → []", () => {
  assert.deepEqual(selectedIncludes(options, 9), []);
});

check("a 'Standard' base option has no includes", () => {
  const opts = buildProductOptions(
    lipoVela([{ name: "Complete Set", price: 1099, includes: "x" }]),
  );
  assert.equal(opts[0].name, "Standard");
  assert.deepEqual(selectedIncludes(opts, 0), []);
  assert.deepEqual(selectedIncludes(opts, 1), ["x"]);
});

console.log("\n3. Persistence round-trip");

function roundTrip(p: Product): Product {
  const write = productToDbWrite(p, "PHP", "₱");
  const row: DbProductRow = {
    id: p.id,
    sku: "sku",
    name: write.name,
    description: write.description,
    priceCents: write.priceCents,
    currency: write.currency,
    slug: "lipo-vela",
    images: write.images,
    stock: write.stock,
    status: write.status,
    active: write.active,
    metadata: write.metadata,
  };
  return dbProductToStorefront(row, "₱");
}

const saved = roundTrip(
  normalizeProductInput({
    id: "p1",
    name: "Lipo Vela",
    price: 899,
    stock: 5,
    variations: [
      { name: "Vial only", price: 899, includes: "   " },
      { name: "Complete Set", price: 1099, includes: `  ${SET_TEXT}  ` },
    ],
  }),
);

check("includes survives normalize → write → read (trimmed)", () => {
  assert.equal(saved.variations?.[1].includes, SET_TEXT);
});

check("a blank includes is not stored", () => {
  assert.equal("includes" in (saved.variations?.[0] ?? {}), false);
});

check("includes is capped", () => {
  const long = normalizeProductInput({
    name: "x",
    variations: [{ name: "a", price: 1, includes: "y".repeat(MAX_INCLUDES_LENGTH + 500) }],
  });
  assert.equal(long.variations?.[0].includes?.length, MAX_INCLUDES_LENGTH);
});

console.log("\n4. Wiring guards");

const root = join(__dirname, "..");
const catalog = readFileSync(join(root, "src/storefront/components/Catalog.tsx"), "utf8");
const admin = readFileSync(join(root, "src/storefront/admin/AdminAddProduct.tsx"), "utf8");

check("Catalog card + detail modal both render OptionIncludes, driven by selectedIncludes", () => {
  assert.ok(/selectedIncludes\(options, selectedIndex\)/.test(catalog), "OptionIncludes does not read selectedIncludes");
  const uses = catalog.match(/<OptionIncludes\b/g) ?? [];
  assert.equal(uses.length, 2, `expected the card and the modal to render it, got ${uses.length}`);
  assert.ok(/variant="card"/.test(catalog) && /variant="detail"/.test(catalog));
});

check("admin editor edits and saves includes", () => {
  assert.ok(/upd\(i, \{ includes:/.test(admin), "no includes input in the variation row");
  assert.ok(/includes/.test(admin.slice(admin.indexOf("variations: variations"))), "save path drops includes");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
