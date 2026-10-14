/**
 * Self-contained test for the legacy-store catalog mapper (no DB, no network).
 *
 * Stores migrating in from the old Vite + Supabase peptide app (HP GLOW, The
 * Peppy Lab) expose the same public tables: products, product_variations,
 * categories, payment_methods, vouchers. The mapper turns those rows into the
 * whitelabel's storefront shapes. What must hold:
 *   • the old "Vial Only / Complete Set" toggle becomes two variations, and the
 *     set's inclusions survive in the description (variations carry no copy);
 *   • real product_variations win over the set toggle, keep their own stock;
 *   • a discount only applies when it is active AND genuinely lower;
 *   • category uuids resolve to stable slug ids, ordered by sort_order;
 *   • SKUs are deterministic from the legacy uuid, so re-runs upsert in place;
 *   • vouchers keep their usage counters and percentage/fixed type.
 *
 *   npm run test:legacy-store
 */

import assert from "node:assert";

import {
  legacySku,
  mapLegacyCategories,
  mapLegacyPaymentMethods,
  mapLegacyProduct,
  mapLegacyVouchers,
  type LegacyProductRow,
  type LegacyVariationRow,
} from "../src/lib/migration/legacy-store";

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

// ──────────────────────────── fixtures ──────────────────────────────────────
const CATS = [
  { id: "c-4", name: "Add-ons", sort_order: 4, active: true },
  { id: "c-1", name: "Peptides", sort_order: 1, active: true },
  { id: "c-3", name: "Fat Melters", sort_order: 3, active: true },
  { id: "c-9", name: "Retired", sort_order: 9, active: false },
];

function product(over: Partial<LegacyProductRow> = {}): LegacyProductRow {
  return {
    id: "0e7be0f9-507d-47b7-972b-e753b23d474a",
    name: "NAD 500mg",
    description: "Purpose: Energy & cell repair\nHow it works: Fuels cellular energy",
    category: "c-1",
    base_price: 1499,
    discount_price: null,
    discount_active: false,
    purity_percentage: 99,
    molecular_weight: null,
    cas_number: null,
    sequence: null,
    storage_conditions: "Store at -20°C",
    stock_quantity: 1000,
    available: true,
    featured: false,
    image_url: "https://old.supabase.co/storage/v1/object/public/menu-images/nad.png",
    is_complete_set: false,
    complete_set_price: null,
    complete_set_description: null,
    ...over,
  };
}

const { categories, idMap } = mapLegacyCategories(CATS);

console.log("\nLegacy store mapper\n");

// ──────────────────────────── categories ────────────────────────────────────
check("categories: active only, ordered by sort_order, slug ids", () => {
  assert.deepStrictEqual(categories, [
    { id: "peptides", label: "Peptides" },
    { id: "fat-melters", label: "Fat Melters" },
    { id: "add-ons", label: "Add-ons" },
  ]);
});

check("categories: legacy uuid resolves to the new slug id", () => {
  assert.strictEqual(idMap.get("c-3"), "fat-melters");
  assert.strictEqual(idMap.get("c-9"), undefined);
});

check("categories: duplicate labels get distinct ids", () => {
  const { categories: dup } = mapLegacyCategories([
    { id: "a", name: "Peptides", sort_order: 1, active: true },
    { id: "b", name: "Peptides", sort_order: 2, active: true },
  ]);
  assert.deepStrictEqual(
    dup.map((c) => c.id),
    ["peptides", "peptides-2"],
  );
});

// ──────────────────────────── SKU ───────────────────────────────────────────
check("sku: deterministic from the legacy uuid", () => {
  assert.strictEqual(legacySku("0e7be0f9-507d-47b7-972b-e753b23d474a"), "leg-0e7be0f9507d");
  assert.strictEqual(legacySku("0e7be0f9-507d-47b7-972b-e753b23d474a"), legacySku("0E7BE0F9-507D-47b7-972b-e753b23d474a"));
});

// ──────────────────────────── products ──────────────────────────────────────
check("product: plain fields carry over", () => {
  const p = mapLegacyProduct(product(), [], idMap, "₱");
  assert.strictEqual(p.name, "NAD 500mg");
  assert.strictEqual(p.price, 1499);
  assert.strictEqual(p.currency, "₱");
  assert.strictEqual(p.purity, "99%");
  assert.strictEqual(p.category, "peptides");
  assert.strictEqual(p.stock, 1000);
  assert.strictEqual(p.available, true);
  assert.strictEqual(p.storage, "Store at -20°C");
  assert.strictEqual(p.image, "https://old.supabase.co/storage/v1/object/public/menu-images/nad.png");
  assert.strictEqual(p.variations, undefined);
  assert.strictEqual(p.discountEnabled, false);
});

check("product: complete set becomes Vial Only + Complete Set variations", () => {
  const p = mapLegacyProduct(
    product({
      is_complete_set: true,
      complete_set_price: 1699,
      complete_set_description: "Peptide vial\nBacteriostatic Water\n10 pcs Insulin syringes \n",
    }),
    [],
    idMap,
    "₱",
  );
  assert.deepStrictEqual(p.variations, [
    { name: "Vial Only", price: 1499 },
    { name: "Complete Set", price: 1699 },
  ]);
});

check("product: set inclusions are appended to the description", () => {
  const p = mapLegacyProduct(
    product({
      is_complete_set: true,
      complete_set_price: 1699,
      complete_set_description: "Peptide vial\nBacteriostatic Water\n10 pcs Insulin syringes \n",
    }),
    [],
    idMap,
    "₱",
  );
  assert.ok(p.description.startsWith("Purpose: Energy & cell repair"));
  assert.ok(
    p.description.endsWith(
      "Complete Set includes:\n• Peptide vial\n• Bacteriostatic Water\n• 10 pcs Insulin syringes",
    ),
    p.description,
  );
});

check("product: a set flag without a set price stays single-option", () => {
  const p = mapLegacyProduct(product({ is_complete_set: true, complete_set_price: null }), [], idMap, "₱");
  assert.strictEqual(p.variations, undefined);
});

check("product: real variations win and keep per-option stock", () => {
  const vars: LegacyVariationRow[] = [
    { id: "v1", product_id: "x", name: "Orange", quantity_mg: 0, price: 1299, discount_price: null, discount_active: false, stock_quantity: 50 },
    { id: "v2", product_id: "x", name: "Gray", quantity_mg: 0, price: 1299, discount_price: null, discount_active: false, stock_quantity: 0 },
  ];
  const p = mapLegacyProduct(product({ is_complete_set: true, complete_set_price: 1699 }), vars, idMap, "₱");
  assert.deepStrictEqual(p.variations, [
    { name: "Orange", price: 1299, stock: 50 },
    { name: "Gray", price: 1299, stock: 0 },
  ]);
});

check("product: variation discount applies only when active and lower", () => {
  const vars: LegacyVariationRow[] = [
    { id: "v1", product_id: "x", name: "5mg", quantity_mg: 5, price: 1000, discount_price: 800, discount_active: true, stock_quantity: null },
    { id: "v2", product_id: "x", name: "10mg", quantity_mg: 10, price: 1800, discount_price: 900, discount_active: false, stock_quantity: null },
  ];
  const p = mapLegacyProduct(product(), vars, idMap, "₱");
  assert.deepStrictEqual(p.variations, [
    { name: "5mg", price: 800 },
    { name: "10mg", price: 1800 },
  ]);
});

check("product: discount enabled only when active and below base", () => {
  assert.strictEqual(
    mapLegacyProduct(product({ discount_active: true, discount_price: 1299 }), [], idMap, "₱").discountEnabled,
    true,
  );
  assert.strictEqual(
    mapLegacyProduct(product({ discount_active: true, discount_price: 1499 }), [], idMap, "₱").discountEnabled,
    false,
  );
  assert.strictEqual(
    mapLegacyProduct(product({ discount_active: false, discount_price: 999 }), [], idMap, "₱").discountEnabled,
    false,
  );
});

check("product: missing image, unknown category and null stock are safe", () => {
  const p = mapLegacyProduct(
    product({ image_url: "", category: "nope", stock_quantity: null, description: null, purity_percentage: null }),
    [],
    idMap,
    "₱",
  );
  assert.strictEqual(p.image, null);
  assert.strictEqual(p.category, "");
  assert.strictEqual(p.stock, 0);
  assert.strictEqual(p.description, "");
  assert.strictEqual(p.purity, undefined);
});

check("product: mapping never mutates its input", () => {
  const row = product({ is_complete_set: true, complete_set_price: 1699, complete_set_description: "A\nB" });
  const snapshot = JSON.stringify(row);
  mapLegacyProduct(row, [], idMap, "₱");
  assert.strictEqual(JSON.stringify(row), snapshot);
});

// ──────────────────────────── payments ──────────────────────────────────────
check("payment methods: fields map, inactive kept but flagged, ordered", () => {
  const out = mapLegacyPaymentMethods([
    { id: "gcash", name: "GCash", account_number: "0917", account_name: "The Peppy Lab", qr_code_url: "https://x/q2.jpeg", active: true, sort_order: 2 },
    { id: "bpi", name: "Bank Transfer BPI", account_number: "0659", account_name: "The Peppy Lab", qr_code_url: null, active: false, sort_order: 1 },
  ]);
  assert.deepStrictEqual(out, [
    { id: "bpi", name: "Bank Transfer BPI", account: "The Peppy Lab", number: "0659", qrImage: "", order: 1, active: false },
    { id: "gcash", name: "GCash", account: "The Peppy Lab", number: "0917", qrImage: "https://x/q2.jpeg", order: 2, active: true },
  ]);
});

// ──────────────────────────── vouchers ──────────────────────────────────────
check("vouchers: percentage/fixed, counters and expiry carry over", () => {
  const out = mapLegacyVouchers([
    { id: "v1", code: "tpl1", discount_type: "percentage", discount_value: 10, min_spend: 0, usage_limit: null, times_used: 24, is_active: true, expires_at: "2026-10-05T00:00:00+00:00" },
    { id: "v2", code: "FLAT100", discount_type: "fixed", discount_value: 100, min_spend: 1500, usage_limit: 50, times_used: 3, is_active: false, expires_at: null },
  ]);
  assert.deepStrictEqual(out, [
    { id: "v1", code: "TPL1", type: "percent", value: 10, minPurchase: 0, usageLimit: null, used: 24, expiry: "2026-10-05T00:00:00+00:00", active: true },
    { id: "v2", code: "FLAT100", type: "fixed", value: 100, minPurchase: 1500, usageLimit: 50, used: 3, expiry: null, active: false },
  ]);
});

check("vouchers: blank codes are dropped, duplicates keep the first", () => {
  const out = mapLegacyVouchers([
    { id: "a", code: "  ", discount_type: "percentage", discount_value: 5, min_spend: 0, usage_limit: null, times_used: 0, is_active: true, expires_at: null },
    { id: "b", code: "SAVE", discount_type: "percentage", discount_value: 5, min_spend: 0, usage_limit: null, times_used: 0, is_active: true, expires_at: null },
    { id: "c", code: "save", discount_type: "percentage", discount_value: 9, min_spend: 0, usage_limit: null, times_used: 0, is_active: true, expires_at: null },
  ]);
  assert.deepStrictEqual(out.map((p) => [p.id, p.code, p.value]), [["b", "SAVE", 5]]);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
