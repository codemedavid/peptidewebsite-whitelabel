// Self-contained test gate for the group-buy page / two-ways on-hand search +
// category filter (src/lib/storefront/listing-filter.ts). Pure — no DB, no React.
//
//   npm run test:listing-filter
//
// Covers: text normalization (case, accents, spacing), word-wise matching over
// name / display name / description / dose names, category filtering, order and
// input immutability, and which category chips a listing is allowed to draw.

import {
  ALL_CATEGORY,
  filterListing,
  listingCategories,
  matchesListingQuery,
  normalizeSearchText,
  type FilterableProduct,
} from "../src/lib/storefront/listing-filter";

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
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const reta: FilterableProduct = {
  name: "Retatrutide",
  description: "Triple agonist",
  category: "weight",
  variations: [{ name: "10mg" }, { name: "20mg" }],
};
const ghk: FilterableProduct = { name: "GHK-Cu", description: "Copper peptide for skin", category: "beauty" };
const bac: FilterableProduct = { name: "Bacteriostatic Water", category: "supplies" };
const tirz: FilterableProduct = { name: "Tirzépatide", category: "weight" };

console.log("normalizeSearchText");
eq("lower-cases and trims", normalizeSearchText("  GHK-Cu "), "ghk-cu");
eq("folds accents", normalizeSearchText("Tirzépatide"), "tirzepatide");
eq("collapses whitespace", normalizeSearchText("reta   10\tmg"), "reta 10 mg");

console.log("matchesListingQuery");
ok("empty query matches", matchesListingQuery(reta, ""));
ok("whitespace query matches", matchesListingQuery(reta, "   "));
ok("name prefix", matchesListingQuery(reta, "reta"));
ok("case-insensitive", matchesListingQuery(ghk, "ghk-CU"));
ok("description word", matchesListingQuery(ghk, "copper"));
ok("dose name", matchesListingQuery(reta, "20mg"));
ok("words in any order across fields", matchesListingQuery(reta, "10mg reta"));
ok("accent-insensitive", matchesListingQuery(tirz, "tirzepatide"));
ok("display name is searched", matchesListingQuery(bac, "30ml", "Bacteriostatic Water 30ml"));
ok("every word must hit", !matchesListingQuery(reta, "reta copper"));
ok("miss", !matchesListingQuery(bac, "semaglutide"));

console.log("filterListing");
const lines = [reta, ghk, bac, tirz].map((product) => ({ product }));
const frozen = Object.freeze([...lines]);
const pick = (l: { product: FilterableProduct }) => l;
eq("no filter keeps all, in order", filterListing(frozen, { query: "", category: ALL_CATEGORY }, pick).map((l) => l.product.name), [
  "Retatrutide",
  "GHK-Cu",
  "Bacteriostatic Water",
  "Tirzépatide",
]);
eq("category only", filterListing(frozen, { query: "", category: "weight" }, pick).map((l) => l.product.name), ["Retatrutide", "Tirzépatide"]);
eq("category + query", filterListing(frozen, { query: "tirz", category: "weight" }, pick).map((l) => l.product.name), ["Tirzépatide"]);
eq("query only", filterListing(frozen, { query: "water", category: ALL_CATEGORY }, pick).map((l) => l.product.name), ["Bacteriostatic Water"]);
eq("blank category = all", filterListing(frozen, { query: "", category: "" }, pick).length, 4);
eq("no matches → []", filterListing(frozen, { query: "zzz", category: ALL_CATEGORY }, pick), []);
eq("input untouched", frozen.length, 4);

console.log("listingCategories");
const cats = [
  { id: ALL_CATEGORY, label: "All Products" },
  { id: "beauty", label: "Beauty" },
  { id: "weight", label: "Weight" },
  { id: "peptides", label: "Peptides" },
  { id: "supplies", label: "Supplies" },
];
eq(
  "only populated categories, store order, with counts, no 'all'",
  listingCategories([reta, ghk, bac, tirz], cats),
  [
    { id: "beauty", label: "Beauty", count: 1 },
    { id: "weight", label: "Weight", count: 2 },
    { id: "supplies", label: "Supplies", count: 1 },
  ],
);
eq("one real category → no chips", listingCategories([reta, tirz], cats), []);
eq("uncategorised products → no chips", listingCategories([{ name: "A" }, { name: "B" }], cats), []);
eq("seed categories with no products → no chips", listingCategories([bac], cats), []);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
