// Self-contained test gate for admin-managed product sort categories
// (src/lib/storefront/sort-categories.ts): the owner-editable list that REPLACES
// the hardcoded catalog sort menu (catalog-sort.ts's CLASSIC_OPTIONS /
// SIMPLE_OPTIONS). Each entry is either a BUILT-IN behavior (Name, Price, Best
// Sellers, New Arrivals) or a GROUP the owner names themselves ("Weight Loss",
// "Anti-Aging", …) and assigns products to. Pure — no DB, no React.
//
//   npm run test:sort-categories
//
// Covers: normalization of untrusted config (garbage rows, duplicate ids,
// unknown kinds, the never-empty invariant), seeding from the legacy
// catalogSortStyle so no live store's menu changes on deploy day, the dropdown
// and product-form option lists, group sorting (members float, tail preserved),
// built-in sorting delegation, the default category-ordered catalog, featured
// pinning (and where it deliberately does NOT apply), and input immutability.

import {
  DEFAULT_SORT_CATEGORIES,
  normalizeSortCategories,
  seedSortCategories,
  sortCategoryOptions,
  assignableSortCategories,
  sortByCategory,
  orderCatalogByCategories,
  pinFeatured,
  type SortCategory,
} from "../src/lib/storefront/sort-categories";

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

/** The minimal product shape the sorters need. */
type P = {
  id: string;
  name: string;
  price: number;
  featured?: boolean;
  sortCategory?: string;
  createdAt?: string;
};

const ids = (list: { id: string }[]) => list.map((p) => p.id);

// ── Normalization ────────────────────────────────────────────────────────────
console.log("normalizeSortCategories");

eq(
  "undefined → the built-in default menu",
  normalizeSortCategories(undefined),
  DEFAULT_SORT_CATEGORIES,
);
eq("null → default menu", normalizeSortCategories(null), DEFAULT_SORT_CATEGORIES);
eq("non-array → default menu", normalizeSortCategories({ id: "x" }), DEFAULT_SORT_CATEGORIES);
eq("empty array → default menu", normalizeSortCategories([]), DEFAULT_SORT_CATEGORIES);

// A stored list is preserved verbatim (order included) once it is well-formed.
const stored: SortCategory[] = [
  { id: "weight", label: "Weight Loss", kind: "group", enabled: true },
  { id: "aging", label: "Anti-Aging", kind: "group", enabled: true },
  { id: "name", label: "Sort: Name", kind: "name", enabled: true },
];
eq("a well-formed stored list round-trips unchanged", normalizeSortCategories(stored), stored);

// Garbage rows are dropped, never crash-propagated to the storefront.
const dirty = [
  null,
  { label: "no id", kind: "group", enabled: true },
  { id: "  ", label: "blank id", kind: "group", enabled: true },
  { id: "ok1", label: "Healing", kind: "group", enabled: true },
  { id: "ok2", label: "Mystery", kind: "teleport", enabled: true }, // unknown kind
  { id: "ok1", label: "Duplicate", kind: "group", enabled: true }, // dup id
  { id: "ok3", label: "  Skin Care  ", kind: "group", enabled: false },
];
const cleaned = normalizeSortCategories(dirty);
eq("garbage rows dropped, first duplicate id wins", ids(cleaned), ["ok1", "ok3"]);
eq("labels are trimmed", cleaned[1].label, "Skin Care");
eq("disabled flag is preserved through normalization", cleaned[1].enabled, false);

// A row with no usable label falls back to something identifiable rather than
// rendering as a blank dropdown option.
eq(
  "blank label falls back to the id",
  normalizeSortCategories([{ id: "healing", label: "   ", kind: "group", enabled: true }])[0].label,
  "healing",
);

// The never-empty invariant: an owner must not be able to disable/delete their
// way into a storefront with no sort menu at all. Mirrors the
// resolveSelectableCategories fallback in lib/storefront/categories.ts.
eq(
  "a list with every entry disabled still yields a usable menu",
  sortCategoryOptions(
    normalizeSortCategories([
      { id: "weight", label: "Weight Loss", kind: "group", enabled: false },
    ]),
  ).length >= 1,
  true,
);
eq(
  "a list of nothing BUT garbage → default menu",
  normalizeSortCategories([null, 7, "nope"]),
  DEFAULT_SORT_CATEGORIES,
);

// Normalization must not mutate what the caller handed in.
const dirtyBefore = JSON.stringify(dirty);
normalizeSortCategories(dirty);
eq("normalization does not mutate its input", JSON.stringify(dirty), dirtyBefore);

// ── Seeding from the legacy catalogSortStyle ─────────────────────────────────
// Every live store must open on exactly the menu it had before this feature.
console.log("seedSortCategories");

eq(
  "classic seeds today's three classic labels",
  seedSortCategories("classic").map((c) => c.label),
  ["Sort: Name", "Price: Low to High", "Price: High to Low"],
);
eq(
  "simple seeds the HP Glow three",
  seedSortCategories("simple").map((c) => c.label),
  ["Sort by Name", "Sort by Price", "Sort by Best Sellers"],
);
eq(
  "unset style seeds classic (the default for every store)",
  seedSortCategories(undefined).map((c) => c.label),
  ["Sort: Name", "Price: Low to High", "Price: High to Low"],
);
eq("seeded entries are all enabled", seedSortCategories("simple").every((c) => c.enabled), true);
eq(
  "seeded entries are built-ins, never groups",
  seedSortCategories("classic").some((c) => c.kind === "group"),
  false,
);

// ── Option lists ─────────────────────────────────────────────────────────────
console.log("sortCategoryOptions / assignableSortCategories");

const menu: SortCategory[] = [
  { id: "weight", label: "Weight Loss", kind: "group", enabled: true },
  { id: "aging", label: "Anti-Aging", kind: "group", enabled: false },
  { id: "healing", label: "Healing", kind: "group", enabled: true },
  { id: "best", label: "Best Sellers", kind: "best-sellers", enabled: true },
  { id: "name", label: "A–Z", kind: "name", enabled: true },
];

eq(
  "the dropdown shows enabled entries in admin order",
  sortCategoryOptions(menu).map((o) => o.value),
  ["weight", "healing", "best", "name"],
);
eq(
  "the dropdown carries the owner's own labels",
  sortCategoryOptions(menu).map((o) => o.label),
  ["Weight Loss", "Healing", "Best Sellers", "A–Z"],
);
eq(
  "the product form offers only enabled GROUPS (built-ins are not assignable)",
  assignableSortCategories(menu).map((c) => c.id),
  ["weight", "healing"],
);

// ── Group sorting ────────────────────────────────────────────────────────────
console.log("sortByCategory");

const catalog: P[] = [
  { id: "p1", name: "Alpha", price: 100, sortCategory: "aging" },
  { id: "p2", name: "Beta", price: 50, sortCategory: "weight" },
  { id: "p3", name: "Gamma", price: 75 },
  { id: "p4", name: "Delta", price: 120, sortCategory: "weight" },
  { id: "p5", name: "Epsilon", price: 60, sortCategory: "healing" },
];

// Picking a GROUP sorts — it floats that group's members to the top. It must NOT
// filter: the rest of the catalog still follows, so a shopper never loses items.
const weightFirst = sortByCategory(catalog, "weight", menu);
// Beta then Delta — members are name-ordered within the group.
eq("group members float to the top", ids(weightFirst).slice(0, 2), ["p2", "p4"]);
eq("the whole catalog is still present (sort, not filter)", weightFirst.length, catalog.length);
eq(
  "non-members keep a stable name order behind the group",
  ids(weightFirst).slice(2),
  ["p1", "p5", "p3"],
);

// Built-in entries delegate to the existing catalog comparators.
eq("a name built-in sorts A→Z", ids(sortByCategory(catalog, "name", menu)), [
  "p1",
  "p2",
  "p4",
  "p5",
  "p3",
]);
eq(
  "a price built-in sorts cheap→expensive",
  ids(sortByCategory(catalog, "cheap", [
    { id: "cheap", label: "Price: Low to High", kind: "price-asc", enabled: true },
  ]))[0],
  "p2",
);
eq(
  "a best-sellers built-in ranks by units sold",
  ids(
    sortByCategory(
      catalog,
      "best",
      menu,
      { bestSellerCounts: { p3: 10, p5: 4 } },
    ),
  ).slice(0, 2),
  ["p3", "p5"],
);

const dated: P[] = [
  { id: "old", name: "Old", price: 10, createdAt: "2024-01-01T00:00:00.000Z" },
  { id: "new", name: "New", price: 10, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "undated", name: "Undated", price: 10 },
];
eq(
  "a new-arrivals built-in ranks newest first, undated last",
  ids(
    sortByCategory(dated, "fresh", [
      { id: "fresh", label: "New Arrivals", kind: "newest", enabled: true },
    ]),
  ),
  ["new", "old", "undated"],
);

// An unknown / deleted / disabled selection must degrade to a sane order rather
// than blanking or scrambling the catalog (a stale saved sort is normal).
eq(
  "an unknown category id degrades to name order",
  ids(sortByCategory(catalog, "deleted-cat", menu)),
  ["p1", "p2", "p4", "p5", "p3"],
);
eq(
  "an empty group (no products assigned) leaves the catalog intact",
  ids(sortByCategory(catalog, "healing", menu)).length,
  catalog.length,
);

// Sorting never mutates the caller's list.
const catalogBefore = ids(catalog);
sortByCategory(catalog, "weight", menu);
eq("sorting does not mutate the input catalog", ids(catalog), catalogBefore);

// ── Default catalog order ────────────────────────────────────────────────────
// With no explicit pick, the catalog is organized BY the admin's category order:
// every Weight Loss product, then Anti-Aging, then Healing, then the unassigned.
console.log("orderCatalogByCategories");

const grouped = orderCatalogByCategories(catalog, [
  { id: "weight", label: "Weight Loss", kind: "group", enabled: true },
  { id: "aging", label: "Anti-Aging", kind: "group", enabled: true },
  { id: "healing", label: "Healing", kind: "group", enabled: true },
]);
eq("products are blocked by category, in admin order", ids(grouped), [
  "p2", // weight  (Beta)
  "p4", // weight  (Delta) — name-ordered within the block
  "p1", // aging
  "p5", // healing
  "p3", // unassigned → last
]);

// Reordering the admin list reorders the storefront — the whole point.
const reordered = orderCatalogByCategories(catalog, [
  { id: "healing", label: "Healing", kind: "group", enabled: true },
  { id: "weight", label: "Weight Loss", kind: "group", enabled: true },
  { id: "aging", label: "Anti-Aging", kind: "group", enabled: true },
]);
eq("moving Healing to the top moves its products to the top", ids(reordered)[0], "p5");

// A DISABLED group must not hide its products — they fall to the unassigned tail.
// Hiding stock because of a sort-menu toggle would silently cost the store sales.
const withDisabled = orderCatalogByCategories(catalog, [
  { id: "weight", label: "Weight Loss", kind: "group", enabled: false },
  { id: "aging", label: "Anti-Aging", kind: "group", enabled: true },
]);
eq("a disabled group never hides products", withDisabled.length, catalog.length);
eq("a disabled group's products drop to the tail", ids(withDisabled)[0], "p1");

// Products assigned to a DELETED category behave like unassigned ones.
eq(
  "products of a deleted category still appear",
  orderCatalogByCategories(catalog, [
    { id: "healing", label: "Healing", kind: "group", enabled: true },
  ]).length,
  catalog.length,
);

// ── Featured pinning ─────────────────────────────────────────────────────────
console.log("pinFeatured");

const featuredCatalog: P[] = [
  { id: "a", name: "Alpha", price: 100 },
  { id: "b", name: "Beta", price: 50, featured: true },
  { id: "c", name: "Gamma", price: 75 },
  { id: "d", name: "Delta", price: 120, featured: true },
];

eq("featured products lead the list", ids(pinFeatured(featuredCatalog)), ["b", "d", "a", "c"]);
eq(
  "pinning is stable — it preserves the incoming order within each partition",
  ids(pinFeatured([...featuredCatalog].reverse())),
  ["d", "b", "c", "a"],
);
eq("nothing featured → order untouched", ids(pinFeatured([featuredCatalog[0], featuredCatalog[2]])), [
  "a",
  "c",
]);
eq("everything featured → order untouched", ids(pinFeatured([featuredCatalog[1], featuredCatalog[3]])), [
  "b",
  "d",
]);
eq("empty list → empty list", pinFeatured([]), []);

const featuredBefore = ids(featuredCatalog);
pinFeatured(featuredCatalog);
eq("pinning does not mutate the input", ids(featuredCatalog), featuredBefore);

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${checks} checks, ${failures} failure(s)`);
if (failures > 0) process.exit(1);
