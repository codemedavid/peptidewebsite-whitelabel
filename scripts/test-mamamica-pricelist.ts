/**
 * Verifies the Mama Mica Glow pricelist transcription (scripts/lib/mamamica-pricelist.ts)
 * against the sheet export, without a database.
 *
 *   npx tsx scripts/test-mamamica-pricelist.ts
 */
import assert from "node:assert/strict";

import { MAMAMICA_CATEGORIES } from "./lib/mamamica-families";
import { buildMamamicaProducts, DROPPED_ROWS, normCode, PLACEHOLDER_STOCK, sheetRows } from "./lib/mamamica-pricelist";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const products = buildMamamicaProducts();
const byName = (name: string) => {
  const p = products.find((x) => x.name === name);
  assert.ok(p, `missing product ${name}`);
  return p;
};
const optionPrice = (name: string, label: string) => {
  const o = byName(name).options.find((x) => x.label === label);
  assert.ok(o, `missing option ${name} / ${label}`);
  return o.price;
};

console.log("coverage");

test("every priced sheet row lands in exactly one product (the duplicate Retalide row aside)", () => {
  const used = products.flatMap((p) => p.allCodes);
  const counts = new Map<string, number>();
  for (const c of used) counts.set(c, (counts.get(c) ?? 0) + 1);
  for (const r of sheetRows()) {
    if (DROPPED_ROWS.has(r.row)) continue;
    assert.equal(counts.get(normCode(r.code)), 1, `sheet row ${r.row} (${r.code}) used ${counts.get(normCode(r.code)) ?? 0}×`);
  }
  assert.equal(used.length, new Set(used).size, "a code is listed twice");
});

test("names, slugs and SKUs are unique; every category is a real shelf", () => {
  const shelves = new Set(MAMAMICA_CATEGORIES.map((c) => c.id));
  for (const key of ["name", "slug", "sku"] as const) {
    assert.equal(new Set(products.map((p) => p[key])).size, products.length, `duplicate ${key}`);
  }
  for (const p of products) assert.ok(shelves.has(p.category), `${p.name} → ${p.category}`);
});

console.log("per-vial prices");

test("peptides sell at the sheet's per-vial price, never the 10-vial box", () => {
  assert.equal(optionPrice("Tirzepatide", "5mg"), 422.5);
  assert.equal(optionPrice("Tirzepatide", "100mg"), 2535);
  assert.equal(optionPrice("BApH Bacteriostatic Water", "3ml"), 65);
  assert.equal(byName("Cerebrolysin 60mg").price, 725.83);
});

test("rows without a per-vial price fall back to the sheet's price column", () => {
  assert.equal(byName("The Mica Blend GHK-Cu Shampoo 250ml").price, 799);
  assert.equal(byName("Niimbot M2 Label Printer").price, 7299);
});

test("odd price cells: '399/pair', a box-only out-of-stock row, unpriced colour rows", () => {
  assert.equal(byName("Sponge Spicule Bio-Microneedling").price, 399);
  assert.equal(byName("HGH Fragment 176-191 5mg").price, 741);
  assert.equal(optionPrice("Niimbot B1 Pro Label Printer", "Purple"), 2999);
});

test("every option has a positive price; base price = cheapest live option", () => {
  for (const p of products) {
    for (const o of p.options) assert.ok(o.price > 0, `${p.name} / ${o.label}`);
    assert.equal(p.price, Math.min(...p.options.map((o) => o.price)), p.name);
  }
});

console.log("hidden OUT items");

test("sizes out in BOTH stock columns are dropped; the rest of the family stays live", () => {
  const sema = byName("Semaglutide");
  assert.equal(sema.active, true);
  assert.deepEqual(sema.options.map((o) => o.label), ["2mg", "5mg", "10mg"]);
});

test("a family with every size out is saved hidden (draft), keeping its options", () => {
  const ghrp = byName("GHRP-6 Acetate");
  assert.equal(ghrp.active, false);
  assert.equal(ghrp.options.length, 2);
  assert.ok(ghrp.options.every((o) => o.stock === 0));
});

test("out in Luzon but on hand in Mindanao stays live", () => {
  assert.ok(byName("Phosphate Buffered Saline (Topical)").options.some((o) => o.label === "10ml"));
  assert.ok(byName("Tirzepatide").options.some((o) => o.label === "100mg"));
  assert.ok(byName("Acetic Acid Water 0.6%").options.some((o) => o.label === "3ml"));
});

test("live options carry the placeholder stock", () => {
  for (const p of products.filter((x) => x.active)) {
    for (const o of p.options) assert.equal(o.stock, PLACEHOLDER_STOCK, `${p.name} / ${o.label}`);
  }
});

console.log("descriptions");

test("lab results are kept, and the per-vial note leads", () => {
  const d = byName("Tirzepatide").description;
  assert.match(d, /Price is per vial \(a full box has 10\)/);
  assert.match(d, /Janoshik/);
  assert.doesNotMatch(d, /Top Pick/, "highlight lines become `featured`, not copy");
});

test("lab blocks pasted onto the wrong product (LL-37 on Mazdutide / KLOW) are dropped", () => {
  assert.doesNotMatch(byName("Mazdutide 10mg").description, /LL-37/);
  assert.doesNotMatch(byName("KLOW (GHK-Cu + TB-500 + BPC-157 + KPV) 80mg").description, /LL-37/);
  assert.match(byName("LL-37 5mg").description, /PURITY \| LL-37/);
});

test("handling warnings survive (Retatrutide gelling note)", () => {
  assert.match(byName("Retatrutide").description, /not subject to replacement, refund, or exchange/);
});

test("repeated copy is printed once (Retalide is on the sheet twice)", () => {
  const d = byName("Retalide — Retatrutide + Cagrilintide 35mg").description;
  assert.equal(d.split("Retatrutide 30mg + Cagrilintide 5mg").length - 1, 1);
  assert.match(d, /Community Exclusive Blend/);
});

test("options that differ (algae colours) each get their own heading", () => {
  const d = byName("Algae Sponge Microneedles").description;
  assert.match(d, /^Blue\nSoothes skin/m);
  assert.match(d, /^Blue Enhanced\nUpgraded/m);
});

test("highlighted products are featured", () => {
  assert.equal(byName("Tirzepatide").featured, true);
  assert.equal(byName("BPC-157 + TB-500").featured, true);
  assert.equal(byName("Semaglutide").featured, false);
});

console.log(`\n${passed} passed — ${products.length} products, ${products.filter((p) => p.active).length} live`);
