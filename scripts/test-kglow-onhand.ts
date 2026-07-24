// Self-contained gate for the k-glow handwritten "on-hand" price note
// (scripts/lib/kglow-onhand.ts). No DB — verifies the transcribed rows match the
// notebook image and that the grouped product payloads are shaped the way the
// storefront mapping layer expects for ON-HAND (ready-stock) products, BEFORE
// scripts/seed-kglow-onhand.ts ever writes them.
//
//   npx tsx scripts/test-kglow-onhand.ts

import {
  ONHAND_ROWS,
  ONHAND_STOCK_DEFAULT,
  buildKglowOnHandProducts,
} from "./lib/kglow-onhand";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("kglow on-hand note extraction\n");

// ── Row-level consistency (the 11 handwritten lines) ─────────────────────────
check("11 rows transcribed from the note", ONHAND_ROWS.length === 11, `got ${ONHAND_ROWS.length}`);

check("codes are unique", new Set(ONHAND_ROWS.map((r) => r.code)).size === ONHAND_ROWS.length);

check("every row has a positive peso price", ONHAND_ROWS.every((r) => r.peso > 0));

const byCode = new Map(ONHAND_ROWS.map((r) => [r.code, r]));

// Tirzepatide on-hand tiers — note these DIFFER from the PasaBuy sheet
// (sheet TR15 = ₱3,600; on-hand TR15 = ₱3,200), which is exactly why they are
// separate on-hand listings and not edits to the group-buy products.
check("TR15 on-hand = ₱3,200 (sheet was ₱3,600)", byCode.get("TR15")?.peso === 3200);
check("TR30 on-hand = ₱4,900", byCode.get("TR30")?.peso === 4900);
check("TR60 on-hand = ₱9,300 (sheet was ₱8,800)", byCode.get("TR60")?.peso === 9300);

// GHK-CU on-hand (note writes both "GH100" and "GHK50").
check("GH100 → GHK-CU 100mg = ₱2,880", byCode.get("GH100")?.peso === 2880 && byCode.get("GH100")?.name === "GHK-CU");
check("GHK50 → GHK-CU 50mg = ₱2,000", byCode.get("GHK50")?.peso === 2000 && byCode.get("GHK50")?.name === "GHK-CU");

// Bacteriostatic water bottles (priced by volume, not a 10-vial kit).
check("BAC3 = ₱488", byCode.get("BAC3")?.peso === 488);
check("BAC5 = ₱510", byCode.get("BAC5")?.peso === 510);
check("BAC10 = ₱732", byCode.get("BAC10")?.peso === 732);

// Single-size on-hand peptides.
check("KP10 → KPV = ₱1,595", byCode.get("KP10")?.peso === 1595 && byCode.get("KP10")?.name === "KPV");
check("5AM → 5-Amino-1MQ = ₱2,800", byCode.get("5AM")?.peso === 2800 && byCode.get("5AM")?.name === "5-Amino-1MQ");
check("5AD AOD → AOD-9604 = ₱5,100", byCode.get("5AD")?.peso === 5100 && byCode.get("5AD")?.name === "AOD-9604");

// ── Grouped product payloads ─────────────────────────────────────────────────
const products = buildKglowOnHandProducts();

check("11 rows group into 6 on-hand products", products.length === 6, `got ${products.length}`);

check("product names are unique", new Set(products.map((p) => p.name)).size === products.length);

// On-hand is the whole point: NONE of these may carry the group-buy tag, or the
// storefront would exempt them from the stock check and re-price them at gbPrice.
check("no product is a group-buy listing", products.every((p) => p.productType === undefined));

// On-hand products are stock-gated (store.tsx: stock<=0 → 'out of stock'), so
// every one must seed with real stock or it would be unpurchasable.
check("ONHAND_STOCK_DEFAULT is a positive default", ONHAND_STOCK_DEFAULT > 0);
check("every product seeds with positive stock", products.every((p) => p.stock > 0));

check("every row surfaces as exactly one variation",
  products.reduce((n, p) => n + p.variations.length, 0) === ONHAND_ROWS.length);

check("variation names are unique within each product",
  products.every((p) => new Set(p.variations.map((v) => v.name)).size === p.variations.length));

check("every variation price is positive", products.every((p) => p.variations.every((v) => v.price > 0)));

// Base price = cheapest size, and a named variation carries it — so the
// storefront option builder skips the nameless "Standard" pill.
check("base price is the cheapest variation's price",
  products.every((p) => p.price === Math.min(...p.variations.map((v) => v.price))));
check("a named variation carries the base price",
  products.every((p) => p.variations.some((v) => v.price === p.price)));

// Multi-size groups the note defines.
const byName = new Map(products.map((p) => [p.name, p]));
check("Tirzepatide (on-hand) has 3 sizes", byName.get("Tirzepatide")?.variations.length === 3);
check("GHK-CU (on-hand) has 2 sizes", byName.get("GHK-CU")?.variations.length === 2);
check("Bacteriostatic Water has 3 sizes", byName.get("Bacteriostatic Water")?.variations.length === 3);

// GHK-CU 50mg is the cheaper size and drives the base price.
check("GHK-CU base price = ₱2,000 (the 50mg size)", byName.get("GHK-CU")?.price === 2000);

// Peptides are sold per 10-vial kit; bac water is per bottle (by volume).
check("Tirzepatide variations are 10-vial kits",
  byName.get("Tirzepatide")?.variations.every((v) => /× 10 vials$/.test(v.name)) === true);
check("Bacteriostatic Water variations are volumes (ml), not kits",
  byName.get("Bacteriostatic Water")?.variations.every((v) => /ml$/.test(v.name) && !/vials/.test(v.name)) === true);

// Product classification (used by Order Ratio Control + cart).
check("Bacteriostatic Water is classified bacWater", byName.get("Bacteriostatic Water")?.productClass === "bacWater");
check("5-Amino-1MQ is classified other (not a peptide)", byName.get("5-Amino-1MQ")?.productClass === "other");
check("Tirzepatide is classified peptide", byName.get("Tirzepatide")?.productClass === "peptide");

// DB-write shape: PHP pricing in integer cents, ₱ symbol, unique SKUs/slugs.
check("every product has a unique SKU", new Set(products.map((p) => p.sku)).size === products.length);
check("every product has a unique slug", new Set(products.map((p) => p.slug)).size === products.length);
check("priceCents is integer cents of the base price",
  products.every((p) => Number.isInteger(p.priceCents) && p.priceCents === Math.round(p.price * 100)));
check("currency is PHP with ₱ display symbol",
  products.every((p) => p.currency === "PHP" && p.currencySymbol === "₱"));

// Collision guard: on-hand SKUs/slugs must NOT match the existing group-buy
// Tirzepatide / GHK-CU rows, or the seed's upsert would overwrite the GB product.
check("Tirzepatide on-hand SKU differs from the GB SKU 'TIRZEPATIDE'",
  byName.get("Tirzepatide")?.sku !== "TIRZEPATIDE");
check("Tirzepatide on-hand slug differs from the GB slug 'tirzepatide'",
  byName.get("Tirzepatide")?.slug !== "tirzepatide");
check("GHK-CU on-hand SKU differs from the GB SKU 'GHKCU'",
  byName.get("GHK-CU")?.sku !== "GHKCU");
check("GHK-CU on-hand slug differs from the GB slug 'ghk-cu'",
  byName.get("GHK-CU")?.slug !== "ghk-cu");

console.log(failures === 0 ? "\nPASS — on-hand note extraction & grouping verified" : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
