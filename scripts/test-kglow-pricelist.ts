// Self-contained gate for the k-glow PasaBuy pricelist extraction + grouping
// (scripts/lib/kglow-pricelist.ts). No DB — verifies the transcribed rows are
// internally consistent with the printed sheet and that the grouped product
// payloads are shaped the way the storefront mapping layer expects, BEFORE
// scripts/seed-kglow-products.ts ever writes them.
//
//   npx tsx scripts/test-kglow-pricelist.ts

import {
  PRICELIST_ROWS,
  buildKglowPricelistProducts,
  FX_PESO_PER_USD,
} from "./lib/kglow-pricelist";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("kglow pricelist extraction\n");

// ── Row-level consistency ────────────────────────────────────────────────────
check("53 rows transcribed from the sheet", PRICELIST_ROWS.length === 53,
  `got ${PRICELIST_ROWS.length}`);

check("catalog numbers are unique", new Set(PRICELIST_ROWS.map((r) => r.catNo)).size === PRICELIST_ROWS.length);

check("every row has a positive peso price", PRICELIST_ROWS.every((r) => r.peso > 0));

check("every row has a positive USD PasaBuy price", PRICELIST_ROWS.every((r) => r.usd > 0));

// The sheet prints ₱62.00 FX on every non-Tirzepatide row. Its own peso column
// wobbles around usd×62 by up to ~₱20 (e.g. DSIP $58 → ₱3,589.80, PT-141 $78 →
// ₱4,854.60), so this is a transcription-typo tripwire (2% tolerance), not an
// exact identity. Peso stays authoritative — it is what we seed.
const fxRows = PRICELIST_ROWS.filter((r) => r.hasFx);
check("FX rows exist (all non-Tirzepatide rows)", fxRows.length === 44, `got ${fxRows.length}`);
for (const r of fxRows) {
  const expected = r.usd * FX_PESO_PER_USD;
  const drift = Math.abs(r.peso - expected) / expected;
  if (drift > 0.02) {
    check(`FX cross-check ${r.catNo}`, false,
      `₱${r.peso} vs $${r.usd}×${FX_PESO_PER_USD}=₱${expected} (${(drift * 100).toFixed(1)}% off)`);
  }
}
check("all FX rows within 2% of usd×62", fxRows.every((r) => Math.abs(r.peso - r.usd * FX_PESO_PER_USD) / (r.usd * FX_PESO_PER_USD) <= 0.02));

// Tirzepatide rows carry no FX (special peso pricing on the sheet).
const trRows = PRICELIST_ROWS.filter((r) => r.catNo.startsWith("TR"));
check("9 Tirzepatide tiers (TR5–TR60), none with FX", trRows.length === 9 && trRows.every((r) => !r.hasFx));

// Spot-check the two pink-highlighted specials on the sheet.
check("TR15 = ₱3,600", PRICELIST_ROWS.find((r) => r.catNo === "TR15")?.peso === 3600);
check("TR30 = ₱4,900", PRICELIST_ROWS.find((r) => r.catNo === "TR30")?.peso === 4900);

// ── Grouped product payloads ─────────────────────────────────────────────────
const products = buildKglowPricelistProducts();

check("53 rows group into 25 products", products.length === 25, `got ${products.length}`);

check("product names are unique", new Set(products.map((p) => p.name)).size === products.length);

check("every product is a group-buy (PasaBuy) listing", products.every((p) => p.productType === "gb"));

check("no product sets a gbPrice (the PasaBuy price IS the price)", products.every((p) => p.gbPrice === undefined));

check("every row surfaces as exactly one variation",
  products.reduce((n, p) => n + p.variations.length, 0) === PRICELIST_ROWS.length);

check("variation names are unique within each product",
  products.every((p) => new Set(p.variations.map((v) => v.name)).size === p.variations.length));

check("every variation price is positive", products.every((p) => p.variations.every((v) => v.price > 0)));

// Base price = cheapest size, and a variation carries it — so the storefront's
// option builder (buildProductOptions) skips the nameless "Standard" pill and
// the customer only ever picks a named size.
check("base price is the cheapest variation's price",
  products.every((p) => p.price === Math.min(...p.variations.map((v) => v.price))));
check("a named variation carries the base price",
  products.every((p) => p.variations.some((v) => v.price === p.price)));

// Multi-size groups the sheet defines.
const byName = new Map(products.map((p) => [p.name, p]));
check("Tirzepatide has 9 sizes", byName.get("Tirzepatide")?.variations.length === 9);
check("Semaglutide has 5 sizes", byName.get("Semaglutide")?.variations.length === 5);
check("CJC-1295 Without DAC has 3 sizes", byName.get("CJC-1295 Without DAC")?.variations.length === 3);
check("TB500 (Thymosin B4 Acetate) has 3 sizes", byName.get("TB500 (Thymosin B4 Acetate)")?.variations.length === 3);

// The sheet leaves the IP5/IP10 product cell blank — inferred from the catalog
// prefix. Guard the inference so it never silently changes.
check("IP5/IP10 rows resolve to Ipamorelin", byName.get("Ipamorelin")?.variations.length === 2);

// BT2's printed spec ("5mg*10vials") duplicates BT5 — transcribed as 2mg per its
// catalog number, keeping the printed ₱4,216 price.
const tb500 = byName.get("TB500 (Thymosin B4 Acetate)");
check("BT2 recorded as 2mg × 10 vials at ₱4,216",
  !!tb500?.variations.some((v) => v.name === "2mg × 10 vials" && v.price === 4216));

// Peso spot-checks against the sheet (one per column region).
check("Selank 5mg = ₱3,589.80", byName.get("Selank")?.variations.some((v) => v.price === 3589.8) === true);
check("SS-31 50mg = ₱19,468", byName.get("SS-31")?.variations.some((v) => v.price === 19468) === true);
check("IGF-1LR3 0.1mg = ₱2,480", byName.get("IGF-1LR3")?.variations.some((v) => v.price === 2480) === true);
check("Thymalin 10mg = ₱4,464", byName.get("Thymalin")?.price === 4464);

// DB-write shape: PHP pricing in integer cents, ₱ symbol, unique SKUs/slugs.
check("every product has a unique SKU", new Set(products.map((p) => p.sku)).size === products.length);
check("every product has a unique slug", new Set(products.map((p) => p.slug)).size === products.length);
check("priceCents is integer cents of the base price",
  products.every((p) => Number.isInteger(p.priceCents) && p.priceCents === Math.round(p.price * 100)));
check("currency is PHP with ₱ display symbol",
  products.every((p) => p.currency === "PHP" && p.currencySymbol === "₱"));

console.log(failures === 0 ? "\nPASS — pricelist extraction & grouping verified" : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
