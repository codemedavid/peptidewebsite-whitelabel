/**
 * Verifies the Dragon Peptides sheet transcription + grouping in
 * scripts/lib/dragon-pricelist.ts, with no database.
 *
 * The load-bearing check is the +₱200 invariant: the sheet sets every on-hand
 * price at exactly GB + 200, on all 175 printed rows without exception. Any
 * single-column typo in the transcription breaks it, so asserting it per option
 * catches what proofreading 172 rows by eye would not.
 *
 *   npm run test:dragon-pricelist
 */

import assert from "node:assert";

import {
  DRAGON_ROWS,
  ONHAND_MINUS_GB,
  buildDragonPricelistProducts,
} from "./lib/dragon-pricelist";
import { buildProductOptions } from "../src/lib/storefront/variations";
import { groupBuyLine } from "../src/lib/storefront/two-ways";

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

const products = buildDragonPricelistProducts();
const allOptions = DRAGON_ROWS.flatMap((r) => r.options.map((o) => ({ r, o })));

console.log("\nDragon Peptides pricelist\n");

console.log("shape");

check("88 families over 172 unique sheet rows", () => {
  assert.strictEqual(DRAGON_ROWS.length, 88, "families");
  assert.strictEqual(allOptions.length, 172, "options");
  assert.strictEqual(products.length, 88);
});

check("48 families are multi-size, 40 are single-option", () => {
  const multi = DRAGON_ROWS.filter((r) => r.options.length > 1);
  assert.strictEqual(multi.length, 48);
  assert.strictEqual(DRAGON_ROWS.length - multi.length, 40);
});

check("every family belongs to one of the sheet's four sections", () => {
  const sections = new Set(DRAGON_ROWS.map((r) => r.section));
  assert.deepStrictEqual([...sections].sort(), [
    "AURORA",
    "GTT & Serums",
    "HXTNT",
    "JITAI",
  ]);
});

console.log("\nthe +₱200 invariant — the sheet's own pricing rule");

check("on-hand === GB + ₱200 on every one of the 172 options", () => {
  const bad = allOptions.filter(
    ({ o }) => Math.abs(o.onhand - o.gb - ONHAND_MINUS_GB) > 0.011,
  );
  assert.deepStrictEqual(
    bad.map(({ r, o }) => `${r.family} ${o.size}: gb=${o.gb} onhand=${o.onhand}`),
    [],
  );
});

check("every price is positive and the GB leg is genuinely cheaper", () => {
  for (const { r, o } of allOptions) {
    assert.ok(o.gb > 0, `${r.family} ${o.size}: gb must be > 0`);
    assert.ok(o.onhand > o.gb, `${r.family} ${o.size}: on-hand must exceed gb`);
  }
});

console.log("\nidentity");

check("no duplicate SKU", () => {
  const skus = products.map((p) => p.sku);
  assert.strictEqual(new Set(skus).size, skus.length);
});

check("no duplicate slug", () => {
  const slugs = products.map((p) => p.slug);
  assert.strictEqual(new Set(slugs).size, slugs.length);
});

check("no duplicate family name", () => {
  const names = DRAGON_ROWS.map((r) => r.family);
  assert.strictEqual(new Set(names).size, names.length);
});

check("no family repeats a size", () => {
  for (const r of DRAGON_ROWS) {
    const sizes = r.options.map((o) => o.size);
    assert.strictEqual(new Set(sizes).size, sizes.length, `${r.family} repeats a size`);
  }
});

console.log("\ngrouping — distinct molecules must not share a product");

check("BPC-157, its TB-500 combo, and GHRP-2/6 stay separate families", () => {
  const names = DRAGON_ROWS.map((r) => r.family);
  for (const n of [
    "HXTNT BPC-157",
    "HXTNT BPC-157 + TB-500",
    "HXTNT GHRP-2 Acetate",
    "HXTNT GHRP-6 Acetate",
    "HXTNT CJC-1295 with DAC",
    "HXTNT CJC-1295 Without DAC",
    "HXTNT CJC-1295 w/o DAC + Ipamorelin",
  ]) {
    assert.ok(names.includes(n), `missing family: ${n}`);
  }
});

check("no family mixes a plain compound with a combination product", () => {
  // A "+" in a size means a combo dose ("5mg + 5mg"); it may only appear in a
  // family whose own name is a combination.
  for (const r of DRAGON_ROWS) {
    if (r.options.some((o) => o.size.includes("+"))) {
      assert.ok(r.family.includes("+"), `${r.family} carries a combo size`);
    }
  }
});

console.log("\nbuild — base price, options, ordering");

check("base price is the cheapest option, in both legs", () => {
  for (const p of products) {
    if (!p.variations.length) continue;
    const cheapest = Math.min(...p.variations.map((v) => v.price));
    assert.strictEqual(p.price, cheapest, `${p.name} base price`);
    const itsGb = p.variations.find((v) => v.price === cheapest)!.gbPrice;
    assert.strictEqual(p.gbPrice, itsGb, `${p.name} base gbPrice`);
  }
});

check("variations are ordered cheapest first", () => {
  for (const p of products) {
    const prices = p.variations.map((v) => v.price);
    assert.deepStrictEqual(prices, [...prices].sort((a, b) => a - b), p.name);
  }
});

check("priceCents is a whole number of centavos", () => {
  for (const p of products) {
    assert.ok(Number.isInteger(p.priceCents), `${p.name}: ${p.priceCents}`);
    assert.strictEqual(p.priceCents, Math.round(p.price * 100));
  }
});

check("single-option families carry no variations and no size list", () => {
  const singles = products.filter((p) => !p.variations.length);
  assert.strictEqual(singles.length, 40);
  for (const p of singles) assert.strictEqual(p.sizes, "");
});

check("every product is a group-buy listing priced in pesos", () => {
  for (const p of products) {
    assert.strictEqual(p.productType, "gb");
    assert.strictEqual(p.currency, "PHP");
    assert.strictEqual(p.currencySymbol, "₱");
  }
});

console.log("\nproduct class — Order Ratio Control");

check("both bacteriostatic water families are classed bacWater", () => {
  const bac = DRAGON_ROWS.filter((r) => r.productClass === "bacWater");
  assert.deepStrictEqual(bac.map((r) => r.family).sort(), [
    "HXTNT Bacteriostatic Water",
    "Pharma Bacteriostatic Water 10ml",
  ]);
});

check("no peptide-classed family is actually a serum or skin booster", () => {
  for (const r of DRAGON_ROWS.filter((x) => x.productClass === "peptide")) {
    assert.notStrictEqual(r.section, "GTT & Serums", `${r.family} is a serum`);
  }
});

console.log("\nstorefront wiring — the options a shopper actually sees");

check('the picker shows real sizes, never a nameless "Standard"', () => {
  for (const p of products.filter((x) => x.variations.length > 1)) {
    const names = buildProductOptions(p).map((o) => o.name);
    assert.ok(!names.includes("Standard"), `${p.name} offers a bare "Standard"`);
    assert.deepStrictEqual(
      names,
      p.variations.map((v) => v.name),
    );
  }
});

check("every option shows a real saving in a live round", () => {
  for (const p of products) {
    const legs = p.variations.length
      ? p.variations
      : [{ name: "", price: p.price, gbPrice: p.gbPrice }];
    for (const v of legs) {
      const line = groupBuyLine({ price: v.price, gbPrice: v.gbPrice, productType: "gb" });
      assert.ok(line.hasSavings, `${p.name} ${v.name}: no saving`);
      // Tolerance, not equality: the sheet's one-decimal prices (₱58.90 /
      // ₱258.90) subtract to 199.99999999999997 in binary floating point. The
      // stored value is exact — priceCents rounds to whole centavos.
      assert.ok(
        Math.abs(line.savings - ONHAND_MINUS_GB) < 0.011,
        `${p.name} ${v.name}: saved ${line.savings}`,
      );
    }
  }
});

console.log("\nspot checks against the printed sheet");

check("HXTNT Reta carries all 8 sizes at their printed prices", () => {
  const reta = products.find((p) => p.name === "HXTNT Reta")!;
  assert.deepStrictEqual(reta.variations, [
    { name: "5mg", price: 565, gbPrice: 365 },
    { name: "10mg", price: 750, gbPrice: 550 },
    { name: "15mg", price: 820, gbPrice: 620 },
    { name: "20mg", price: 975, gbPrice: 775 },
    { name: "30mg", price: 1189, gbPrice: 989 },
    { name: "40mg", price: 1440, gbPrice: 1240 },
    { name: "50mg", price: 1650, gbPrice: 1450 },
    { name: "60mg", price: 1904, gbPrice: 1704 },
  ]);
  assert.strictEqual(reta.price, 565);
  assert.strictEqual(reta.gbPrice, 365);
});

check("the cheapest and dearest options on the sheet survive", () => {
  const bac = products.find((p) => p.name === "Pharma Bacteriostatic Water 10ml")!;
  assert.deepStrictEqual(bac.variations[0], { name: "1pc", price: 260, gbPrice: 60 });
  const livagen = products.find((p) => p.name === "HXTNT Livagen")!;
  assert.strictEqual(livagen.price, 7020);
  assert.strictEqual(livagen.gbPrice, 6820);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
