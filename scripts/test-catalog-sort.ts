// Self-contained test gate for the catalog sort menu styles
// (src/lib/storefront/catalog-sort.ts): the per-tenant
// branding.config.catalogSortStyle flag that swaps the storefront catalog's
// sort dropdown between the classic menu (Name / Price low-high / Price
// high-low) and the "simple" 3-option menu (Sort by Name / Sort by Price /
// Sort by Best Sellers), plus the best-seller ranking computed from real
// storefront orders. Pure — no DB, no React.
//
//   npm run test:catalog-sort
//
// Covers: style normalization for missing/garbage config, the exact option
// lists per style, best-seller counting (demand-only statuses, qty summing,
// variation rollup via base productId, legacy name-keyed lines, bad qty),
// sorting for every sort value (best desc + name tiebreak, unknown → name),
// and immutability of inputs.

import {
  normalizeCatalogSortStyle,
  catalogSortOptions,
  buildBestSellerCounts,
  sortCatalogProducts,
  type BestSellerCounts,
} from "../src/lib/storefront/catalog-sort";

let failures = 0;
let checks = 0;

function ok(name: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq<T>(name: string, actual: T, expected: T) {
  ok(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

// ── Style normalization ──────────────────────────────────────────────────────
console.log("normalizeCatalogSortStyle");

eq("undefined → classic", normalizeCatalogSortStyle(undefined), "classic");
eq("null → classic", normalizeCatalogSortStyle(null), "classic");
eq("garbage string → classic", normalizeCatalogSortStyle("fancy"), "classic");
eq("number → classic", normalizeCatalogSortStyle(3), "classic");
eq('"classic" → classic', normalizeCatalogSortStyle("classic"), "classic");
eq('"simple" → simple', normalizeCatalogSortStyle("simple"), "simple");

// ── Option lists ─────────────────────────────────────────────────────────────
console.log("catalogSortOptions");

// Classic IS today's dropdown — regression anchor for every other store.
eq("classic keeps today's three options", catalogSortOptions("classic"), [
  { value: "name", label: "Sort: Name" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
]);

// Simple is the HP Glow menu — exactly the three from the request.
eq("simple is Name / Price / Best Sellers only", catalogSortOptions("simple"), [
  { value: "name", label: "Sort by Name" },
  { value: "price-asc", label: "Sort by Price" },
  { value: "best", label: "Sort by Best Sellers" },
]);

// ── Best-seller counting ─────────────────────────────────────────────────────
console.log("buildBestSellerCounts");

const orders = [
  // Two demand orders for p1 (3 + 2 units), one for p2 (1 unit).
  { status: "new", items: [{ name: "Alpha", qty: 3, price: 100, productId: "p1" }] },
  {
    status: "delivered",
    items: [
      { name: "Alpha", qty: 2, price: 100, productId: "p1" },
      { name: "Beta", qty: 1, price: 50, productId: "p2" },
    ],
  },
  // Cancelled/refunded never count as demand.
  { status: "cancelled", items: [{ name: "Beta", qty: 99, price: 50, productId: "p2" }] },
  { status: "Refunded", items: [{ name: "Alpha", qty: 99, price: 100, productId: "p1" }] },
  // Variation line: productId is the BASE catalog id (stamped at checkout via
  // baseProductId), so its units roll up to the base product.
  {
    status: "confirmed",
    items: [{ name: "Alpha — 10mg", qty: 4, price: 120, productId: "p1" }],
  },
  // Legacy line without productId falls back to a name key.
  { status: "shipped", items: [{ name: "Gamma", qty: 2, price: 75 }] },
  // Bad qty values are ignored, never NaN-poison the map.
  {
    status: "new",
    items: [
      { name: "Beta", qty: Number.NaN, price: 50, productId: "p2" },
      { name: "Beta", qty: -5, price: 50, productId: "p2" },
    ],
  },
];

const counts = buildBestSellerCounts(orders);
eq("p1 units sum across orders incl. variation rollup", counts["p1"], 9);
eq("p2 counts only demand units", counts["p2"], 1);
eq("legacy no-productId line keyed by name", counts["name:Gamma"], 2);
eq("empty orders → empty map", buildBestSellerCounts([]), {});

// Input orders are not mutated.
eq("counting does not mutate order items", orders[0].items[0].qty, 3);

// ── Sorting ──────────────────────────────────────────────────────────────────
console.log("sortCatalogProducts");

const products = [
  { id: "p2", name: "Beta", price: 50 },
  { id: "p1", name: "Alpha", price: 100 },
  { id: "p4", name: "Delta", price: 100 },
  { id: "p3", name: "Gamma", price: 75 },
];
const ids = (list: { id: string }[]) => list.map((p) => p.id);

eq("name sorts A→Z", ids(sortCatalogProducts(products, "name")), ["p1", "p2", "p4", "p3"]);
eq(
  "price-asc sorts cheap→expensive",
  ids(sortCatalogProducts(products, "price-asc"))[0],
  "p2",
);
eq(
  "price-desc sorts expensive→cheap",
  ids(sortCatalogProducts(products, "price-desc"))[0],
  "p1",
);
eq("unknown sort falls back to name", ids(sortCatalogProducts(products, "wat")), [
  "p1",
  "p2",
  "p4",
  "p3",
]);

const bestCounts: BestSellerCounts = { p1: 9, p2: 1, "name:Gamma": 2 };
eq(
  "best ranks by units sold desc, then name for ties/zeros",
  ids(sortCatalogProducts(products, "best", bestCounts)),
  ["p1", "p3", "p2", "p4"], // 9, 2 (name-keyed), 1, 0
);
eq(
  "best with no counts degrades to name order",
  ids(sortCatalogProducts(products, "best")),
  ["p1", "p2", "p4", "p3"],
);

// Sorting returns a new array and never mutates the input list.
const before = ids(products);
sortCatalogProducts(products, "price-desc", bestCounts);
eq("input product list order untouched", ids(products), before);

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${checks} checks, ${failures} failure(s)`);
if (failures > 0) process.exit(1);
